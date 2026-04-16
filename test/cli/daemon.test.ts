// This file is to test root commands like `bitsocial daemon` or `bitsocial get`, whereas commands like `bitsocial community start` are considered nested
import { ChildProcess, spawn } from "child_process";
import net from "net";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
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
    ensureKuboNodeStopped,
    waitForWebSocketOpen,
    waitForKuboReady,
    waitForPortFree
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

// --- Port allocations unique to this file (avoid conflicts with other test files and external processes) ---
const DAEMON_RPC_PORT = 9338;
const DAEMON_KUBO_PORT = 50079;
const DAEMON_GATEWAY_PORT = 6533;
const DAEMON_RPC_URL = `ws://localhost:${DAEMON_RPC_PORT}`;
const DAEMON_KUBO_URL = `http://0.0.0.0:${DAEMON_KUBO_PORT}/api/v0`;
const DAEMON_GATEWAY_URL = `http://0.0.0.0:${DAEMON_GATEWAY_PORT}`;

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
        const daemonArgs = hasCustomDataPath ? args : ["--pkcOptions.dataPath", randomDirectory(), ...args];
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
    // Use random swarm ports to avoid conflicts
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
    const kuboApiUrl = `http://localhost:${DAEMON_KUBO_PORT}/api/v0`;

    beforeAll(async () => {
        await ensureKuboNodeStopped(DAEMON_KUBO_URL);

        daemonProcess = await startPkcDaemon(
            ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", DAEMON_RPC_URL],
            { KUBO_RPC_URL: DAEMON_KUBO_URL, IPFS_GATEWAY_URL: DAEMON_GATEWAY_URL }
        );
        expect(typeof daemonProcess.pid).toBe("number");
        expect(daemonProcess.killed).toBe(false);
    });

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await waitForPortFree(DAEMON_RPC_PORT, "localhost", 10000);
    });

    it(`PKC RPC server is started`, async () => {
        const rpcClient = new WebSocket(DAEMON_RPC_URL);
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
            await expect(fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" })).rejects.toThrow();

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
        const rpcClient = new WebSocket(DAEMON_RPC_URL);
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
    // Use unique ports for port validation tests
    const validationRpcPort = 9388;
    const validationKuboPort = 50089;
    const validationGatewayPort = 6543;
    const validationRpcUrl = `ws://localhost:${validationRpcPort}`;
    const validationKuboUrl = `http://0.0.0.0:${validationKuboPort}/api/v0`;
    const validationGatewayUrl = `http://0.0.0.0:${validationGatewayPort}`;

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
});

describe("bitsocial daemon kubo restart cleanup", async () => {
    const cleanupRpcUrl = `ws://localhost:9348`;
    const cleanupKuboUrl = `http://0.0.0.0:50099/api/v0`;
    const cleanupGatewayUrl = `http://0.0.0.0:6553`;
    const cleanupKuboApiUrl = `http://localhost:50099/api/v0`;

    // On Windows, process.kill() calls TerminateProcess() which instantly kills the daemon
    // without running exit hooks (asyncExitHook/process.on("exit")), so the daemon has no
    // opportunity to clean up kubo. On Unix, SIGTERM is caught by the exit hook which runs
    // killKuboProcess(). The normal user path (Ctrl+C/SIGINT) works on all platforms.
    it.skipIf(process.platform === "win32")("stops kubo when daemon exits during a restart cycle", { timeout: 60000 }, async () => {
        const previousDelay = process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"];
        process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"] = "5000";

        let daemonProcess: ManagedChildProcess | undefined;
        try {
            await ensureKuboNodeStopped(cleanupKuboApiUrl);
            daemonProcess = await startPkcDaemon(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", cleanupRpcUrl],
                { KUBO_RPC_URL: cleanupKuboUrl, IPFS_GATEWAY_URL: cleanupGatewayUrl }
            );
            expect(typeof daemonProcess.pid).toBe("number");

            const shutdownRes = await fetch(`${cleanupKuboApiUrl}/shutdown`, { method: "POST" });
            expect(shutdownRes.status).toBe(200);

            const kuboRestarted = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${cleanupKuboApiUrl}/bitswap/stat`, { method: "POST" });
                    return res.ok;
                } catch {
                    return false;
                }
            }, 20000, 500);
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
            expect(kuboStoppedAfterKill).toBe(true);
        } finally {
            if (daemonProcess) await stopPkcDaemon(daemonProcess);
            if (previousDelay === undefined) delete process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"];
            else process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"] = previousDelay;
            await ensureKuboNodeStopped(cleanupKuboApiUrl);
        }
    });
});

describe(`bitsocial daemon (kubo daemon is started by another process on the same port that bitsocial-cli is using)`, async () => {
    let kuboDaemonProcess: ChildProcess | undefined;
    const extKuboPort = 50139;
    const extKuboRpcUrl = new URL(`http://127.0.0.1:${extKuboPort}/api/v0`);
    const extRpcUrl = `ws://localhost:9358`;
    const extGatewayUrl = `http://0.0.0.0:6593`;

    beforeAll(async () => {
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
});

describe(`bitsocial daemon (relying on PKC RPC started by another process)`, async () => {
    let rpcProcess: ManagedChildProcess;
    const rpcRpcUrl = `ws://localhost:9368`;
    const rpcKuboUrl = `http://0.0.0.0:50149/api/v0`;
    const rpcGatewayUrl = `http://0.0.0.0:6603`;

    beforeAll(async () => {
        await ensureKuboNodeStopped(`http://localhost:50149/api/v0`);
        rpcProcess = await startPkcDaemon(
            ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcRpcUrl],
            { KUBO_RPC_URL: rpcKuboUrl, IPFS_GATEWAY_URL: rpcGatewayUrl }
        );
        await testConnectionToPkcRpc(9368);
    });

    afterAll(async () => {
        await stopPkcDaemon(rpcProcess);
        await waitForPortFree(9368, "localhost", 10000);
    });

    it(`bitsocial daemon detects and uses another process' PKC RPC`, async () => {
        let anotherRpcProcess: ManagedChildProcess | undefined;
        try {
            anotherRpcProcess = await startPkcDaemon(
                ["--pkcRpcUrl", rpcRpcUrl],
                { KUBO_RPC_URL: rpcKuboUrl, IPFS_GATEWAY_URL: rpcGatewayUrl }
            );
            await testConnectionToPkcRpc(9368);
        } finally {
            await stopPkcDaemon(anotherRpcProcess); // should not affect rpcProcess
        }
        await testConnectionToPkcRpc(9368);
    });
    it(`bitsocial daemon is monitoring another process' PKC RPC and make sure it's always up`, async () => {
        let anotherRpcProcess: ManagedChildProcess | undefined;
        try {
            anotherRpcProcess = await startPkcDaemon(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcRpcUrl],
                { KUBO_RPC_URL: rpcKuboUrl, IPFS_GATEWAY_URL: rpcGatewayUrl }
            );
            await stopPkcDaemon(rpcProcess);

            // Wait for anotherRpcProcess to restart the RPC
            const rpcRestarted = await waitForCondition(async () => {
                try {
                    const ws = new WebSocket(rpcRpcUrl);
                    const opened = await new Promise<boolean>((resolve) => {
                        const timer = setTimeout(() => resolve(false), 2000);
                        ws.once("open", () => {
                            clearTimeout(timer);
                            resolve(true);
                        });
                        ws.once("error", () => {
                            clearTimeout(timer);
                            resolve(false);
                        });
                    });
                    ws.close();
                    return opened;
                } catch {
                    return false;
                }
            }, 30000, 1000);
            expect(rpcRestarted).toBe(true);
        } finally {
            await stopPkcDaemon(anotherRpcProcess);
        }
    });
});

describe(`bitsocial daemon --pkcRpcUrl`, async () => {
    it(`A bitsocial daemon should be change where to listen URL`, async () => {
        const rpcUrl = new URL("ws://localhost:11138");
        let firstRpcProcess: ManagedChildProcess | undefined;
        try {
            firstRpcProcess = await startPkcDaemon(
                ["--pkcRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: "http://0.0.0.0:50159/api/v0", IPFS_GATEWAY_URL: "http://0.0.0.0:6613" }
            );
            await testConnectionToPkcRpc(rpcUrl.port);
        } finally {
            await stopPkcDaemon(firstRpcProcess);
        }
    });
});

describe(`bitsocial daemon PKC_RPC_AUTH_KEY env var`, async () => {
    it(`daemon uses PKC_RPC_AUTH_KEY when set`, async () => {
        const customAuthKey = "my-test-auth-key-1234567890";
        const rpcUrl = new URL("ws://localhost:19138");
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemon(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString()],
                { PKC_RPC_AUTH_KEY: customAuthKey, KUBO_RPC_URL: "http://0.0.0.0:50169/api/v0", IPFS_GATEWAY_URL: "http://0.0.0.0:6623" }
            );
            expect(daemonProcess.capturedStdout).toContain(customAuthKey);
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });
});

describe(`bitsocial daemon KUBO_RPC_URL env var`, async () => {
    it(`daemon uses KUBO_RPC_URL env var to configure kubo bind address`, async () => {
        const rpcUrl = new URL("ws://localhost:29138");
        const testKuboPort = 50179;
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemon(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: `http://0.0.0.0:${testKuboPort}/api/v0`, IPFS_GATEWAY_URL: "http://0.0.0.0:6633" }
            );
            // Kubo should be reachable on the configured port
            const res = await fetch(`http://localhost:${testKuboPort}/api/v0/bitswap/stat`, { method: "POST" });
            expect(res.status).toBe(200);
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });
});

describe(`bitsocial daemon webui`, async () => {
    let daemonProcess: ManagedChildProcess;
    const rpcUrl = new URL("ws://localhost:39138");

    beforeAll(async () => {
        daemonProcess = await startPkcDaemon(
            ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString()],
            { KUBO_RPC_URL: "http://0.0.0.0:50189/api/v0", IPFS_GATEWAY_URL: "http://0.0.0.0:6643" }
        );
    });

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
    });

    it(`5chan webui does not contain the hash redirect script`, async () => {
        const res = await fetch(`http://localhost:${rpcUrl.port}/5chan`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).not.toMatch(/Redirect non-hash URLs/);
    });

    it(`POST /api/challenges/reload returns 200 for local connections`, async () => {
        const res = await fetch(`http://localhost:${rpcUrl.port}/api/challenges/reload`, { method: "POST" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; challenges: string[] };
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.challenges)).toBe(true);
    });
});

