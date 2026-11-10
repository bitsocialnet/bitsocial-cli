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

// Reproduction for issue #152: `community stop` exits 0 but a community the daemon is running
// keeps running. The mocked `stop.community.test.ts` fakes `createCommunity`, so it cannot see
// this; the bug only shows against a real daemon over the PKC RPC.

// Ports/URLs are allocated dynamically per run and assigned in beforeAll (issue #87).
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

// `started` as the daemon reports it. `community get` serialises the RPC instance, whose `started`
// field is populated from the server's localCommunity record (the same value `community list`
// prints in its `started` column).
const isStartedOnDaemon = async (address: string): Promise<boolean> => {
    const result = await runBitsocialCommand(["community", "get", address, "--pkcRpcUrl", rpcWsUrl]);
    expect(result.exitCode, `community get failed: ${result.stderr}`).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(typeof json.started, `community get JSON has no boolean 'started': ${result.stdout}`).toBe("boolean");
    return json.started;
};

describe("bitsocial community stop (real pkc daemon, issue #152)", () => {
    let daemonProcess: ManagedChildProcess;
    let communityAddress: string;

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

        // `community create` starts the community on the daemon before printing its address
        const result = await runBitsocialCommand(["community", "create", "--description", "issue 152 stop test", "--pkcRpcUrl", rpcWsUrl]);
        expect(result.exitCode, `community create failed: ${result.stderr}`).toBe(0);
        communityAddress = result.stdout.trim();
        expect(communityAddress).toBeTruthy();
        await waitForCondition(async () => (await isStartedOnDaemon(communityAddress)) === true, 30000, 1000);
    }, 180_000);

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await Promise.all([waitForPortFree(RPC_PORT), waitForPortFree(KUBO_API_PORT), waitForPortFree(GATEWAY_PORT)]);
    }, 60_000);

    // pkc-js hands back a remote instance for an address the daemon does not list. `community stop` used to
    // print that address and exit 0, exactly like a real stop, while the intended community kept running
    it("fails for an address the daemon does not host", { timeout: 120_000 }, async () => {
        const notHosted = "not-hosted-by-this-daemon.bso";
        const stop = await runBitsocialCommand(["community", "stop", notHosted, "--pkcRpcUrl", rpcWsUrl]);
        expect(stop.exitCode, `community stop exited 0 for an address the daemon does not host: ${stop.stdout}`).toBe(1);
        expect(stop.stdout.trim()).toBe("");
        expect(stop.stderr).toContain(notHosted);
        expect(await isStartedOnDaemon(communityAddress)).toBe(true);
    });

    it("stops a community the daemon is running", { timeout: 120_000 }, async () => {
        const stop = await runBitsocialCommand(["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl]);
        expect(stop.exitCode, `community stop failed: ${stop.stderr}`).toBe(0);
        expect(stop.stdout.trim()).toBe(communityAddress);

        // Give the daemon a moment to apply the stop; the bug is that it never receives one.
        let started = true;
        await waitForCondition(
            async () => {
                started = await isStartedOnDaemon(communityAddress);
                return started === false;
            },
            20000,
            1000
        ).catch(() => {});
        expect(started, `daemon still reports ${communityAddress} as started after 'community stop' exited 0`).toBe(false);
    });
});
