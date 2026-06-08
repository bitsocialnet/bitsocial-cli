import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { once } from "events";
import { directory as randomDirectory } from "tempy";
import defaults from "../../dist/common-utils/defaults.js";

// We test the functions by importing them, but they use a hardcoded DAEMON_STATES_DIR.
// To isolate tests, we test the logic directly with a custom dir via the module internals.
// Since the module uses a fixed path, we'll test by writing/reading actual state files
// in the real states dir, then cleaning up.

// Import the actual functions
import {
    writeDaemonState,
    readAllDaemonStates,
    deleteDaemonState,
    getAliveDaemonStates,
    pruneStaleStates
} from "../../dist/common-utils/daemon-state.js";
import type { DaemonState } from "../../dist/common-utils/daemon-state.js";

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
    describe("getAliveDaemonStates — PID reused by an unrelated process", () => {
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
