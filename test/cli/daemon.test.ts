// This file is to test root commands like `bitsocial daemon` or `bitsocial get`, whereas commands like `bitsocial community start` are considered nested
import { ChildProcess, spawn } from "child_process";
import net from "net";
import { describe, it, beforeAll, beforeEach, afterAll, afterEach, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import WebSocket from "ws";
import { path as kuboExePathFunc } from "kubo";
import fsPromise from "fs/promises";
import path from "path";
import dns from "node:dns";
import {
    type ManagedChildProcess,
    killChildProcess,
    stopPkcDaemon,
    waitForCondition,
    startPkcDaemon,
    startPkcDaemonWithDynamicPorts,
    allocateFreePort,
    allocateKuboEndpoints,
    ensureKuboNodeStopped,
    waitForWebSocketOpen,
    waitForKuboReady,
    waitForPortFree
} from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";
dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

// Ports are allocated dynamically per test (issue #87): the API ports this file used to pin fell in
// macOS's ephemeral range, so under fileParallelism another test file's outbound socket could grab
// one and kubo's bind would intermittently fail. Happy-path daemons retry on the bind race; the
// negative blocks below allocate fresh free ports but must NOT retry (they assert failure / adoption
// on a specific port), so they keep using startPkcDaemon / runPkcDaemonExpectFailure directly.

const testConnectionToPkcRpc = async (rpcServerPort: number | string) => {
    const rpcClient = new WebSocket(`ws://localhost:${rpcServerPort}`);
    await waitForWebSocketOpen(rpcClient);
    expect(rpcClient.readyState).toBe(1); // 1 = connected
    rpcClient.close();
};

const occupyPort = async (port: number, host: string) => {
    const server = net.createServer();
    server.on("connection", (socket) => {
        socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
    });
    return server;
};

const startPkcDaemonCapturingStderr = (args: string[], env?: Record<string, string>): Promise<ManagedChildProcess> => {
    return new Promise(async (resolve, reject) => {
        const hasCustomDataPath = args.some((arg) => arg.startsWith("--pkcOptions.dataPath"));
        const hasCustomLogPath = args.some((arg) => arg === "--logPath");
        const logPathArgs = hasCustomLogPath ? [] : ["--logPath", randomDirectory()];
        const dataPath = hasCustomDataPath
            ? (args[args.findIndex((a) => a.startsWith("--pkcOptions.dataPath")) + 1] as string)
            : randomDirectory();
        const daemonArgs = hasCustomDataPath ? args : ["--pkcOptions.dataPath", dataPath, ...args];

        // Pre-init kubo with an ephemeral swarm port (like startPkcDaemon) so this daemon doesn't
        // bind swarm 4001 — otherwise a kubo lingering from a previous test (on Windows, where the
        // daemon's kill doesn't take kubo with it) collides on 4001 with the next daemon (issue #87).
        if (env?.KUBO_RPC_URL && env?.IPFS_GATEWAY_URL) {
            try {
                await preInitKuboWithEphemeralSwarm(path.join(dataPath, ".bitsocial-cli.ipfs"), new URL(env.KUBO_RPC_URL), new URL(env.IPFS_GATEWAY_URL));
            } catch (error) {
                return reject(error);
            }
        }

        const daemonProcess = spawn("node", ["./bin/run", "daemon", ...logPathArgs, ...daemonArgs], {
            stdio: ["pipe", "pipe", "pipe"],
            env: env ? { ...process.env, ...env } : undefined
        }) as ManagedChildProcess;

        daemonProcess.capturedStdout = "";
        daemonProcess.capturedStderr = "";
        const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
            reject(
                `spawnAsync process '${daemonProcess.pid}' exited with code '${exitCode}' signal '${signal}'\nstdout: ${daemonProcess.capturedStdout}\nstderr: ${daemonProcess.capturedStderr}`
            );
        };
        const onError = (error: Error) => {
            daemonProcess.stdout!.off("data", onStdoutData);
            daemonProcess.stderr!.off("data", onStderrData);
            daemonProcess.off("exit", onExit);
            daemonProcess.off("error", onError);
            reject(error);
        };
        const onStderrData = (data: Buffer) => {
            daemonProcess.capturedStderr += data.toString();
        };
        const onStdoutData = (data: Buffer) => {
            const output = data.toString();
            daemonProcess.capturedStdout += output;
            // Capture the kubo RPC URL so stopPkcDaemon can /shutdown kubo afterwards (matches startPkcDaemon).
            const kuboConfigMatch = output.match(/kuboRpcClientsOptions:\s*\[\s*'([^']+)'/);
            if (!daemonProcess.kuboRpcUrl && kuboConfigMatch?.[1]) {
                try {
                    daemonProcess.kuboRpcUrl = new URL(kuboConfigMatch[1]);
                } catch {
                    /* ignore parse errors */
                }
            }
            if (output.match("Communities in data path")) {
                daemonProcess.stdout!.off("data", onStdoutData);
                daemonProcess.off("exit", onExit);
                daemonProcess.off("error", onError);
                resolve(daemonProcess);
            }
        };

        daemonProcess.on("exit", onExit);
        daemonProcess.stdout!.on("data", onStdoutData);
        daemonProcess.stderr!.on("data", onStderrData);
        daemonProcess.on("error", onError);
    });
};

