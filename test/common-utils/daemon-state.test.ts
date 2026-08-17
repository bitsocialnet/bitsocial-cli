import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { once } from "events";
import { pathToFileURL } from "url";
import { directory as randomDirectory } from "tempy";
import type { DaemonState } from "../../dist/common-utils/daemon-state.js";

// These tests exercise the real dist module by writing and reading actual state files, and that module
// resolves its states dir ONCE, at import time, from env-paths' data dir (daemon-state.ts:
// DAEMON_STATES_DIR). Left at its default, that dir is machine-global — shared with every daemon on the
// box, including those other test files start in parallel, each of which prunes dead-pid state files on
// startup and so deletes the synthetic dead-pid ones written here (issue #130). So point the data dir at
// a tempdir. Because both PKC_DATA_PATH and DAEMON_STATES_DIR are computed eagerly at module load, the
// override has to happen BEFORE the dist modules are imported — hence the dynamic imports below.
// env-paths derives the data dir from XDG_DATA_HOME on linux, HOME on macOS and LOCALAPPDATA on
// windows, so all of them are overridden.
const isolatedHome = randomDirectory();

/**
 * The data-dir env as the rest of the machine sees it, captured before the override, so a spawned
 * pruner can be pointed at the REAL shared dir (see runExternalPrune). Keys with an undefined value are
 * dropped from a child's env by child_process, which correctly restores "was never set".
 */
const REAL_DATA_DIR_ENV: NodeJS.ProcessEnv = {
    HOME: process.env["HOME"],
    XDG_DATA_HOME: process.env["XDG_DATA_HOME"],
    LOCALAPPDATA: process.env["LOCALAPPDATA"],
    APPDATA: process.env["APPDATA"]
};

process.env["HOME"] = isolatedHome;
process.env["XDG_DATA_HOME"] = path.join(isolatedHome, ".local", "share");
process.env["LOCALAPPDATA"] = path.join(isolatedHome, "AppData", "Local");
process.env["APPDATA"] = path.join(isolatedHome, "AppData", "Roaming");

const { writeDaemonState, readAllDaemonStates, deleteDaemonState, getAliveDaemonStates, pruneStaleStates } = await import(
    "../../dist/common-utils/daemon-state.js"
);
const { default: defaults } = await import("../../dist/common-utils/defaults.js");

// Use a PID range that definitely doesn't exist (very large PIDs)
const FAKE_PID_BASE = 9999900;
let fakePidCounter = 0;
const nextFakePid = () => FAKE_PID_BASE + ++fakePidCounter;

const makeState = (pid: number): DaemonState => ({
    pid,
    startedAt: new Date().toISOString(),
    argv: ["--pkcRpcUrl", `ws://localhost:${9000 + pid}`],
    pkcRpcUrl: `ws://localhost:${9000 + pid}`
});

const DAEMON_STATE_MODULE = pathToFileURL(path.join(process.cwd(), "dist", "common-utils", "daemon-state.js")).href;

/**
 * Run `pruneStaleStates()` in a separate process against the machine-global states dir — exactly what
 * a `bitsocial daemon` startup in a parallel test file does (daemon.ts calls it on startup), and what
 * deleted this file's state files mid-test before the dir was isolated (issue #130). Touching the shared
 * dir is safe: it removes only files whose pid is dead, the same best-effort cleanup any daemon does.
 */
const runExternalPrune = async (): Promise<void> => {
    const proc = spawn(process.execPath, ["-e", `import('${DAEMON_STATE_MODULE}').then((m) => m.pruneStaleStates())`], {
        stdio: "ignore",
        env: { ...process.env, ...REAL_DATA_DIR_ENV }
    });
    const [exitCode] = (await once(proc, "close")) as [number | null];
    expect(exitCode).toBe(0);
};

