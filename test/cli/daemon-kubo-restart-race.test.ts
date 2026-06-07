// Regression tests for issue #70: races in the daemon's kubo restart/cleanup machinery.
//
// Bug 1 (re-entrant keepKuboUp): the kubo exit handler and the 5s watchdog tick can both
// pass keepKuboUp's re-entrancy guard, because the guard and the pendingKuboStart assignment
// are separated by an await. The second entrant then acts on a stale port-check result.
// Bug 2 (startKuboNode never settles): throws inside its async promise executor (e.g. when
// `ipfs init` fails because a kubo daemon already runs on the repo) become unhandledRejections
// and the returned promise never settles, wedging pendingKuboStart forever and hanging the
// daemon's exit hook (which awaits it).
// Bug 3 (failure path clobbers shared state): the catch around a failed start attempt clears
// kuboProcess/pendingKuboStart unconditionally, orphaning another attempt's healthy kubo so
// nothing kills it on daemon exit.
//
// The PKC_CLI_TEST_KEEPKUBOUP_PORTCHECK_DELAY_MS hook widens the guard->assignment window so
// a watchdog tick deterministically lands inside it (same pattern as PKC_CLI_TEST_IPFS_READY_DELAY_MS).
import { describe, it, expect, afterEach } from "vitest";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { directory as randomDirectory } from "tempy";
import dns from "node:dns";
import path from "path";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    waitForCondition,
    startPkcDaemon,
    ensureKuboNodeStopped
} from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";
import { startKuboNode } from "../../dist/ipfs/startIpfs.js";
dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

// --- Port allocations unique to this file (avoid conflicts with other test files and external processes) ---
const RACE_RPC_URL = `ws://localhost:9548`;
const RACE_KUBO_URL = `http://0.0.0.0:50299/api/v0`;
const RACE_GATEWAY_URL = `http://0.0.0.0:6753`;
const RACE_KUBO_API_URL = `http://localhost:50299/api/v0`;

const SETTLE_KUBO_API_URL = new URL(`http://127.0.0.1:50399/api/v0`);
const SETTLE_GATEWAY_URL = new URL(`http://127.0.0.1:6853`);

const killProcessGroup = (pid: number, signal: NodeJS.Signals) => {
    if (process.platform !== "win32") {
        try {
            process.kill(-pid, signal);
        } catch {
            /* best effort */
        }
    }
    try {
        process.kill(pid, signal);
    } catch {
        /* best effort */
    }
};

describe("daemon kubo restart race (issue #70)", () => {
    it.skipIf(process.platform === "win32")(
        "concurrent keepKuboUp entries must not orphan kubo or hang shutdown",
        { timeout: 120000 },
        async () => {
            let daemonProcess: ManagedChildProcess | undefined;
            try {
                await ensureKuboNodeStopped(RACE_KUBO_API_URL);
                daemonProcess = await startPkcDaemon(
                    ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", RACE_RPC_URL],
                    {
                        KUBO_RPC_URL: RACE_KUBO_URL,
                        IPFS_GATEWAY_URL: RACE_GATEWAY_URL,
                        // Hold every keepKuboUp entry for 7s between its guard and its pendingKuboStart
                        // assignment — guarantees a 5s watchdog tick lands inside the window, so the
                        // restart after the kubo shutdown below is entered twice concurrently.
                        PKC_CLI_TEST_KEEPKUBOUP_PORTCHECK_DELAY_MS: "7000"
                    }
                );
                expect(typeof daemonProcess.pid).toBe("number");

                // Kill kubo out from under the daemon to trigger the restart cycle
                const shutdownRes = await fetch(`${RACE_KUBO_API_URL}/shutdown`, { method: "POST" });
                expect(shutdownRes.status).toBe(200);

                // Restart is delayed ~7s by the hook; wait generously
                const kuboRestarted = await waitForCondition(
                    async () => {
                        try {
                            const res = await fetch(`${RACE_KUBO_API_URL}/bitswap/stat`, { method: "POST" });
                            return res.ok;
                        } catch {
                            return false;
                        }
                    },
                    40000,
                    500
                );
                expect(kuboRestarted).toBe(true);

                // Give the second (watchdog-tick) keepKuboUp entrant time to fail against the
                // already-restarted kubo and corrupt the shared state (bugs 1+3)
                await new Promise((resolve) => setTimeout(resolve, 10000));

                const killed = daemonProcess.kill();
                expect(killed).toBe(true);

                // With the bug, the daemon either hangs in its exit hook (pendingKuboStart stuck
                // on a never-settling start attempt, bug 2)...
                const daemonExited = await waitForCondition(() => {
                    return (daemonProcess?.exitCode ?? null) !== null || (daemonProcess?.signalCode ?? null) !== null;
                }, 30000, 100);
                expect(daemonExited).toBe(true);

                // ...or exits without killing the restarted kubo because the failed second entrant
                // cleared kuboProcess/pendingKuboStart (bug 3) — the orphaned kubo outlives the daemon.
                const kuboStoppedAfterKill = await waitForCondition(
                    async () => {
                        try {
                            const res = await fetch(`${RACE_KUBO_API_URL}/bitswap/stat`, { method: "POST" });
                            return !res.ok;
                        } catch {
                            return true;
                        }
                    },
                    10000,
                    500
                );
                expect(kuboStoppedAfterKill).toBe(true);
            } finally {
                if (daemonProcess) await stopPkcDaemon(daemonProcess);
                await ensureKuboNodeStopped(RACE_KUBO_API_URL);
            }
        }
    );
});

describe("startKuboNode settles on failure (issue #70)", () => {
    let firstKubo: ChildProcessWithoutNullStreams | undefined;

    afterEach(async () => {
        if (firstKubo?.pid) killProcessGroup(firstKubo.pid, "SIGKILL");
        firstKubo = undefined;
        await ensureKuboNodeStopped(SETTLE_KUBO_API_URL.toString().replace(/\/$/, ""));
    });

    it.skipIf(process.platform === "win32")(
        "rejects (instead of never settling) when ipfs init fails because a daemon already runs on the repo",
        { timeout: 90000 },
        async () => {
            const dataPath = randomDirectory();
            // Pre-init the repo with an ephemeral swarm port so parallel test kubos don't collide on 4001
            await preInitKuboWithEphemeralSwarm(path.join(dataPath, ".bitsocial-cli.ipfs"), SETTLE_KUBO_API_URL, SETTLE_GATEWAY_URL);

            // First start: brings up a real kubo daemon that holds the repo lock
            firstKubo = await startKuboNode(SETTLE_KUBO_API_URL, SETTLE_GATEWAY_URL, dataPath);
            expect(typeof firstKubo.pid).toBe("number");

            // Second start on the same repo: `ipfs init` fails with "ipfs daemon is running".
            // The returned promise must settle (reject) — with the bug it never settles and the
            // error escapes as an unhandledRejection instead.
            const secondStart = startKuboNode(SETTLE_KUBO_API_URL, SETTLE_GATEWAY_URL, dataPath);
            const outcome = await Promise.race([
                secondStart.then(
                    () => "resolved",
                    () => "rejected"
                ),
                new Promise<string>((resolve) => setTimeout(() => resolve("never-settled"), 20000))
            ]);
            expect(outcome).toBe("rejected");
        }
    );
});
