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
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "child_process";
import { directory as randomDirectory } from "tempy";
import dns from "node:dns";
import path from "path";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    waitForCondition,
    startPkcDaemonWithDynamicPorts,
    withKuboBindRetry,
    isAddressInUseError,
    ensureKuboNodeStopped
} from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";
import { startKuboNode } from "../../dist/ipfs/startIpfs.js";
dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

// Ports are allocated dynamically per test (issue #87): the hardcoded API ports this file used to
// pin fell inside macOS's ephemeral port range, so under fileParallelism the kernel could hand one
// of them to another test file's outbound socket and kubo's bind would intermittently fail with
// "address already in use". Each test now grabs fresh free ports and retries on the bind race.

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
            let kuboApiUrl: string | undefined;
            try {
                const daemon = await startPkcDaemonWithDynamicPorts(
                    (e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl],
                    // Hold every keepKuboUp entry for 7s between its guard and its pendingKuboStart
                    // assignment — guarantees a 5s watchdog tick lands inside the window, so the
                    // restart after the kubo shutdown below is entered twice concurrently.
                    () => ({ PKC_CLI_TEST_KEEPKUBOUP_PORTCHECK_DELAY_MS: "7000" })
                );
                daemonProcess = daemon.daemonProcess;
                kuboApiUrl = daemon.kuboApiUrl;
                expect(typeof daemonProcess.pid).toBe("number");

                // Kill kubo out from under the daemon to trigger the restart cycle
                const shutdownRes = await fetch(`${kuboApiUrl}/shutdown`, { method: "POST" });
                expect(shutdownRes.status).toBe(200);

                // Restart is delayed ~7s by the hook; wait generously
                const kuboRestarted = await waitForCondition(
                    async () => {
                        try {
                            const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
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
                            const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
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
                if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
            }
        }
    );
});