describe("daemon-state", () => {
    const createdPids: number[] = [];

    afterEach(async () => {
        // Clean up any state files we created
        for (const pid of createdPids) {
            await deleteDaemonState(pid);
        }
        createdPids.length = 0;
    });

    describe("writeDaemonState + readAllDaemonStates", () => {
        it("should write and read a state file", async () => {
            const pid = nextFakePid();
            createdPids.push(pid);
            const state = makeState(pid);

            await writeDaemonState(state);
            const all = await readAllDaemonStates();

            const found = all.find((s) => s.pid === pid);
            expect(found).toBeDefined();
            expect(found!.argv).toEqual(state.argv);
            expect(found!.pkcRpcUrl).toBe(state.pkcRpcUrl);
        });

        // Regression test for https://github.com/bitsocialnet/bitsocial-cli/issues/130
        // These tests write state files for synthetic DEAD pids, and the states dir the dist module
        // resolves at import time used to be the machine-global one every daemon shares. Any daemon
        // starting in a parallel test file prunes that dir on startup (daemon.ts -> pruneStaleStates),
        // and a dead pid is exactly what it deletes — so this file's files vanished mid-test. It
        // surfaced on Windows CI, whose slower timing widens the window: "should write multiple state
        // files" failed with `expected [ 9999903 ] to include 9999902`, pid1's file pruned between the
        // two writes and the read.
        it("keeps its own state file when another daemon prunes the shared states dir", async () => {
            const pid = nextFakePid();
            createdPids.push(pid);
            await writeDaemonState(makeState(pid));

            await runExternalPrune();

            const all = await readAllDaemonStates();
            expect(all.map((s) => s.pid)).toContain(pid);
        });

        it("should write multiple state files", async () => {
            const pid1 = nextFakePid();
            const pid2 = nextFakePid();
            createdPids.push(pid1, pid2);

            await writeDaemonState(makeState(pid1));
            await writeDaemonState(makeState(pid2));

            const all = await readAllDaemonStates();
            const pids = all.map((s) => s.pid);
            expect(pids).toContain(pid1);
            expect(pids).toContain(pid2);
        });
    });

    describe("deleteDaemonState", () => {
        it("should delete a state file", async () => {
            const pid = nextFakePid();
            createdPids.push(pid);

            await writeDaemonState(makeState(pid));
            await deleteDaemonState(pid);

            const all = await readAllDaemonStates();
            expect(all.find((s) => s.pid === pid)).toBeUndefined();
        });

        it("should not throw when deleting non-existent state", async () => {
            await expect(deleteDaemonState(nextFakePid())).resolves.not.toThrow();
        });

        // Regression test for https://github.com/bitsocialnet/bitsocial-cli/issues/94
        // On Windows, unlinking a state file that another process still has open (or that is in
        // "delete-pending" state) returns EPERM/EACCES/EBUSY — unlike POSIX, where unlink of an
        // open file succeeds. Concurrent daemons share the global .daemon_states dir and race to
        // prune the same dead-PID file; the loser used to crash daemon startup (pruneStaleStates
        // is awaited unguarded on startup). Pruning is best-effort, so these codes must be swallowed.
        it.each(["EPERM", "EACCES", "EBUSY"])("should not throw when unlink fails with %s (Windows lock race)", async (code) => {
            const err = Object.assign(new Error(`${code}: simulated`), { code });
            const spy = vi.spyOn(fs, "unlink").mockRejectedValueOnce(err);
            try {
                await expect(deleteDaemonState(nextFakePid())).resolves.toBeUndefined();
            } finally {
                spy.mockRestore();
            }
        });

        it("should still propagate an unexpected unlink error", async () => {
            const err = Object.assign(new Error("EIO: simulated"), { code: "EIO" });
            const spy = vi.spyOn(fs, "unlink").mockRejectedValueOnce(err);
            try {
                await expect(deleteDaemonState(nextFakePid())).rejects.toThrow("EIO");
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe("getAliveDaemonStates", () => {
        it("should return only alive PIDs and delete stale files", async () => {
            const stalePid = nextFakePid();
            createdPids.push(stalePid);
            await writeDaemonState(makeState(stalePid));

            // stalePid doesn't exist as a process, so it should be pruned
            const alive = await getAliveDaemonStates();
            expect(alive.find((s) => s.pid === stalePid)).toBeUndefined();

            // The file should have been deleted from disk
            const all = await readAllDaemonStates();
            expect(all.find((s) => s.pid === stalePid)).toBeUndefined();
        });

        it("should return the current process PID as alive", async () => {
            const myPid = process.pid;
            createdPids.push(myPid);
            await writeDaemonState(makeState(myPid));

            const alive = await getAliveDaemonStates();
            expect(alive.find((s) => s.pid === myPid)).toBeDefined();
        });
    });

    // Regression test for https://github.com/bitsocialnet/bitsocial-cli/issues/66
    // A daemon running inside a Docker container (PID 8 in the container's namespace) wrote its
    // state file into the bind-mounted data dir. The container died without graceful shutdown,
    // and on the host PID 8 belongs to a kernel thread — an alive but unrelated process. The
    // bare `process.kill(pid, 0)` liveness check passed, so `update install` SIGINT'd the
    // unrelated process and restarted the daemon twice on the same port.
    //
    // Skipped on Windows: the PID-reuse scenario (issue #66) is a Docker-on-Linux problem
    // (a container PID colliding with a host kernel thread), and the identity check that
    // detects it relies on Unix process introspection (/proc, `ps`) plus Unix tooling
    // (`sleep`, `bash`). On Windows the identity is undeterminable, so the code intentionally
    // degrades to liveness-only — the conservative, safe fallback. There is nothing
    // Windows-specific to assert here.
    describe.skipIf(process.platform === "win32")("getAliveDaemonStates — PID reused by an unrelated process", () => {
        const DAEMON_STATES_DIR = path.join(defaults.PKC_DATA_PATH, ".daemon_states");
        let child: ChildProcess | undefined;

        afterEach(() => {
            child?.kill("SIGKILL");
            child = undefined;
        });

        it("should prune a stale state file whose PID now belongs to a process that is not a bitsocial daemon", async () => {
            // Stand-in for the kernel thread: an alive process that is not a bitsocial daemon
            // and did not write the state file. Wait for 'spawn' so the child has exec'd and
            // /proc/<pid>/cmdline shows `sleep`, not the forked copy of this test process.
            child = spawn("sleep", ["120"]);
            await once(child, "spawn");
            const reusedPid = child.pid;
            expect(reusedPid).toBeDefined();
            createdPids.push(reusedPid!);

            // Write the state file raw, byte-for-byte like the dead daemon left it on prod
            // (legacy format — written by an old CLI version, before any identity fields).
            await fs.mkdir(DAEMON_STATES_DIR, { recursive: true });
            await fs.writeFile(
                path.join(DAEMON_STATES_DIR, `${reusedPid}-daemon.state`),
                JSON.stringify({ pid: reusedPid, startedAt: "2026-05-21T04:01:53.773Z", argv: [], pkcRpcUrl: "ws://localhost:9138/" }, null, 2)
            );

            const alive = await getAliveDaemonStates();
            expect(alive.find((s) => s.pid === reusedPid)).toBeUndefined();

            // The stale file must also be deleted from disk
            const all = await readAllDaemonStates();
            expect(all.find((s) => s.pid === reusedPid)).toBeUndefined();
        });

        it("should prune a state file whose recorded procStartTime does not match the process now under that PID", async () => {
            const myPid = process.pid;
            createdPids.push(myPid);

            // Alive PID, but the recorded start time belongs to a process that no longer exists
            await fs.mkdir(DAEMON_STATES_DIR, { recursive: true });
            await fs.writeFile(
                path.join(DAEMON_STATES_DIR, `${myPid}-daemon.state`),
                JSON.stringify({ pid: myPid, startedAt: new Date().toISOString(), argv: [], pkcRpcUrl: "ws://localhost:9138/", procStartTime: "0" }, null, 2)
            );

            const alive = await getAliveDaemonStates();
            expect(alive.find((s) => s.pid === myPid)).toBeUndefined();
        });

        it("should keep a legacy state file (no procStartTime) when the PID is a real bitsocial daemon process", async () => {
            // Stand-in for a daemon started by an old CLI version: an alive process whose
            // command line references bitsocial. The compound command (`; sleep 0`) stops bash
            // from exec-replacing itself with `sleep`, which would drop the marker from cmdline.
            child = spawn("bash", ["-c", "sleep 120; sleep 0", "bitsocial-daemon-legacy-test"]);
            await once(child, "spawn");
            const daemonPid = child.pid;
            expect(daemonPid).toBeDefined();
            createdPids.push(daemonPid!);

            await fs.mkdir(DAEMON_STATES_DIR, { recursive: true });
            await fs.writeFile(
                path.join(DAEMON_STATES_DIR, `${daemonPid}-daemon.state`),
                JSON.stringify({ pid: daemonPid, startedAt: new Date().toISOString(), argv: [], pkcRpcUrl: "ws://localhost:9138/" }, null, 2)
            );

            const alive = await getAliveDaemonStates();
            expect(alive.find((s) => s.pid === daemonPid)).toBeDefined();
        });
    });

    describe("pruneStaleStates", () => {
        it("should remove state files for dead PIDs", async () => {
            const stalePid = nextFakePid();
            createdPids.push(stalePid);
            await writeDaemonState(makeState(stalePid));

            await pruneStaleStates();

            const all = await readAllDaemonStates();
            expect(all.find((s) => s.pid === stalePid)).toBeUndefined();
        });

        it("should keep state files for alive PIDs", async () => {
            const myPid = process.pid;
            createdPids.push(myPid);
            await writeDaemonState(makeState(myPid));

            await pruneStaleStates();

            const all = await readAllDaemonStates();
            expect(all.find((s) => s.pid === myPid)).toBeDefined();
        });
    });
});