const startKuboDaemon = async (kuboApiPort: number): Promise<ChildProcess> => {
    const ipfsPath = randomDirectory();
    const env = { ...process.env, IPFS_PATH: ipfsPath };

    // Init the repo first
    const { execFileSync } = await import("child_process");
    execFileSync(kuboExePathFunc(), ["init"], { env, stdio: "ignore" });

    // Configure API address via config file (--api-addr is removed in newer kubo)
    const configPath = path.join(ipfsPath, "config");
    const config = JSON.parse(await fsPromise.readFile(configPath, "utf-8"));
    config.Addresses.API = `/ip4/127.0.0.1/tcp/${kuboApiPort}`;
    // Use random ports for gateway and swarm to avoid conflicts
    config.Addresses.Gateway = `/ip4/127.0.0.1/tcp/0`;
    config.Addresses.Swarm = ["/ip4/0.0.0.0/tcp/0", "/ip6/::/tcp/0"];
    await fsPromise.writeFile(configPath, JSON.stringify(config, null, 2));

    return new Promise((resolve, reject) => {
        const daemonProcess = spawn(kuboExePathFunc(), ["daemon", "--migrate"], {
            stdio: ["pipe", "pipe", "inherit"],
            env
        });

        daemonProcess.on("exit", (exitCode, signal) => {
            reject(`spawnAsync process '${daemonProcess.pid}' exited with code '${exitCode}' signal '${signal}'`);
        });
        daemonProcess.stdout.on("data", (data) => {
            const output = data.toString();
            console.log(`kubo daemon log`, output);
            if (output.match("Daemon is ready")) {
                daemonProcess.removeAllListeners();
                resolve(daemonProcess);
            }
        });
        daemonProcess.on("error", (data) => {
            console.error(`Failed to start kubo daemon`, String(data));
            reject(data);
        });
    });
};

const runPkcDaemonExpectFailure = (args: string[], envOverrides?: Record<string, string>, timeoutMs = 60000) => {
    return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const hasCustomDataPath = args.some((arg) => arg.startsWith("--pkcOptions.dataPath"));
        const hasCustomLogPath = args.some((arg) => arg === "--logPath");
        const logPathArgs = hasCustomLogPath ? [] : ["--logPath", randomDirectory()];
        const daemonArgs = hasCustomDataPath ? args : ["--pkcOptions.dataPath", randomDirectory(), ...args];

        const daemonProcess = spawn("node", ["./bin/run", "daemon", ...logPathArgs, ...daemonArgs], {
            stdio: ["ignore", "pipe", "pipe"],
            env: envOverrides ? { ...process.env, ...envOverrides } : undefined
        });

        let stdout = "";
        let stderr = "";
        const cleanup = () => {
            daemonProcess.stdout?.removeListener("data", onStdout);
            daemonProcess.stderr?.removeListener("data", onStderr);
            daemonProcess.removeListener("exit", onExit);
            daemonProcess.removeListener("error", onError);
            clearTimeout(timer);
        };

        const onStdout = (data: Buffer) => {
            stdout += data.toString();
        };
        const onStderr = (data: Buffer) => {
            stderr += data.toString();
        };
        const onExit = (code: number | null) => {
            cleanup();
            resolve({ exitCode: code, stdout, stderr });
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };

        const timer = setTimeout(() => {
            daemonProcess.kill("SIGKILL");
            cleanup();
            reject(new Error("Timed out waiting for bitsocial daemon to exit"));
        }, timeoutMs);

        daemonProcess.stdout?.on("data", onStdout);
        daemonProcess.stderr?.on("data", onStderr);
        daemonProcess.on("exit", onExit);
        daemonProcess.on("error", onError);
    });
};

