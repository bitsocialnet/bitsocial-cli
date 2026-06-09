import { ChildProcess, spawn } from "child_process";
import net from "net";
import path from "path";
import { directory as randomDirectory } from "tempy";
import WebSocket from "ws";
import defaults from "../../dist/common-utils/defaults.js";
import { preInitKuboWithEphemeralSwarm } from "./kubo-helpers.js";

export type ManagedChildProcess = ChildProcess & { kuboRpcUrl?: URL; capturedStdout?: string; capturedStderr?: string };

export const killChildProcess = async (proc?: ChildProcess) => {
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

export const stopPkcDaemon = async (proc?: ManagedChildProcess) => {
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

export const waitForCondition = async (predicate: () => Promise<boolean> | boolean, timeoutMs = 20000, intervalMs = 500) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
};

export const ensureKuboNodeStopped = async (kuboRpcUrl?: string) => {
    const url = kuboRpcUrl || defaults.KUBO_RPC_URL.toString();
    try {
        await fetch(`${url}/shutdown`, { method: "POST" });
    } catch {
        /* ignore */
    }
    await waitForCondition(async () => {
        try {
            const res = await fetch(`${url}/bitswap/stat`, { method: "POST" });
            return !res.ok;
        } catch {
            return true;
        }
    });
};

export const startPkcDaemon = (args: string[], env?: Record<string, string>): Promise<ManagedChildProcess> => {
    return new Promise(async (resolve, reject) => {
        const hasCustomDataPath = args.some((arg) => arg.startsWith("--pkcOptions.dataPath"));
        const hasCustomLogPath = args.some((arg) => arg === "--logPath");
        const logPathArgs = hasCustomLogPath ? [] : ["--logPath", randomDirectory()];
        const dataPath = hasCustomDataPath
            ? (args[args.findIndex((a) => a.startsWith("--pkcOptions.dataPath")) + 1] as string)
            : randomDirectory();
        const daemonArgs = hasCustomDataPath ? args : ["--pkcOptions.dataPath", dataPath, ...args];

        // Pre-init kubo so parallel test daemons don't collide on swarm port 4001.
        const apiUrl = new URL(env?.KUBO_RPC_URL ?? defaults.KUBO_RPC_URL.toString());
        const gatewayUrl = new URL(env?.IPFS_GATEWAY_URL ?? defaults.IPFS_GATEWAY_URL.toString());
        try {
            await preInitKuboWithEphemeralSwarm(path.join(dataPath, ".bitsocial-cli.ipfs"), apiUrl, gatewayUrl);
        } catch (error) {
            return reject(error);
        }

        const daemonProcess = spawn("node", ["./bin/run", "daemon", ...logPathArgs, ...daemonArgs], {
            stdio: ["pipe", "pipe", "pipe"],
            env: env ? { ...process.env, ...env } : undefined
        }) as ManagedChildProcess;

        daemonProcess.capturedStdout = "";
        daemonProcess.capturedStderr = "";
        const onStderrData = (data: Buffer) => {
            daemonProcess.capturedStderr += data.toString();
        };
        const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
            reject(`spawnAsync process '${daemonProcess.pid}' exited with code '${exitCode}' signal '${signal}'\nstdout: ${daemonProcess.capturedStdout}\nstderr: ${daemonProcess.capturedStderr}`);
        };
        const onError = (error: Error) => {
            daemonProcess.stdout!.off("data", onStdoutData);
            daemonProcess.stderr!.off("data", onStderrData);
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
        daemonProcess.stderr!.on("data", onStderrData);
        daemonProcess.on("error", onError);
    });
};

export const waitForWebSocketOpen = async (ws: WebSocket, timeoutMs = 10000): Promise<void> => {
    if (ws.readyState === 1) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), timeoutMs);
        ws.once("open", () => {
            clearTimeout(timer);
            resolve();
        });
        ws.once("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
};

export const waitForKuboReady = async (kuboApiUrl: string, timeoutMs = 20000) => {
    return waitForCondition(async () => {
        try {
            const res = await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" });
            return res.ok;
        } catch {
            return false;
        }
    }, timeoutMs);
};

export const waitForPortFree = async (port: number, host = "localhost", timeoutMs = 20000) => {
    return waitForCondition(
        () =>
            new Promise<boolean>((resolve) => {
                const socket = new net.Socket();
                socket.setTimeout(500);
                socket.on("connect", () => {
                    socket.destroy();
                    resolve(false);
                });
                socket.on("error", () => {
                    socket.destroy();
                    resolve(true);
                });
                socket.on("timeout", () => {
                    socket.destroy();
                    resolve(true);
                });
                socket.connect(port, host);
            }),
        timeoutMs
    );
};

// --- Dynamic port allocation (collision-proof test daemons; see issue #87) ---------------------

// Bind to :0 and hand back the kernel-assigned free port. There's an unavoidable TOCTOU window
// between closing this probe socket and kubo binding the port, so any caller that then starts kubo
// must pair this with retry-on-"address already in use" (see startPkcDaemonWithDynamicPorts).
export const allocateFreePort = (host = "127.0.0.1"): Promise<number> =>
    new Promise<number>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, host, () => {
            const address = server.address();
            if (address && typeof address === "object") {
                const { port } = address;
                server.close((closeError) => (closeError ? reject(closeError) : resolve(port)));
            } else {
                server.close(() => reject(new Error("Failed to allocate a free port")));
            }
        });
    });