describe("bitsocial daemon kills kubo on its own shutdown (no backup /shutdown call)", async () => {
    const rpcUrl = new URL("ws://localhost:49138");
    const kuboApiUrl = "http://127.0.0.1:50029/api/v0";
    const gatewayUrl = "http://127.0.0.1:6483";

    beforeAll(async () => {
        await ensureKuboNodeStopped(kuboApiUrl);
    });

    it.skipIf(process.platform === "win32")("daemon's own cleanup kills kubo after SIGTERM", { timeout: 60000 }, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemon(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: kuboApiUrl, IPFS_GATEWAY_URL: gatewayUrl }
            );

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
            await ensureKuboNodeStopped(kuboApiUrl);
        }
    });

    it.skipIf(process.platform === "win32")("daemon's own cleanup kills kubo after double SIGTERM (impatient user)", { timeout: 60000 }, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemon(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: kuboApiUrl, IPFS_GATEWAY_URL: gatewayUrl }
            );

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
            await ensureKuboNodeStopped(kuboApiUrl);
        }
    });
});

describe("bitsocial daemon DEBUG env var", () => {
    const testKuboApiUrl = "http://127.0.0.1:50119/api/v0";
    const testGatewayUrl = "http://127.0.0.1:6573";

    const cleanupKubo = async () => {
        await ensureKuboNodeStopped(testKuboApiUrl);
    };

    beforeAll(cleanupKubo);
    afterEach(cleanupKubo);

    it("DEBUG=* does not leak debug output to stderr", { timeout: 60000 }, async () => {
        const rpcUrl = new URL("ws://localhost:59338");
        const logPath = randomDirectory();
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemonCapturingStderr(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString(), "--logPath", logPath],
                { DEBUG: "*", KUBO_RPC_URL: testKuboApiUrl, IPFS_GATEWAY_URL: testGatewayUrl }
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
        const rpcUrl = new URL("ws://localhost:59339");
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPkcDaemonCapturingStderr(
                ["--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: testKuboApiUrl, IPFS_GATEWAY_URL: testGatewayUrl }
            );

            // stderr should not contain debug-format output
            expect(daemonProcess.capturedStderr).not.toMatch(/\+\d+m?s$/m);

            // stdout should contain tip messages
            expect(daemonProcess.capturedStdout).toContain("To view logs, run: bitsocial logs");
            expect(daemonProcess.capturedStdout).toContain("DEBUG");

            // Should NOT contain "Debug logs is on" since no DEBUG was set
            expect(daemonProcess.capturedStderr).not.toContain("Debug logs is on");
        } finally {
            await stopPkcDaemon(daemonProcess);
        }
    });
});

// TODO add more tests for webui