describe("bitsocial daemon (kubo daemon is started by bitsocial-cli)", async () => {
    let daemonProcess: ManagedChildProcess;
    let kuboApiUrl: string;
    let rpcWsUrl: string;
    let rpcPort: number;

    beforeAll(async () => {
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        kuboApiUrl = daemon.kuboApiUrl;
        rpcWsUrl = daemon.rpcWsUrl;
        rpcPort = daemon.rpcPort;
        expect(typeof daemonProcess.pid).toBe("number");
        expect(daemonProcess.killed).toBe(false);
    });

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await waitForPortFree(rpcPort, "localhost", 10000);
    });

    it(`PKC RPC server is started`, async () => {
        const rpcClient = new WebSocket(rpcWsUrl);
        await waitForWebSocketOpen(rpcClient);
        expect(rpcClient.readyState).toBe(1); // 1 = connected
        rpcClient.close();
    });

    it(`Kubo API is started`, { timeout: 60000 }, async () => {
        const kuboReady = await waitForKuboReady(kuboApiUrl, 45000);
        expect(kuboReady).toBe(true);
    });

    [1, 2].map((tryNumber) =>
        it(`Kubo Node is restarted after failing for ${tryNumber}st time`, async () => {
            const shutdownRes = await fetch(`${kuboApiUrl}/shutdown`, {
                method: "POST"
            });
            expect(shutdownRes.status).toBe(200);
            // Wait for kubo to actually shut down after acknowledging the shutdown request
            await waitForCondition(async () => {
                try {
                    await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return false; // still responding
                } catch {
                    return true; // connection refused — kubo is down
                }
            }, 10000, 100);

            // Try to connect to kubo node every 100ms with proper cleanup
            await new Promise<void>((resolve, reject) => {
                let resolved = false;
                const timeOut = setInterval(async () => {
                    if (resolved) return;
                    try {
                        const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
                        if (res.ok && !resolved) {
                            resolved = true;
                            clearInterval(timeOut);
                            resolve();
                        }
                    } catch {
                        // Connection refused - keep trying
                    }
                }, 100);

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        clearInterval(timeOut);
                        reject(new Error("Timeout waiting for kubo node to restart"));
                    }
                }, 30000);
            });

            // kubo node should be running right now
            await expect(fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" })).resolves.toBeDefined();
        })
    );

    it(`kubo node is killed after killing pkc daemon`, async () => {
        expect(daemonProcess.kill()).toBe(true);
        await stopPkcDaemon(daemonProcess);

        // Wait for RPC to become unreachable
        const rpcClient = new WebSocket(rpcWsUrl);
        const connected = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 5000);
            rpcClient.once("open", () => {
                clearTimeout(timer);
                resolve(true);
            });
            rpcClient.once("error", () => {
                clearTimeout(timer);
                resolve(false);
            });
        });

        // WebSocket should not be in OPEN (1) state
        expect(connected).toBe(false);
        rpcClient.close();

        await ensureKuboNodeStopped(kuboApiUrl);
    });
});

