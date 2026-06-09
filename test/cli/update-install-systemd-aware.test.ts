// `bitsocial update install` must not tear down a daemon that an external supervisor owns (issue #82).
//
// Before the fix, update install stopped EVERY daemon found in the state files (SIGINT + wait) and
// re-spawned it detached — escaping the supervisor and competing with it for the RPC port, which put
// systemd into a restart loop. After the fix, a daemon whose state file records a `supervisor` is left
// running across the update and restarted via that supervisor (`systemctl restart`) instead.
//
// This test pins the safety property end-to-end without a real daemon or npm: a dummy long-lived
// process stands in for the daemon, its state file (seeded in an isolated state dir) marks it
// systemd-managed, and we assert update install leaves it alive. The buggy code would SIGINT it.
//
// Isolation: HOME/XDG_DATA_HOME are overridden for both the state-seeding helper and update install so
// the command sees ONLY this dummy daemon and never touches real daemons on the machine.

import { spawn, spawnSync } from "child_process";
import { describe, it, expect, afterEach } from "vitest";
import { directory as randomDirectory } from "tempy";
import { readFileSync, existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const CLI_VERSION = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf-8")).version as string;
const DAEMON_STATE_MODULE = pathToFileURL(path.join(process.cwd(), "dist", "common-utils", "daemon-state.js")).href;

const isPidAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const runUpdateInstall = (env: Record<string, string>): Promise<{ exitCode: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", "update", "install", CLI_VERSION], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ...env }
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", reject);
        proc.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

describe("bitsocial update install — supervised daemons (issue #82)", () => {
    let dummyDaemon: ReturnType<typeof spawn> | undefined;

    afterEach(() => {
        if (dummyDaemon?.pid && isPidAlive(dummyDaemon.pid)) {
            try {
                process.kill(dummyDaemon.pid, "SIGKILL");
            } catch {
                /* already gone */
            }
        }
        dummyDaemon = undefined;
    });

    it.skipIf(process.platform === "win32")(
        "leaves a systemd-managed daemon running (does not SIGINT it) and restarts it via the supervisor instead",
        { timeout: 60000 },
        async () => {
            const isolatedHome = randomDirectory();
            const env = {
                HOME: isolatedHome,
                XDG_DATA_HOME: path.join(isolatedHome, ".local", "share")
            };

            // A `systemctl` shim that records its invocation instead of restarting anything real.
            const tmpBin = randomDirectory();
            const systemctlMarker = path.join(tmpBin, "systemctl.calls");
            const systemctlShim = path.join(tmpBin, "systemctl");
            await fs.writeFile(systemctlShim, `#!/bin/sh\necho "$@" >> "${systemctlMarker}"\nexit 0\n`);
            await fs.chmod(systemctlShim, 0o755);

            // A `bitsocial` shim recording any detached-daemon spawn. A supervised daemon must NEVER be
            // re-spawned this way (that's the bug). It also keeps the buggy code path from launching a
            // real daemon during the test.
            const bitsocialMarker = path.join(tmpBin, "bitsocial.calls");
            const bitsocialShim = path.join(tmpBin, "bitsocial");
            await fs.writeFile(bitsocialShim, `#!/bin/sh\necho "$@" >> "${bitsocialMarker}"\nexit 0\n`);
            await fs.chmod(bitsocialShim, 0o755);

            // A dummy long-lived process standing in for the daemon. With no SIGINT handler, the buggy
            // code's SIGINT would kill it — so "still alive afterwards" is the red/green discriminator.
            dummyDaemon = spawn("node", ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" });
            await new Promise((r) => setTimeout(r, 200));
            const dummyPid = dummyDaemon.pid!;
            expect(isPidAlive(dummyPid)).toBe(true);

            // Seed the daemon state file in the ISOLATED state dir, marked systemd-managed. Run via a
            // subprocess with the isolated env so the state dir path is derived from that env, and so
            // writeDaemonState records the dummy's real process start time (PID-reuse guard).
            const seed = path.join(tmpBin, "seed-state.mjs");
            await fs.writeFile(
                seed,
                [
                    `const mod = await import(${JSON.stringify(DAEMON_STATE_MODULE)});`,
                    `await mod.writeDaemonState(JSON.parse(process.env.SEED_STATE));`
                ].join("\n")
            );
            const seedResult = spawnSync("node", [seed], {
                env: {
                    ...process.env,
                    ...env,
                    SEED_STATE: JSON.stringify({
                        pid: dummyPid,
                        startedAt: new Date().toISOString(),
                        argv: [],
                        pkcRpcUrl: "ws://localhost:9138",
                        supervisor: { type: "systemd", unit: "bitsocial-test-82.service" }
                    })
                },
                encoding: "utf-8"
            });
            expect(seedResult.status, `seed stderr: ${seedResult.stderr}`).toBe(0);

            // Same-version install: skips npm, but runs the full daemon stop/restart routing.
            const result = await runUpdateInstall({
                ...env,
                PATH: `${tmpBin}:${process.env.PATH}`
            });

            expect(result.exitCode, `update install output:\n${result.stdout}\n${result.stderr}`).toBe(0);

            // The core fix: the supervised daemon was NOT stopped — it's still the same running process.
            expect(isPidAlive(dummyPid), `update install output:\n${result.stdout}\n${result.stderr}`).toBe(true);

            // It must be recognized as supervised (so the updater defers to systemd, never spawns a competitor).
            expect(result.stdout).toContain("managed by systemd (bitsocial-test-82.service)");

            // The supervised daemon must never be re-spawned as a detached `bitsocial daemon` (the bug's
            // root cause — that process escapes the supervisor and competes for the RPC port).
            expect(existsSync(bitsocialMarker), `update install output:\n${result.stdout}\n${result.stderr}`).toBe(false);

            // Same-version is a no-op install, so no service bounce should have been triggered.
            expect(existsSync(systemctlMarker)).toBe(false);
        }
    );
});