describe("daemon shutdown with a wedged kubo startup (issue #70, PR #71 review)", () => {
    it.skipIf(process.platform === "win32")(
        "SIGTERM during a kubo start that never completes must not block shutdown unboundedly",
        { timeout: 240000 },
        async () => {
            // Simulate a kubo that spawns and serves its API but whose startKuboNode promise
            // never settles within any reasonable horizon (kubo wedged before "Daemon is ready"
            // from the daemon's point of view): hold the ready acknowledgement for 10 minutes.
            const dataPath = randomDirectory();

            let daemonProcess: ChildProcess | undefined;
            let kuboApiUrl: string | undefined;
            try {
                // startPkcDaemon can't drive this case (the wedged daemon never prints its ready
                // banner), so spawn manually under withKuboBindRetry: on a lost bind race the daemon
                // exits with "address already in use" in its output, which we surface to trigger a
                // retry on fresh ports. preInitKuboWithEphemeralSwarm is idempotent across retries.
                const wedged = await withKuboBindRetry(
                    async (e) => {
                        await preInitKuboWithEphemeralSwarm(
                            path.join(dataPath, ".bitsocial-cli.ipfs"),
                            new URL(e.kuboRpcUrl),
                            new URL(e.gatewayUrl)
                        );
                        const proc = spawn(
                            "node",
                            ["./bin/run", "daemon", "--logPath", randomDirectory(), "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl],
                            {
                                stdio: ["pipe", "pipe", "pipe"],
                                env: {
                                    ...process.env,
                                    KUBO_RPC_URL: e.kuboRpcUrl,
                                    IPFS_GATEWAY_URL: e.gatewayUrl,
                                    PKC_CLI_TEST_IPFS_READY_DELAY_MS: "600000"
                                }
                            }
                        );
                        let output = "";
                        proc.stdout?.on("data", (d) => (output += d.toString()));
                        proc.stderr?.on("data", (d) => (output += d.toString()));

                        // Resolve once kubo serves its API; otherwise throw so withKuboBindRetry can
                        // decide: an "address already in use" message means retry, anything else is real.
                        // On any failure kill THIS attempt's process group (never the port's listener,
                        // which on a same-suite race could be another test's healthy daemon).
                        try {
                            const outcome = await new Promise<"up">((resolve, reject) => {
                                const deadline = Date.now() + 60000;
                                const tick = async () => {
                                    if (proc.exitCode !== null || proc.signalCode !== null)
                                        return reject(new Error(`daemon exited before kubo came up:\n${output}`));
                                    if (isAddressInUseError(output))
                                        return reject(new Error(`kubo lost the bind race: address already in use\n${output}`));
                                    try {
                                        const res = await fetch(`${e.kuboApiUrl}/version`, { method: "POST" });
                                        if (res.ok) return resolve("up");
                                    } catch {
                                        /* not up yet */
                                    }
                                    if (Date.now() > deadline) return reject(new Error(`timed out waiting for kubo API:\n${output}`));
                                    setTimeout(tick, 500);
                                };
                                void tick();
                            });
                            expect(outcome).toBe("up");
                            return proc;
                        } catch (error) {
                            if (proc.pid) killProcessGroup(proc.pid, "SIGKILL");
                            throw error;
                        }
                    }
                );
                daemonProcess = wedged.result;
                kuboApiUrl = wedged.endpoints.kuboApiUrl;
                expect(typeof daemonProcess.pid).toBe("number");

                const killed = daemonProcess.kill();
                expect(killed).toBe(true);

                // Shutdown must reach the kill flow despite the pending start: the daemon should
                // exit well before the exit hook's 120s hard cap force-kills the process.
                const daemonExited = await waitForCondition(() => {
                    return (daemonProcess?.exitCode ?? null) !== null || (daemonProcess?.signalCode ?? null) !== null;
                }, 60000, 100);
                expect(daemonExited).toBe(true);

                const kuboStoppedAfterKill = await waitForCondition(
                    async () => {
                        try {
                            const res = await fetch(`${kuboApiUrl}/version`, { method: "POST" });
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
                if (daemonProcess?.pid && daemonProcess.exitCode === null && daemonProcess.signalCode === null)
                    killProcessGroup(daemonProcess.pid, "SIGKILL");
                if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
            }
        }
    );
});

describe("daemon shutdown with a late signal-exit registrant (issue #70)", () => {
    it.skipIf(process.platform === "win32")(
        "kubo is killed on SIGTERM even when a signal-exit handler registered after the exit hook",
        { timeout: 120000 },
        async () => {
            // Reproduces the CI failure mechanism: a dependency (e.g. @pkcprotocol/proper-lock-file,
            // or the signal-exit copies under ink/restore-cursor) registers a signal-exit handler
            // after the daemon's asyncExitHook. exit-hook uses process.once, so on SIGTERM its
            // listener disappears as soon as it is invoked; signal-exit then sees only its own
            // family left and re-raises the signal, killing the daemon while the async kubo
            // cleanup is still parked — the restarted kubo outlives the daemon.
            let daemonProcess: ManagedChildProcess | undefined;
            let kuboApiUrl: string | undefined;
            try {
                const daemon = await startPkcDaemonWithDynamicPorts(
                    (e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl],
                    () => ({
                        PKC_CLI_TEST_SIMULATE_LATE_SIGNAL_EXIT: "1",
                        // Hold the restarted kubo's start promise so SIGTERM lands mid-start,
                        // like the CI failure (SIGTERM 0.4s after the restarted kubo's API came up)
                        PKC_CLI_TEST_IPFS_READY_DELAY_MS: "5000"
                    })
                );
                daemonProcess = daemon.daemonProcess;
                kuboApiUrl = daemon.kuboApiUrl;
                expect(typeof daemonProcess.pid).toBe("number");

                const shutdownRes = await fetch(`${kuboApiUrl}/shutdown`, { method: "POST" });
                expect(shutdownRes.status).toBe(200);

                // This is a setup precondition, not the assertion under test: after /shutdown the
                // daemon must auto-restart kubo before we can verify it dies on SIGTERM. The detect
                // window must absorb the injected PKC_CLI_TEST_IPFS_READY_DELAY_MS (5s) plus restart
                // time on a heavily-loaded CI runner — locally this lands in ~13s, but ubuntu CI has
                // been observed taking >30s, so widen to 60s (well within the test's 120s cap, issue #77).
                const kuboRestarted = await waitForCondition(
                    async () => {
                        try {
                            const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
                            return res.ok;
                        } catch {
                            return false;
                        }
                    },
                    60000,
                    500
                );
                expect(kuboRestarted).toBe(true);

                const killed = daemonProcess.kill();
                expect(killed).toBe(true);

                const daemonExited = await waitForCondition(() => {
                    return (daemonProcess?.exitCode ?? null) !== null || (daemonProcess?.signalCode ?? null) !== null;
                }, 30000, 100);
                expect(daemonExited).toBe(true);

                const kuboStoppedAfterKill = await waitForCondition(
                    async () => {
                        try {
                            const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
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
                if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
            }
        }
    );
});

describe("startKuboNode settles on failure (issue #70)", () => {
    let firstKubo: ChildProcessWithoutNullStreams | undefined;
    let settleKuboApiUrl: string | undefined;

    afterEach(async () => {
        if (firstKubo?.pid) killProcessGroup(firstKubo.pid, "SIGKILL");
        firstKubo = undefined;
        if (settleKuboApiUrl) await ensureKuboNodeStopped(settleKuboApiUrl);
        settleKuboApiUrl = undefined;
    });

    it.skipIf(process.platform === "win32")(
        "rejects (instead of never settling) when ipfs init fails because a daemon already runs on the repo",
        { timeout: 90000 },
        async () => {
            const dataPath = randomDirectory();

            // First start: bring up a real kubo daemon that holds the repo lock, retrying on fresh
            // ports if it loses the bind race (issue #87). preInit (idempotent) seeds an ephemeral
            // swarm port so parallel test kubos don't collide on 4001.
            const first = await withKuboBindRetry(async (e) => {
                const apiUrl = new URL(e.kuboRpcUrl);
                const gatewayUrl = new URL(e.gatewayUrl);
                await preInitKuboWithEphemeralSwarm(path.join(dataPath, ".bitsocial-cli.ipfs"), apiUrl, gatewayUrl);
                return startKuboNode(apiUrl, gatewayUrl, dataPath);
            });
            firstKubo = first.result;
            settleKuboApiUrl = first.endpoints.kuboApiUrl;
            expect(typeof firstKubo.pid).toBe("number");

            // Second start on the same repo: it must settle (reject) — `ipfs init` bails because the
            // config exists and the running daemon holds the repo lock. With the bug it never settles
            // and the error escapes as an unhandledRejection instead.
            const secondStart = startKuboNode(new URL(first.endpoints.kuboRpcUrl), new URL(first.endpoints.gatewayUrl), dataPath);
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
