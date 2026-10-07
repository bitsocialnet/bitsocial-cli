import { spawn } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import dns from "node:dns";
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

let RPC_PORT: number;
let KUBO_API_PORT: number;
let GATEWAY_PORT: number;
let rpcWsUrl: string;

const runBitsocialCommand = (
    args: string[],
    timeoutMs = 60_000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
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

// `community list` prints a table; read the started column of the community's row.
const isStarted = async (address: string): Promise<boolean | undefined> => {
    const result = await runBitsocialCommand(["community", "list", "--pkcRpcUrl", rpcWsUrl]);
    expect(result.exitCode, `community list failed: ${result.stderr}`).toBe(0);
    const row = result.stdout.split(/\r?\n/).find((line) => line.includes(address));
    if (!row) return undefined;
    if (/\btrue\b/.test(row)) return true;
    if (/\bfalse\b/.test(row)) return false;
    return undefined;
};

describe("bitsocial community stop (real pkc instance)", () => {
    let daemonProcess: ManagedChildProcess;
    let communityAddress: string;

    beforeAll(async () => {
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        ({ rpcPort: RPC_PORT, kuboPort: KUBO_API_PORT, gatewayPort: GATEWAY_PORT, rpcWsUrl } = daemon);

        await waitForCondition(async () => {
            try {
                const ws = new WebSocket(rpcWsUrl);
                await waitForWebSocketOpen(ws, 2000);
                ws.close();
                return true;
            } catch {
                return false;
            }
        }, 15000, 500);

        // `community create` starts the community on the daemon
        const result = await runBitsocialCommand(["community", "create", "--description", "stop test", "--pkcRpcUrl", rpcWsUrl]);
        expect(result.exitCode, `create failed: ${result.stderr}`).toBe(0);
        communityAddress = result.stdout.trim();
        await waitForCondition(async () => (await isStarted(communityAddress)) === true, 30000, 1000);
    }, 180_000);

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await Promise.all([waitForPortFree(RPC_PORT), waitForPortFree(KUBO_API_PORT), waitForPortFree(GATEWAY_PORT)]);
    }, 60_000);

    it("stops a community the daemon is running", { timeout: 120_000 }, async () => {
        const result = await runBitsocialCommand(["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl]);
        expect(result.exitCode, `stop failed: ${result.stderr}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);

        let started: boolean | undefined;
        await waitForCondition(
            async () => {
                started = await isStarted(communityAddress);
                return started === false;
            },
            20000,
            1000
        ).catch(() => {});
        expect(started).toBe(false);
    });

    it("succeeds without starting a community that is already stopped", { timeout: 120_000 }, async () => {
        const result = await runBitsocialCommand(["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl]);
        expect(result.exitCode, `stop failed: ${result.stderr}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
        expect(await isStarted(communityAddress)).toBe(false);
    });
});
