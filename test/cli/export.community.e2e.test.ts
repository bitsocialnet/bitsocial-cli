import { spawn } from "child_process";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import fsPromise from "node:fs/promises";
import { directory as randomDirectory } from "tempy";
import WebSocket from "ws";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    startPkcDaemonWithDynamicPorts,
    waitForCondition,
    waitForWebSocketOpen,
    waitForPortFree
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first");

// `community export` against a real daemon and the real pkc-js RPC client, through a TCP proxy that cuts the RPC
// connection right after the export started. The mocked tests in export.community.test.ts fake the client's states
// and the exports the daemon sends when pkc-js re-subscribes, so they cannot tell whether the real client and
// daemon behave that way.

let RPC_PORT: number;
let KUBO_API_PORT: number;
let GATEWAY_PORT: number;
let rpcWsUrl: string;

const runBitsocialCommand = (args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", ...args], {
            stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error(`Command timed out after ${timeoutMs}ms: bitsocial ${args.join(" ")}\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, timeoutMs);
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });
};

// The answer to the exportCommunity call: { jsonrpc, id, result: { exportId } }. The exports themselves arrive as
// exportschange notifications, which have no id.
const isExportCallResponse = (payload: Buffer): boolean => {
    try {
        const message = JSON.parse(payload.toString("utf-8"));
        return message?.id !== undefined && typeof message?.result?.exportId === "string";
    } catch {
        return false;
    }
};

type CuttingProxy = {
    port: number;
    /** Cut the RPC connection right after the next exportCommunity answer went to the client. */
    cutAfterExportCallResponse: (opts: { refuseConnectionsAfterwards: boolean }) => void;
    reset: () => void;
    readonly cuts: number;
    /** Websocket connections the daemon accepted through the proxy. */
    readonly webSocketConnections: number;
    close: () => Promise<void>;
};

// Forwards TCP to the daemon. Plain HTTP (the snapshot download) passes untouched. On a websocket it forwards the
// daemon's frames one at a time, so it can drop the connection exactly after the frame that answers exportCommunity:
// the client has the exportId, and every later exportschange (progress, result) is lost with the connection.
const startCuttingProxy = async (targetPort: number): Promise<CuttingProxy> => {
    let armed: { refuseConnectionsAfterwards: boolean } | undefined;
    let refusing = false;
    let cuts = 0;
    let webSocketConnections = 0;
    const sockets = new Set<net.Socket>();

    const server = net.createServer((client) => {
        if (refusing) {
            client.destroy();
            return;
        }
        const upstream = net.connect(targetPort, "127.0.0.1");
        for (const socket of [client, upstream]) {
            sockets.add(socket);
            socket.on("error", () => {});
            socket.on("close", () => {
                sockets.delete(socket);
                client.destroy();
                upstream.destroy();
            });
        }

        let sawRequestHead = false;
        client.on("data", (chunk: Buffer) => {
            if (!sawRequestHead) {
                sawRequestHead = true;
                // Keep the frames uncompressed, so the proxy can read them
                chunk = Buffer.from(chunk.toString("latin1").replace(/^Sec-WebSocket-Extensions:.*\r\n/im, ""), "latin1");
            }
            upstream.write(chunk);
        });

        let isWebSocket: boolean | undefined;
        let buffered: Buffer = Buffer.alloc(0);
        upstream.on("data", (chunk: Buffer) => {
            if (isWebSocket === false) {
                client.write(chunk);
                return;
            }
            buffered = Buffer.concat([buffered, chunk]);
            if (isWebSocket === undefined) {
                const headEnd = buffered.indexOf("\r\n\r\n");
                if (headEnd < 0) return;
                isWebSocket = buffered.subarray(0, 12).toString("latin1") === "HTTP/1.1 101";
                if (!isWebSocket) {
                    client.write(buffered);
                    buffered = Buffer.alloc(0);
                    return;
                }
                webSocketConnections++;
                client.write(buffered.subarray(0, headEnd + 4));
                buffered = buffered.subarray(headEnd + 4);
            }
            // Frames from a server are not masked: 2 header bytes, then an extended length for 126 and 127
            while (buffered.length >= 2) {
                let payloadLength = buffered[1] & 0x7f;
                let headerLength = 2;
                if (payloadLength === 126) {
                    if (buffered.length < 4) return;
                    payloadLength = buffered.readUInt16BE(2);
                    headerLength = 4;
                } else if (payloadLength === 127) {
                    if (buffered.length < 10) return;
                    payloadLength = Number(buffered.readBigUInt64BE(2));
                    headerLength = 10;
                }
                if (buffered.length < headerLength + payloadLength) return;
                const frame = buffered.subarray(0, headerLength + payloadLength);
                buffered = buffered.subarray(headerLength + payloadLength);
                if (armed && isExportCallResponse(frame.subarray(headerLength))) {
                    refusing = armed.refuseConnectionsAfterwards;
                    armed = undefined;
                    cuts++;
                    // No close frame, like a daemon that died or a network that dropped
                    client.end(frame, () => client.destroy());
                    upstream.destroy();
                    return;
                }
                client.write(frame);
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    return {
        port: (server.address() as net.AddressInfo).port,
        cutAfterExportCallResponse: (opts) => {
            armed = opts;
        },
        reset: () => {
            armed = undefined;
            refusing = false;
            cuts = 0;
            webSocketConnections = 0;
            for (const socket of sockets) socket.destroy();
        },
        get cuts() {
            return cuts;
        },
        get webSocketConnections() {
            return webSocketConnections;
        },
        close: async () => {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    };
};

describe("bitsocial community export when the RPC connection drops (real pkc daemon)", () => {
    let daemonProcess: ManagedChildProcess;
    let communityAddress: string;
    let proxy: CuttingProxy;
    let proxyRpcUrl: string;

    beforeAll(async () => {
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        ({ rpcPort: RPC_PORT, kuboPort: KUBO_API_PORT, gatewayPort: GATEWAY_PORT, rpcWsUrl } = daemon);

        await waitForCondition(
            async () => {
                try {
                    const ws = new WebSocket(rpcWsUrl);
                    await waitForWebSocketOpen(ws, 2000);
                    ws.close();
                    return true;
                } catch {
                    return false;
                }
            },
            15000,
            500
        );

        const result = await runBitsocialCommand(["community", "create", "--description", "export drop test", "--pkcRpcUrl", rpcWsUrl]);
        expect(result.exitCode, `community create failed: ${result.stderr}`).toBe(0);
        communityAddress = result.stdout.trim();
        expect(communityAddress).toBeTruthy();

        proxy = await startCuttingProxy(RPC_PORT);
        proxyRpcUrl = `ws://127.0.0.1:${proxy.port}`;
    }, 180_000);

    afterEach(() => proxy?.reset());

    afterAll(async () => {
        await proxy?.close();
        await stopPkcDaemon(daemonProcess);
        await Promise.all([waitForPortFree(RPC_PORT), waitForPortFree(KUBO_API_PORT), waitForPortFree(GATEWAY_PORT)]);
    }, 60_000);

    const exportThroughProxy = (destPath: string, timeoutMs: number) =>
        runBitsocialCommand(["community", "export", communityAddress, "--path", destPath, "--pkcRpcUrl", proxyRpcUrl], timeoutMs);

    it("exports through the proxy when the connection stays up", { timeout: 120_000 }, async () => {
        const destPath = path.join(randomDirectory(), "export.sqlite");
        const result = await exportThroughProxy(destPath, 90_000);
        expect(result.exitCode, `community export failed: ${result.stderr}`).toBe(0);
        expect(result.stdout.trim()).toBe(destPath);
        expect((await fsPromise.readFile(destPath)).subarray(0, 15).toString()).toBe("SQLite format 3");
        expect(proxy.webSocketConnections).toBe(1);
    });

    // pkc-js reconnects, re-subscribes to the exports, and the daemon answers with the exports it has, which outlive
    // the connection that started them
    it("finishes after a short drop, from the exports the daemon sends once pkc-js reconnected", { timeout: 120_000 }, async () => {
        proxy.cutAfterExportCallResponse({ refuseConnectionsAfterwards: false });
        const destPath = path.join(randomDirectory(), "export.sqlite");

        const result = await exportThroughProxy(destPath, 90_000);

        expect(proxy.cuts, "the proxy never saw the exportCommunity answer, so nothing was cut").toBe(1);
        expect(result.exitCode, `community export failed after a short drop: ${result.stderr}`).toBe(0);
        expect(result.stdout.trim()).toBe(destPath);
        expect((await fsPromise.readFile(destPath)).subarray(0, 15).toString()).toBe("SQLite format 3");
        // The result could only arrive over a second connection
        expect(proxy.webSocketConnections).toBeGreaterThanOrEqual(2);
    });

    // A daemon that died never answers again. The command used to sit at its last percentage until Ctrl+C; now it
    // gives pkc-js 60s to get the export back and fails.
    it("fails instead of hanging when the connection never comes back", { timeout: 180_000 }, async () => {
        proxy.cutAfterExportCallResponse({ refuseConnectionsAfterwards: true });
        const destPath = path.join(randomDirectory(), "export.sqlite");

        const startedAt = Date.now();
        const result = await exportThroughProxy(destPath, 150_000);
        const elapsedMs = Date.now() - startedAt;

        expect(proxy.cuts, "the proxy never saw the exportCommunity answer, so nothing was cut").toBe(1);
        expect(result.exitCode, `community export exited 0 without a connection: ${result.stdout}`).toBe(1);
        expect(result.stderr).toContain("Lost the connection to the RPC server during the export");
        expect(result.stdout.trim()).toBe("");
        expect(elapsedMs, `took ${elapsedMs}ms to give up`).toBeGreaterThan(55_000);
        await expect(fsPromise.stat(destPath)).rejects.toThrow();
    });
});