describe("bitsocial daemon port availability validation", () => {
    // Freshly allocated free ports per test (issue #87). These tests assert the daemon FAILS when a
    // configured port is occupied, so they must point the daemon at exactly these ports with no retry.
    let validationRpcPort: number;
    let validationKuboPort: number;
    let validationGatewayPort: number;
    let validationRpcUrl: string;
    let validationKuboUrl: string;
    let validationGatewayUrl: string;

    beforeEach(async () => {
        const e = await allocateKuboEndpoints();
        validationRpcPort = e.rpcPort;
        validationKuboPort = e.kuboPort;
        validationGatewayPort = e.gatewayPort;
        validationRpcUrl = e.rpcWsUrl;
        validationKuboUrl = e.kuboRpcUrl;
        validationGatewayUrl = e.gatewayUrl;
    });

    const occupiedServers: net.Server[] = [];
    const cleanupServers = async () => {
        while (occupiedServers.length) {
            const server = occupiedServers.pop();
            if (!server) continue;
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        }
    };

    afterEach(async () => {
        await cleanupServers();
    });

    const expectFailureForOccupiedPort = async (
        port: number,
        host: string,
        expectedMessageFragment: RegExp | string,
        envOverrides: Record<string, string>,
        shouldSkip?: () => boolean
    ) => {
        let server: net.Server;
        try {
            server = await occupyPort(port, host);
        } catch (error) {
            if (shouldSkip && (error as NodeJS.ErrnoException)?.code === "EPERM") {
                return; // Skip this test
            }
            throw error;
        }
        occupiedServers.push(server);

        const result = await runPkcDaemonExpectFailure(
            ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", validationRpcUrl],
            envOverrides
        );
        expect(result.exitCode).not.toBe(0);
        const combinedOutput = `${result.stdout}\n${result.stderr}`;
        if (expectedMessageFragment instanceof RegExp) expect(combinedOutput).toMatch(expectedMessageFragment);
        else expect(combinedOutput).toContain(expectedMessageFragment);
    };

    it("fails when IPFS API port is already in use", { timeout: 90000 }, async () => {
        await expectFailureForOccupiedPort(
            validationKuboPort,
            "0.0.0.0",
            "IPFS API port",
            { KUBO_RPC_URL: validationKuboUrl, IPFS_GATEWAY_URL: validationGatewayUrl },
            () => true
        );
    });

    it("fails when IPFS Gateway port is already in use", { timeout: 90000 }, async () => {
        await expectFailureForOccupiedPort(
            validationGatewayPort,
            "0.0.0.0",
            "IPFS Gateway port",
            { KUBO_RPC_URL: validationKuboUrl, IPFS_GATEWAY_URL: validationGatewayUrl },
            () => true
        );
    });

    it("fails when PKC RPC port is already in use", { timeout: 60000 }, async () => {
        const server = await occupyPort(validationRpcPort, "localhost");
        occupiedServers.push(server);

        const result = await runPkcDaemonExpectFailure(
            ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", validationRpcUrl],
            { KUBO_RPC_URL: validationKuboUrl, IPFS_GATEWAY_URL: validationGatewayUrl }
        );
        expect(result.exitCode).not.toBe(0);
        const combinedOutput = `${result.stdout}\n${result.stderr}`;
        expect(combinedOutput).toContain("PKC RPC port is already in use");
        expect(combinedOutput).toContain(String(validationRpcPort));
        expect(combinedOutput).toContain("--pkcRpcUrl");
    });
});