export interface KuboEndpoints {
    rpcPort: number;
    kuboPort: number;
    gatewayPort: number;
    rpcWsUrl: string; // ws://localhost:<rpcPort>            (PKC RPC, --pkcRpcUrl)
    kuboRpcUrl: string; // http://0.0.0.0:<kuboPort>/api/v0   (KUBO_RPC_URL env / the addr kubo binds)
    kuboApiUrl: string; // http://localhost:<kuboPort>/api/v0 (client fetches, waitForKuboReady, ensureKuboNodeStopped)
    gatewayUrl: string; // http://0.0.0.0:<gatewayPort>       (IPFS_GATEWAY_URL env)
}

// Allocate a fresh, currently-free set of RPC / kubo-API / gateway ports for one test daemon.
// Probe each port on the interface it will actually be bound on: the PKC RPC server listens on
// localhost, but kubo binds its API and gateway on 0.0.0.0 (wildcard). A port can be free on
// loopback yet unavailable for a wildcard bind, so probing the wrong interface would hand back a
// port that immediately collides on kubo startup.
export const allocateKuboEndpoints = async (): Promise<KuboEndpoints> => {
    const [rpcPort, kuboPort, gatewayPort] = await Promise.all([
        allocateFreePort("127.0.0.1"),
        allocateFreePort("0.0.0.0"),
        allocateFreePort("0.0.0.0")
    ]);
    return {
        rpcPort,
        kuboPort,
        gatewayPort,
        rpcWsUrl: `ws://localhost:${rpcPort}`,
        kuboRpcUrl: `http://0.0.0.0:${kuboPort}/api/v0`,
        kuboApiUrl: `http://localhost:${kuboPort}/api/v0`,
        gatewayUrl: `http://0.0.0.0:${gatewayPort}`
    };
};

// startPkcDaemon rejects with either a string (subprocess exit, carrying captured stdout/stderr)
// or an Error; the bind-race signature ("...address already in use") can surface in either.
export const isAddressInUseError = (reason: unknown): boolean => {
    const message = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : String(reason);
    return /address already in use|EADDRINUSE/i.test(message);
};

export type DynamicDaemonResult = KuboEndpoints & { daemonProcess: ManagedChildProcess };

// Start a bitsocial daemon on freshly allocated, currently-free ports, retrying with a brand-new
// set if kubo loses the TOCTOU bind race (issue #87). buildArgs/buildEnv receive the allocated
// endpoints so callers can thread --pkcRpcUrl / a seeded dataPath / extra env through; KUBO_RPC_URL
// and IPFS_GATEWAY_URL are injected automatically (buildEnv may override them). Returns the live
// daemon plus the endpoints that actually won, so the test addresses the daemon via those URLs.
//
// Retries reuse whatever dataPath the caller bakes into buildArgs — preInitKuboWithEphemeralSwarm
// is idempotent, so a seeded dataPath survives a retry while picking up the new ports.
export const startPkcDaemonWithDynamicPorts = async (
    buildArgs: (endpoints: KuboEndpoints) => string[],
    buildEnv?: (endpoints: KuboEndpoints) => Record<string, string>,
    { retries = 4 }: { retries?: number } = {}
): Promise<DynamicDaemonResult> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
        const endpoints = await allocateKuboEndpoints();
        const env = { KUBO_RPC_URL: endpoints.kuboRpcUrl, IPFS_GATEWAY_URL: endpoints.gatewayUrl, ...(buildEnv?.(endpoints) ?? {}) };
        try {
            const daemonProcess = await startPkcDaemon(buildArgs(endpoints), env);
            return { ...endpoints, daemonProcess };
        } catch (reason) {
            lastError = reason;
            if (!isAddressInUseError(reason) || attempt === retries) throw reason;
            // Nothing of ours lingers to clean up: when kubo loses the bind race it never binds and
            // startPkcDaemon's subprocess has already exited. We must NOT ensureKuboNodeStopped the
            // losing port here — in a same-suite race the listener on it is another test's healthy
            // daemon, and shutting that down would reintroduce cross-test flakes. Just retry with a
            // fresh endpoint set.
        }
    }
    throw lastError;
};

// Run an arbitrary kubo-starting operation on freshly allocated free ports, retrying with a new
// set if it rejects with an "address already in use" bind race (issue #87). For starts that
// startPkcDaemonWithDynamicPorts can't express — a direct startKuboNode() call, or a manual
// `node ./bin/run daemon` spawn whose daemon stays wedged and never prints its ready banner.
// `start` must reject with a message containing "address already in use" for a lost bind to be
// retried; `cleanup` runs after a failed attempt (e.g. kill a half-spawned process) before retry.
export const withKuboBindRetry = async <T>(
    start: (endpoints: KuboEndpoints) => Promise<T>,
    { retries = 4, cleanup }: { retries?: number; cleanup?: (endpoints: KuboEndpoints) => Promise<void> | void } = {}
): Promise<{ result: T; endpoints: KuboEndpoints }> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
        const endpoints = await allocateKuboEndpoints();
        try {
            const result = await start(endpoints);
            return { result, endpoints };
        } catch (reason) {
            lastError = reason;
            await cleanup?.(endpoints);
            if (!isAddressInUseError(reason) || attempt === retries) throw reason;
        }
    }
    throw lastError;
};
