// This file is to test root commands like `bitsocial daemon` or `bitsocial get`, whereas commands like `bitsocial community start` are considered nested
import { ChildProcess, spawn } from "child_process";
import net from "net";
import defaults from "../../dist/common-utils/defaults.js";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import WebSocket from "ws";
import { path as kuboExePathFunc } from "kubo";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

const rpcServerEndPoint = defaults.PLEBBIT_RPC_URL;
type ManagedChildProcess = ChildProcess & { kuboRpcUrl?: URL; capturedStdout?: string };

const makeRequestToKuboRpc = async (apiPort: number | string) => {
    return fetch(`http://localhost:${apiPort}/api/v0/bitswap/stat`, { method: "POST" });
};

const testConnectionToPlebbitRpc = async (rpcServerPort: number | string) => {
    const rpcClient = new WebSocket(`ws://localhost:${rpcServerPort}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(rpcClient.readyState).toBe(1); // 1 = connected
};

const killChildProcess = async (proc?: ChildProcess) => {
    if (!proc) return;
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
        let settled = false;
        const cleanup = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        }, 5000);
        proc.once("exit", cleanup);
        proc.once("close", cleanup);
        const killed = proc.kill();
        if (!killed && (proc.exitCode !== null || proc.signalCode !== null)) cleanup();
    });
};

const stopPlebbitDaemon = async (proc?: ManagedChildProcess) => {
    if (!proc) return;
    await killChildProcess(proc);
    const kuboRpcUrl = proc.kuboRpcUrl;
    if (!kuboRpcUrl) return;
    const shutdownUrl = new URL(kuboRpcUrl.toString());
    shutdownUrl.pathname = `${shutdownUrl.pathname.replace(/\/$/, "")}/shutdown`;
    try {
        await fetch(shutdownUrl, { method: "POST" });
    } catch {
        /* ignore */
    }
};

const waitForCondition = async (predicate: () => Promise<boolean> | boolean, timeoutMs = 20000, intervalMs = 500) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
};

const ensureKuboNodeStopped = async () => {
    try {
        await fetch(`${defaults.KUBO_RPC_URL}/shutdown`, { method: "POST" });
    } catch {
        /* ignore */
    }
    await waitForCondition(async () => {
        try {
            const res = await fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" });
            return !res.ok;
        } catch {
            return true;
        }
    });
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

const startPlebbitDaemon = (args: string[], env?: Record<string, string>): Promise<ManagedChildProcess> => {
    return new Promise(async (resolve, reject) => {
        const hasCustomDataPath = args.some((arg) => arg.startsWith("--plebbitOptions.dataPath"));
        const hasCustomLogPath = args.some((arg) => arg === "--logPath");
        const logPathArgs = hasCustomLogPath ? [] : ["--logPath", randomDirectory()];
        const daemonArgs = hasCustomDataPath ? args : ["--plebbitOptions.dataPath", randomDirectory(), ...args];
        const daemonProcess = spawn("node", ["./bin/run", "daemon", ...logPathArgs, ...daemonArgs], {
            stdio: ["pipe", "pipe", "inherit"],
            env: env ? { ...process.env, ...env } : undefined
        }) as ManagedChildProcess;

        daemonProcess.capturedStdout = "";
        const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
            reject(`spawnAsync process '${daemonProcess.pid}' exited with code '${exitCode}' signal '${signal}'`);
        };
        const onError = (error: Error) => {
            daemonProcess.stdout!.off("data", onStdoutData);
            daemonProcess.off("exit", onExit);
            daemonProcess.off("error", onError);
            reject(error);
        };
        const onStdoutData = (data: Buffer) => {
            const output = data.toString();
            daemonProcess.capturedStdout += output;
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
        daemonProcess.on("error", onError);
    });
};

const startKuboDaemon = (args: string[]): Promise<ChildProcess> => {
    return new Promise(async (resolve, reject) => {
        const daemonArgs = args.some((arg) => arg === "--migrate" || arg.startsWith("--migrate=")) ? [...args] : [...args, "--migrate"];
        const env = { ...process.env, IPFS_PATH: randomDirectory() };
        const daemonProcess = spawn(kuboExePathFunc(), ["daemon", ...daemonArgs], {
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

const runPlebbitDaemonExpectFailure = (args: string[], timeoutMs = 20000) => {
    return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const hasCustomDataPath = args.some((arg) => arg.startsWith("--plebbitOptions.dataPath"));
        const hasCustomLogPath = args.some((arg) => arg === "--logPath");
        const logPathArgs = hasCustomLogPath ? [] : ["--logPath", randomDirectory()];
        const daemonArgs = hasCustomDataPath ? args : ["--plebbitOptions.dataPath", randomDirectory(), ...args];

        const daemonProcess = spawn("node", ["./bin/run", "daemon", ...logPathArgs, ...daemonArgs], {
            stdio: ["ignore", "pipe", "pipe"]
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

    beforeAll(async () => {
        await ensureKuboNodeStopped();

        daemonProcess = await startPlebbitDaemon(["--plebbitOptions.dataPath", randomDirectory()]);
        expect(typeof daemonProcess.pid).toBe("number");
        expect(daemonProcess.killed).toBe(false);
    });

    afterAll(async () => {
        await stopPlebbitDaemon(daemonProcess);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    it(`Plebbit RPC server is started with default args`, async () => {
        const rpcClient = new WebSocket(rpcServerEndPoint);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(rpcClient.readyState).toBe(1); // 1 = connected
        rpcClient.close();
    });

    it(`Kubo API is started with default args`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const res = await fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" });
        expect(res.status).toBe(200);
    });

    [1, 2].map((tryNumber) =>
        it(`Kubo Node is restarted after failing for ${tryNumber}st time`, async () => {
            const shutdownRes = await fetch(`${defaults.KUBO_RPC_URL}/shutdown`, {
                method: "POST"
            });
            expect(shutdownRes.status).toBe(200);
            await expect(fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" })).rejects.toThrow();

            // Try to connect to kubo node every 100ms with proper cleanup
            await new Promise<void>((resolve, reject) => {
                let resolved = false;
                const timeOut = setInterval(async () => {
                    if (resolved) return;
                    try {
                        const res = await fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" });
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
            await expect(fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" })).resolves.toBeDefined();
        })
    );

    it(`kubo node is killed after killing plebbit daemon`, async () => {
        expect(daemonProcess.kill()).toBe(true);
        await stopPlebbitDaemon(daemonProcess);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Test whether rpc server is reachable, it should not be reachable
        const rpcClient = new WebSocket(rpcServerEndPoint);
        rpcClient.onerror = function (errorEvent) {
            console.log("WebSocket Error ", errorEvent);
        };
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // WebSocket should not be in OPEN (1) state - it should be CONNECTING (0), CLOSING (2), or CLOSED (3)
        expect(rpcClient.readyState).not.toBe(1);
        rpcClient.close();

        await ensureKuboNodeStopped();
    });
});

describe("bitsocial daemon port availability validation", () => {
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

        const result = await runPlebbitDaemonExpectFailure(["--plebbitOptions.dataPath", randomDirectory()]);
        expect(result.exitCode).not.toBe(0);
        const combinedOutput = `${result.stdout}\n${result.stderr}`;
        if (expectedMessageFragment instanceof RegExp) expect(combinedOutput).toMatch(expectedMessageFragment);
        else expect(combinedOutput).toContain(expectedMessageFragment);
    };

    it("fails when IPFS API port is already in use", async () => {
        await expectFailureForOccupiedPort(Number(defaults.KUBO_RPC_URL.port), defaults.KUBO_RPC_URL.hostname, "IPFS API port", () => true);
    });

    it("fails when IPFS Gateway port is already in use", async () => {
        await expectFailureForOccupiedPort(
            Number(defaults.IPFS_GATEWAY_URL.port),
            defaults.IPFS_GATEWAY_URL.hostname,
            "IPFS Gateway port",
            () => true
        );
    });

    it("fails when an IPFS swarm port is already in use", async () => {
        const swarmPort = 4001;
        await expectFailureForOccupiedPort(swarmPort, "0.0.0.0", "IPFS Swarm port", () => true);
    });
});

describe("bitsocial daemon kubo restart cleanup", async () => {
    it("stops kubo when daemon exits during a restart cycle", async () => {
        const previousDelay = process.env["PLEBBIT_CLI_TEST_IPFS_READY_DELAY_MS"];
        process.env["PLEBBIT_CLI_TEST_IPFS_READY_DELAY_MS"] = "5000";

        let daemonProcess: ManagedChildProcess | undefined;
        try {
            await ensureKuboNodeStopped();
            daemonProcess = await startPlebbitDaemon(["--plebbitOptions.dataPath", randomDirectory()]);
            expect(typeof daemonProcess.pid).toBe("number");

            const shutdownRes = await fetch(`${defaults.KUBO_RPC_URL}/shutdown`, { method: "POST" });
            expect(shutdownRes.status).toBe(200);

            const kuboRestarted = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" });
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
            }, 10000, 100);
            expect(daemonExited).toBe(true);

            const kuboStoppedAfterKill = await waitForCondition(async () => {
                try {
                    const res = await fetch(`${defaults.KUBO_RPC_URL}/bitswap/stat`, { method: "POST" });
                    return !res.ok;
                } catch {
                    return true;
                }
            }, 10000, 500);
            expect(kuboStoppedAfterKill).toBe(true);
        } finally {
            if (daemonProcess) await stopPlebbitDaemon(daemonProcess);
            if (previousDelay === undefined) delete process.env["PLEBBIT_CLI_TEST_IPFS_READY_DELAY_MS"];
            else process.env["PLEBBIT_CLI_TEST_IPFS_READY_DELAY_MS"] = previousDelay;
            await ensureKuboNodeStopped();
        }
    });
});

describe(`bitsocial daemon (kubo daemon is started by another process on the same port that bitsocial-cli is using)`, async () => {
    let kuboDaemonProcess: ChildProcess | undefined;
    const kuboRpcUrl = new URL(`http://127.0.0.1:5001/api/v0`); // we're using the default here
    beforeAll(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // wait until the previous daemon is killed
        kuboDaemonProcess = await startKuboDaemon(["--init"]); // will start a daemon at 5001
        const res = await makeRequestToKuboRpc(kuboRpcUrl.port);
        expect(res.status).toBe(200);
    });

    afterAll(async () => {
        await killChildProcess(kuboDaemonProcess);
    });

    it(`bitsocial daemon can use a kubo node started by another program`, async () => {
        let plebbitDaemonProcess: ManagedChildProcess | undefined;
        try {
            plebbitDaemonProcess = await startPlebbitDaemon([
                "--plebbitOptions.dataPath",
                randomDirectory(),
                "--plebbitOptions.kuboRpcClientsOptions[0]",
                kuboRpcUrl.toString()
            ]);
            const rpcClient = new WebSocket(rpcServerEndPoint);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            expect(rpcClient.readyState).toBe(1); // 1 = connected
            rpcClient.close();
        } finally {
            await stopPlebbitDaemon(plebbitDaemonProcess);
        }
    });

    it(`bitsocial daemon monitors Kubo RPC started by another process, and start a new Kubo process if needed`, async () => {
        let plebbitDaemonProcess: ManagedChildProcess | undefined;
        try {
            plebbitDaemonProcess = await startPlebbitDaemon([
                "--plebbitOptions.dataPath",
                randomDirectory(),
                "--plebbitOptions.kuboRpcClientsOptions[0]",
                kuboRpcUrl.toString()
            ]); // should use kuboDaemonProcess
            const rpcClient = new WebSocket(rpcServerEndPoint);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            expect(rpcClient.readyState).toBe(1); // 1 = connected

            await killChildProcess(kuboDaemonProcess);
            await new Promise((resolve) => setTimeout(resolve, 15000)); // plebbit daemon should start a new kubo daemon within 10 seconds ish
            const resAfterRestart = await makeRequestToKuboRpc(kuboRpcUrl.port);
            expect(resAfterRestart.status).toBe(200);
        } finally {
            await stopPlebbitDaemon(plebbitDaemonProcess);
        }
    });
});