describe("bitsocial daemon kubo restart cleanup", async () => {
    // On Windows, process.kill() calls TerminateProcess() which instantly kills the daemon
    // without running exit hooks (asyncExitHook/process.on("exit")), so the daemon has no
    // opportunity to clean up kubo. On Unix, SIGTERM is caught by the exit hook which runs
    // killKuboProcess(). The normal user path (Ctrl+C/SIGINT) works on all platforms.
    it.skipIf(process.platform === "win32")("stops kubo when daemon exits during a restart cycle", { timeout: 120000 }, async () => {
        const previousDelay = process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"];
        process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"] = "5000";

        // Explicit logPath so the daemon's DEBUG log files can be dumped if the test fails (issue #70)
        const cleanupLogDir = randomDirectory();
        let daemonProcess: ManagedChildProcess | undefined;
        let cleanupKuboApiUrl: string | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts((e) => [
                "--logPath",
                cleanupLogDir,
                "--pkcOptions.dataPath",
                randomDirectory(),
                "--pkcRpcUrl",
                e.rpcWsUrl
            ]);
            daemonProcess = daemon.daemonProcess;
            cleanupKuboApiUrl = daemon.kuboApiUrl;
            expect(typeof daemonProcess.pid).toBe("number");

            // Diagnostics for the flaky-on-CI failures (issue #70/#77): the daemon's DEBUG output is
            // redirected to its log files (not stderr), so dump those — they show which kubo pids were
            // spawned, restarted and killed, and crucially the timing. Without this the CI log only
            // contains the bare assertion. Fired on BOTH precondition failures below.
            const dumpDiagnostics = async (reason: string) => {
                const proc = daemonProcess!;
                const tail = (text: string | undefined, lines: number) => (text ?? "").split("\n").slice(-lines).join("\n");
                console.log(`[restart-cleanup diagnostics] ${reason}`);
                console.log(`[restart-cleanup diagnostics] daemon exitCode=${proc.exitCode} signalCode=${proc.signalCode}`);
                console.log(`[restart-cleanup diagnostics] daemon stdout tail:\n${tail(proc.capturedStdout, 40)}`);
                console.log(`[restart-cleanup diagnostics] daemon stderr tail:\n${tail(proc.capturedStderr, 60)}`);
                for (const logFile of await fsPromise.readdir(cleanupLogDir).catch(() => [] as string[])) {
                    const content = await fsPromise.readFile(path.join(cleanupLogDir, logFile), "utf-8").catch(() => "");
                    console.log(`[restart-cleanup diagnostics] log file ${logFile} tail:\n${tail(content, 250)}`);
                }
            };

            const shutdownRes = await fetch(`${cleanupKuboApiUrl}/shutdown`, { method: "POST" });
            expect(shutdownRes.status).toBe(200);

            // Setup precondition (not the assertion under test): after /shutdown the daemon must
            // auto-restart kubo before we can verify it dies on SIGTERM. The detect window must absorb
            // the injected PKC_CLI_TEST_IPFS_READY_DELAY_MS (5s) plus restart under CI contention —
            // test files run in parallel forks (fileParallelism) and a 2-vCPU ubuntu runner spawns many
            // kubo nodes concurrently, so restart that lands in ~13s locally was observed taking >20s on
            // CI (the old window). Widened to 45s; the test timeout was raised to 120s to match. If it
            // still fails, dumpDiagnostics() prints the daemon's kubo restart timeline (issue #77).
            const kuboRestarted = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${cleanupKuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return res.ok;
                } catch {
                    return false;
                }
            }, 45000, 500);
            if (!kuboRestarted) await dumpDiagnostics(`kubo did not come back up on ${cleanupKuboApiUrl} within the restart window`);
            expect(kuboRestarted).toBe(true);

            const killed = daemonProcess.kill();
            expect(killed).toBe(true);

            const daemonExited = await waitForCondition(() => {
                return (daemonProcess?.exitCode ?? null) !== null || (daemonProcess?.signalCode ?? null) !== null;
            }, 30000, 100);
            expect(daemonExited).toBe(true);

            const kuboStoppedAfterKill = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${cleanupKuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return !res.ok;
                } catch {
                    return true;
                }
            }, 10000, 500);
            if (!kuboStoppedAfterKill) await dumpDiagnostics(`kubo still responding on ${cleanupKuboApiUrl} after daemon exit`);
            expect(kuboStoppedAfterKill).toBe(true);
        } finally {
            if (daemonProcess) await stopPkcDaemon(daemonProcess);
            if (previousDelay === undefined) delete process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"];
            else process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"] = previousDelay;
            if (cleanupKuboApiUrl) await ensureKuboNodeStopped(cleanupKuboApiUrl);
        }
    });
});