// `--no-allowPrivateKeyExport` is what an operator passes before exposing the RPC to clients that must not get the
// community's private key. The prerun hook used to register it as an unrelated dynamic flag whenever another flag
// was passed with it (here --pkcRpcUrl), so the daemon kept serving private-key exports. The other tests cover the
// parsing (parse-dynamic-flags-hook.test.ts) and the option handed to the RPC server (daemon-server.test.ts); this
// one asks a real daemon for the key.
describe("bitsocial daemon --no-allowPrivateKeyExport (real pkc daemon)", () => {
    let daemonProcess: ManagedChildProcess;
    let ports: number[];
    let daemonRpcUrl: string;
    let communityAddress: string;

    beforeAll(async () => {
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--no-allowPrivateKeyExport", "--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        ports = [daemon.rpcPort, daemon.kuboPort, daemon.gatewayPort];
        daemonRpcUrl = daemon.rpcWsUrl;

        await waitForCondition(
            async () => {
                try {
                    const ws = new WebSocket(daemonRpcUrl);
                    await waitForWebSocketOpen(ws, 2000);
                    ws.close();
                    return true;
                } catch {
                    return false;
                }
            },
            15000,
            500
        );

        const result = await runBitsocialCommand(["community", "create", "--description", "private key export test", "--pkcRpcUrl", daemonRpcUrl]);
        expect(result.exitCode, `community create failed: ${result.stderr}`).toBe(0);
        communityAddress = result.stdout.trim();
        expect(communityAddress).toBeTruthy();
    }, 180_000);

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await Promise.all(ports.map((port) => waitForPortFree(port)));
    }, 60_000);

    it("refuses an export that includes the private key", { timeout: 120_000 }, async () => {
        const destPath = path.join(randomDirectory(), "with-key.sqlite");
        const result = await runBitsocialCommand(
            ["community", "export", communityAddress, "--includePrivateKey", "--path", destPath, "--pkcRpcUrl", daemonRpcUrl],
            90_000
        );
        expect(result.exitCode, `the daemon exported the private key: ${result.stdout}`).toBe(1);
        expect(result.stdout.trim()).toBe("");
        expect(result.stderr).toContain("ERR_PRIVATE_KEY_EXPORT_NOT_ALLOWED");
        await expect(fsPromise.stat(destPath)).rejects.toThrow();
    });

    it("still exports without the private key", { timeout: 120_000 }, async () => {
        const destPath = path.join(randomDirectory(), "without-key.sqlite");
        const result = await runBitsocialCommand(["community", "export", communityAddress, "--path", destPath, "--pkcRpcUrl", daemonRpcUrl], 90_000);
        expect(result.exitCode, `community export failed: ${result.stderr}`).toBe(0);
        expect((await fsPromise.readFile(destPath)).subarray(0, 15).toString()).toBe("SQLite format 3");
    });
});