describe(`bitsocial daemon (relying on plebbit RPC started by another process)`, async () => {
    let rpcProcess: ManagedChildProcess;
    beforeAll(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // wait until the previous daemon is killed
        rpcProcess = await startPlebbitDaemon(["--plebbitOptions.dataPath", randomDirectory()]); // will start a daemon at 5001
        await testConnectionToPlebbitRpc(defaults.PLEBBIT_RPC_URL.port);
    });

    afterAll(async () => {
        await stopPlebbitDaemon(rpcProcess);
    });

    it(`bitsocial daemon detects and uses another process' plebbit RPC`, async () => {
        let anotherRpcProcess: ManagedChildProcess | undefined;
        try {
            anotherRpcProcess = await startPlebbitDaemon([]); // should start with no problem and use rpcProcess
            await testConnectionToPlebbitRpc(defaults.PLEBBIT_RPC_URL.port);
        } finally {
            await stopPlebbitDaemon(anotherRpcProcess); // should not affect rpcProcess
        }
        await testConnectionToPlebbitRpc(defaults.PLEBBIT_RPC_URL.port);
    });
    it(`bitsocial daemon is monitoring another process' plebbit RPC and make sure it's always up`, async () => {
        let anotherRpcProcess: ManagedChildProcess | undefined;
        try {
            anotherRpcProcess = await startPlebbitDaemon(["--plebbitOptions.dataPath", randomDirectory()]); // should monitor rpcProcess
            await stopPlebbitDaemon(rpcProcess);
            await new Promise((resolve) => setTimeout(resolve, 6000)); // wait until anotherRpcProcess restart the rpc
            await testConnectionToPlebbitRpc(defaults.PLEBBIT_RPC_URL.port);
        } finally {
            await stopPlebbitDaemon(anotherRpcProcess);
        }
    });
});