describe(`bitsocial daemon (kubo daemon is started by another process on the same port that bitsocial-cli is using)`, async () => {
    let kuboDaemonProcess: ChildProcess | undefined;
    // Freshly allocated free ports (issue #87). The external kubo and the bitsocial daemon must agree
    // on extKuboPort, so it's fixed for the suite (no retry) but allocated dynamically to dodge the
    // macOS ephemeral-range collision the old hardcoded 50139 was prone to.
    let extKuboPort: number;
    let extKuboRpcUrl: URL;
    let extRpcUrl: string;
    let extGatewayUrl: string;

    beforeAll(async () => {
        extKuboPort = await allocateFreePort();
        extKuboRpcUrl = new URL(`http://127.0.0.1:${extKuboPort}/api/v0`);
        extRpcUrl = `ws://localhost:${await allocateFreePort()}`;
        extGatewayUrl = `http://0.0.0.0:${await allocateFreePort()}`;
        await ensureKuboNodeStopped(extKuboRpcUrl.toString());
        kuboDaemonProcess = await startKuboDaemon(extKuboPort);
        const res = await fetch(`http://localhost:${extKuboPort}/api/v0/bitswap/stat`, { method: "POST" });
        expect(res.status).toBe(200);
    });

    afterAll(async () => {
        await killChildProcess(kuboDaemonProcess);
    });

    it(`bitsocial daemon can use a kubo node started by another program`, async () => {
        let pkcDaemonProcess: ManagedChildProcess | undefined;
        try {
            pkcDaemonProcess = await startPkcDaemon(
                [
                    "--pkcOptions.dataPath",
                    randomDirectory(),
                    "--pkcOptions.kuboRpcClientsOptions[0]",
                    extKuboRpcUrl.toString(),
                    "--pkcRpcUrl",
                    extRpcUrl
                ],
                { KUBO_RPC_URL: extKuboRpcUrl.toString(), IPFS_GATEWAY_URL: extGatewayUrl }
            );
            const rpcClient = new WebSocket(extRpcUrl);
            await waitForWebSocketOpen(rpcClient);
            expect(rpcClient.readyState).toBe(1); // 1 = connected
            rpcClient.close();
        } finally {
            await stopPkcDaemon(pkcDaemonProcess);
        }
    });

    it(`bitsocial daemon monitors Kubo RPC started by another process, and start a new Kubo process if needed`, async () => {
        let pkcDaemonProcess: ManagedChildProcess | undefined;
        try {
            pkcDaemonProcess = await startPkcDaemon(
                [
                    "--pkcOptions.dataPath",
                    randomDirectory(),
                    "--pkcOptions.kuboRpcClientsOptions[0]",
                    extKuboRpcUrl.toString(),
                    "--pkcRpcUrl",
                    extRpcUrl
                ],
                { KUBO_RPC_URL: extKuboRpcUrl.toString(), IPFS_GATEWAY_URL: extGatewayUrl }
            ); // should use kuboDaemonProcess
            const rpcClient = new WebSocket(extRpcUrl);
            await waitForWebSocketOpen(rpcClient);
            expect(rpcClient.readyState).toBe(1); // 1 = connected

            await killChildProcess(kuboDaemonProcess);

            // pkc daemon should start a new kubo daemon
            const kuboRestarted = await waitForCondition(async () => {
                try {
                    const res = await fetch(`http://localhost:${extKuboPort}/api/v0/bitswap/stat`, { method: "POST" });
                    return res.ok;
                } catch {
                    return false;
                }
            }, 30000, 500);
            expect(kuboRestarted).toBe(true);
        } finally {
            await stopPkcDaemon(pkcDaemonProcess);
        }
    });

    it(`bitsocial daemon restarts kubo even when port lingers briefly after external kubo dies`, async () => {
        // Ensure previous test's daemon-managed kubo is fully shut down.
        // On Windows there is no process-group kill, so kubo may outlive the daemon briefly.
        await ensureKuboNodeStopped(extKuboRpcUrl.toString());
        await waitForPortFree(extKuboPort, "127.0.0.1", 15000);

        // Restart external kubo for this test (previous test killed it)
        kuboDaemonProcess = await startKuboDaemon(extKuboPort);

        let pkcDaemonProcess: ManagedChildProcess | undefined;
        try {
            pkcDaemonProcess = await startPkcDaemon(
                [
                    "--pkcOptions.dataPath",
                    randomDirectory(),
                    "--pkcOptions.kuboRpcClientsOptions[0]",
                    extKuboRpcUrl.toString(),
                    "--pkcRpcUrl",
                    extRpcUrl
                ],
                { KUBO_RPC_URL: extKuboRpcUrl.toString(), IPFS_GATEWAY_URL: extGatewayUrl }
            );
            const rpcClient = new WebSocket(extRpcUrl);
            await waitForWebSocketOpen(rpcClient);
            expect(rpcClient.readyState).toBe(1);
            rpcClient.close();

            // Kill external kubo, then immediately occupy the port with a dummy server
            // to simulate TCP TIME_WAIT (port taken but no healthy kubo)
            await killChildProcess(kuboDaemonProcess);
            kuboDaemonProcess = undefined;
            const portBlocker = await occupyPort(extKuboPort, "127.0.0.1");

            // Hold the port for 8s — enough for at least one keepKuboUp() interval tick
            // to encounter the port-taken-but-unhealthy state
            await new Promise((resolve) => setTimeout(resolve, 8000));
            await new Promise<void>((resolve) => portBlocker.close(() => resolve()));

            // Daemon should recover and start a new kubo once the port is free
            const kuboRestarted = await waitForCondition(
                async () => {
                    try {
                        const res = await fetch(`http://localhost:${extKuboPort}/api/v0/bitswap/stat`, { method: "POST" });
                        return res.ok;
                    } catch {
                        return false;
                    }
                },
                30000,
                500
            );
            expect(kuboRestarted).toBe(true);
        } finally {
            await stopPkcDaemon(pkcDaemonProcess);
        }
    });
});

describe("bitsocial daemon survives transient port occupation after its own kubo exits", () => {
    it("daemon does not crash when kubo port is occupied right after kubo exits", { timeout: 90000 }, async () => {
        let pkcDaemonProcess: ManagedChildProcess | undefined;
        let exitKuboPort: number | undefined;
        let exitKuboApiUrl: string | undefined;
        let exitRpcUrl: string | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl]);
            pkcDaemonProcess = daemon.daemonProcess;
            exitKuboPort = daemon.kuboPort;
            exitKuboApiUrl = daemon.kuboApiUrl;
            exitRpcUrl = daemon.rpcWsUrl;

            // Verify kubo is healthy
            const kuboReady = await waitForKuboReady(exitKuboApiUrl, 45000);
            expect(kuboReady).toBe(true);

            // Shut down kubo via API and wait for it to actually stop
            const shutdownRes = await fetch(`${exitKuboApiUrl}/shutdown`, { method: "POST" });
            expect(shutdownRes.status).toBe(200);
            await waitForCondition(async () => {
                try {
                    await fetch(`${exitKuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return false;
                } catch {
                    return true; // connection refused — kubo is down
                }
            }, 10000, 100);

            // Immediately occupy the kubo API port with a dummy server.
            // This triggers onKuboExit → keepKuboUp() which sees port-taken + not-healthy
            // and throws. Without try/catch in onKuboExit, this crashes the daemon.
            const portBlocker = await occupyPort(exitKuboPort, "127.0.0.1");

            // Hold port for 8s — long enough for onKuboExit + at least one interval tick
            await new Promise((resolve) => setTimeout(resolve, 8000));

            // Daemon must still be alive — verify via WebSocket to its RPC
            const rpcClient = new WebSocket(exitRpcUrl);
            await waitForWebSocketOpen(rpcClient);
            expect(rpcClient.readyState).toBe(1);
            rpcClient.close();

            // Release the port
            await new Promise<void>((resolve) => portBlocker.close(() => resolve()));

            // Daemon should recover and start a new kubo
            const kuboRestarted = await waitForCondition(
                async () => {
                    try {
                        const res = await fetch(`${exitKuboApiUrl}/bitswap/stat`, { method: "POST" });
                        return res.ok;
                    } catch {
                        return false;
                    }
                },
                30000,
                500
            );
            expect(kuboRestarted).toBe(true);
        } finally {
            await stopPkcDaemon(pkcDaemonProcess);
            if (exitKuboApiUrl) await ensureKuboNodeStopped(exitKuboApiUrl);
        }
    });
});

describe(`bitsocial daemon --pkcRpcUrl`, async () => {
    it(`A bitsocial daemon should be change where to listen URL`, async () => {
        let firstRpcProcess: ManagedChildProcess | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcRpcUrl", e.rpcWsUrl]);
            firstRpcProcess = daemon.daemonProcess;
            await testConnectionToPkcRpc(daemon.rpcPort);
        } finally {
            await stopPkcDaemon(firstRpcProcess);
        }
    });
});

describe(`bitsocial daemon PKC_RPC_AUTH_KEY env var`, async () => {
    it(`daemon uses PKC_RPC_AUTH_KEY when set`, async () => {
        const customAuthKey = "my-test-auth-key-1234567890";
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts(
                (e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl],
                () => ({ PKC_RPC_AUTH_KEY: customAuthKey })
            );
            daemonProcess = daemon.daemonProcess;
            expect(daemonProcess.capturedStdout).toContain(customAuthKey);
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });
});

describe(`bitsocial daemon KUBO_RPC_URL env var`, async () => {
    it(`daemon uses KUBO_RPC_URL env var to configure kubo bind address`, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl]);
            daemonProcess = daemon.daemonProcess;
            // Kubo should be reachable on the port configured via the injected KUBO_RPC_URL env var
            const res = await fetch(`${daemon.kuboApiUrl}/bitswap/stat`, { method: "POST" });
            expect(res.status).toBe(200);
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });
});

describe(`bitsocial daemon webui`, async () => {
    let daemonProcess: ManagedChildProcess;
    let rpcPort: number;

    beforeAll(async () => {
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        rpcPort = daemon.rpcPort;
    });

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
    });

    it(`5chan webui does not contain the root hash redirect script`, async () => {
        const res = await fetch(`http://localhost:${rpcPort}/5chan`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).not.toMatch(
            /window\.location\.replace\(["']\/#["']\s*\+\s*window\.location\.pathname\s*\+\s*window\.location\.search\)/
        );
    });

    it(`POST /api/challenges/reload returns 200 for local connections`, async () => {
        const res = await fetch(`http://localhost:${rpcPort}/api/challenges/reload`, { method: "POST" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; challenges: string[] };
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.challenges)).toBe(true);
    });
});

describe("bitsocial daemon kills kubo on its own shutdown (no backup /shutdown call)", async () => {
    it.skipIf(process.platform === "win32")("daemon's own cleanup kills kubo after SIGTERM", { timeout: 60000 }, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        let kuboApiUrl: string | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl]);
            daemonProcess = daemon.daemonProcess;
            kuboApiUrl = daemon.kuboApiUrl;

            // Verify kubo is running
            const kuboRes = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
            expect(kuboRes.status).toBe(200);

            // Send SIGTERM only - no backup /shutdown call
            daemonProcess.kill("SIGTERM");

            // Kubo should be killed promptly by the daemon's parallel shutdown.
            const kuboStopped = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return !res.ok;
                } catch {
                    return true; // connection refused = stopped
                }
            }, 20000, 500);
            expect(kuboStopped).toBe(true);
        } finally {
            await killChildProcess(daemonProcess);
            if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
        }
    });

    it.skipIf(process.platform === "win32")("daemon's own cleanup kills kubo after double SIGTERM (impatient user)", { timeout: 60000 }, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        let kuboApiUrl: string | undefined;
        try {
            const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl]);
            daemonProcess = daemon.daemonProcess;
            kuboApiUrl = daemon.kuboApiUrl;

            // Verify kubo is running
            const kuboRes = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
            expect(kuboRes.status).toBe(200);

            // Send first SIGTERM
            daemonProcess.kill("SIGTERM");

            // Wait 1s then send second SIGTERM (simulating impatient double Ctrl+C)
            await new Promise((resolve) => setTimeout(resolve, 1000));
            try {
                daemonProcess.kill("SIGTERM");
            } catch {
                /* process may have already exited */
            }

            // Kubo should be killed by the daemon's parallel shutdown or emergency exit handler
            const kuboStopped = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return !res.ok;
                } catch {
                    return true; // connection refused = stopped
                }
            }, 20000, 500);
            expect(kuboStopped).toBe(true);
        } finally {
            await killChildProcess(daemonProcess);
            if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
        }
    });
});