describe(`bitsocial daemon --plebbitRpcUrl`, async () => {
    it(`A bitsocial daemon should be change where to listen URL`, async () => {
        const rpcUrl = new URL("ws://localhost:11138");
        let firstRpcProcess: ManagedChildProcess | undefined;
        try {
            firstRpcProcess = await startPlebbitDaemon(["--plebbitRpcUrl", rpcUrl.toString()]); // will start a daemon at 9138
            await testConnectionToPlebbitRpc(rpcUrl.port);
        } finally {
            await stopPlebbitDaemon(firstRpcProcess);
        }
    });
});

describe(`bitsocial daemon PLEBBIT_RPC_AUTH_KEY env var`, async () => {
    beforeAll(async () => {
        await ensureKuboNodeStopped();
        await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    it(`daemon uses PLEBBIT_RPC_AUTH_KEY when set`, async () => {
        const customAuthKey = "my-test-auth-key-1234567890";
        const rpcUrl = new URL("ws://localhost:19138");
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPlebbitDaemon(
                ["--plebbitOptions.dataPath", randomDirectory(), "--plebbitRpcUrl", rpcUrl.toString()],
                { PLEBBIT_RPC_AUTH_KEY: customAuthKey }
            );
            expect(daemonProcess.capturedStdout).toContain(customAuthKey);
        } finally {
            await stopPlebbitDaemon(daemonProcess);
        }
    });
});

describe(`bitsocial daemon KUBO_RPC_URL env var`, async () => {
    beforeAll(async () => {
        await ensureKuboNodeStopped();
        await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    it(`daemon uses KUBO_RPC_URL env var to configure kubo bind address`, async () => {
        const rpcUrl = new URL("ws://localhost:29138");
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPlebbitDaemon(
                ["--plebbitOptions.dataPath", randomDirectory(), "--plebbitRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: "http://0.0.0.0:50019/api/v0" }
            );
            // Kubo should be reachable on port 50019
            const res = await fetch("http://localhost:50019/api/v0/bitswap/stat", { method: "POST" });
            expect(res.status).toBe(200);
        } finally {
            await stopPlebbitDaemon(daemonProcess);
        }
    });
});

describe(`bitsocial daemon webui`, async () => {
    let daemonProcess: ManagedChildProcess;
    const rpcUrl = new URL("ws://localhost:39138");

    beforeAll(async () => {
        await ensureKuboNodeStopped();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        daemonProcess = await startPlebbitDaemon([
            "--plebbitOptions.dataPath",
            randomDirectory(),
            "--plebbitRpcUrl",
            rpcUrl.toString()
        ]);
    });

    afterAll(async () => {
        await stopPlebbitDaemon(daemonProcess);
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

    const cleanupTestKubo = async () => {
        // Ensure no leftover kubo on our test port from previous tests
        try {
            await fetch(`${kuboApiUrl}/shutdown`, { method: "POST" });
        } catch {
            /* ignore */
        }
        await waitForCondition(async () => {
            try {
                const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
                return !res.ok;
            } catch {
                return true;
            }
        });
    };

    beforeAll(async () => {
        // Also ensure default kubo port is free (previous tests may have used it)
        await ensureKuboNodeStopped();
        await cleanupTestKubo();
        await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    it("daemon's own cleanup kills kubo after SIGTERM", { timeout: 60000 }, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPlebbitDaemon(
                ["--plebbitOptions.dataPath", randomDirectory(), "--plebbitRpcUrl", rpcUrl.toString()],
                { KUBO_RPC_URL: kuboApiUrl, IPFS_GATEWAY_URL: gatewayUrl }
            );

            // Verify kubo is running
            const kuboRes = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
            expect(kuboRes.status).toBe(200);

            // Send SIGTERM only - no backup /shutdown call
            daemonProcess.kill("SIGTERM");

            // Kubo should be killed promptly by the daemon's parallel shutdown.
            // The daemon process itself may linger (daemonServer.destroy() retries
            // HTTP calls to the now-dead kubo), but kubo should be gone quickly.
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
            await cleanupTestKubo();
        }
    });

    it("daemon's own cleanup kills kubo after double SIGTERM (impatient user)", { timeout: 60000 }, async () => {
        let daemonProcess: ManagedChildProcess | undefined;
        try {
            daemonProcess = await startPlebbitDaemon(
                ["--plebbitOptions.dataPath", randomDirectory(), "--plebbitRpcUrl", rpcUrl.toString()],
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
            await cleanupTestKubo();
        }
    });
});

// TODO add more tests for webui