describe("bitsocial daemon DEBUG env var", () => {
    it("DEBUG=* does not leak debug output to stderr", { timeout: 60000 }, async () => {
        const logPath = randomDirectory();
        const e = await allocateKuboEndpoints();
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemonCapturingStderr(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl, "--logPath", logPath],
                { DEBUG: "*", KUBO_RPC_URL: e.kuboRpcUrl, IPFS_GATEWAY_URL: e.gatewayUrl }
            );

            // stderr should not contain debug-format output (lines ending with +Nms)
            expect(daemonProcess.capturedStderr).not.toMatch(/\+\d+m?s$/m);

            // stdout should contain the informational messages
            expect(daemonProcess.capturedStdout).toContain("To view logs, run: bitsocial logs");

            // The log file should contain debug output
            const logFiles = await fsPromise.readdir(logPath);
            const logFile = logFiles.find((f) => f.startsWith("bitsocial_cli_daemon"));
            expect(logFile).toBeDefined();
            const logContent = await fsPromise.readFile(path.join(logPath, logFile!), "utf-8");
            expect(logContent.length).toBeGreaterThan(0);
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });

    it("daemon without DEBUG shows tip messages in stdout", { timeout: 60000 }, async () => {
        const e = await allocateKuboEndpoints();
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemonCapturingStderr(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", e.rpcWsUrl],
                { KUBO_RPC_URL: e.kuboRpcUrl, IPFS_GATEWAY_URL: e.gatewayUrl }
            );

            // stderr should not contain debug-format output
            expect(daemonProcess.capturedStderr).not.toMatch(/\+\d+m?s$/m);

            // stdout should contain tip messages
            expect(daemonProcess.capturedStdout).toContain("To view logs, run: bitsocial logs");
            expect(daemonProcess.capturedStdout).toContain("DEBUG");

            // stdout should contain the printed PKC options
            expect(daemonProcess.capturedStdout).toContain("PKC options:");
            expect(daemonProcess.capturedStdout).toContain('"dataPath"');

            // Should NOT contain "Debug logs is on" since no DEBUG was set
            expect(daemonProcess.capturedStderr).not.toContain("Debug logs is on");
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });
});

// TODO add more tests for webui
