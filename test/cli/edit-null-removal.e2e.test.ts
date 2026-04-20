import { spawn } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { file as tempFile } from "tempy";
import fsPromises from "fs/promises";
import dns from "node:dns";
import WebSocket from "ws";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    startPkcDaemon,
    waitForCondition,
    waitForWebSocketOpen,
    waitForPortFree
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first");

// --- Port allocation (unique to this test file) ---
const RPC_PORT = 9638;
const KUBO_API_PORT = 50309;
const GATEWAY_PORT = 6803;
const rpcWsUrl = `ws://localhost:${RPC_PORT}`;
const kuboApiUrl = `http://0.0.0.0:${KUBO_API_PORT}/api/v0`;
const gatewayUrl = `http://0.0.0.0:${GATEWAY_PORT}`;

const runBitsocialCommand = (
    args: string[],
    timeoutMs = 30_000
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

const getCommunityJson = async (address: string): Promise<Record<string, any>> => {
    const result = await runBitsocialCommand(["community", "get", address, "--pkcRpcUrl", rpcWsUrl]);
    expect(result.exitCode, `community get failed: ${result.stderr}`).toBe(0);
    return JSON.parse(result.stdout);
};

// Use public key addresses — pkc-js rejects unresolvable .bso/.eth names
const ROLE_ADDR_A = "12D3KooWNMYPSuPu8AiY6wRq5TJfx3r5pGoTNfRp6kHkgeUE2vpa";
const ROLE_ADDR_B = "12D3KooWQbMbKTraSdLHvBJjiUGVwF2pPTt5J4Rv5cU4gMvJxFzr";
const ROLE_ADDR_C = "12D3KooWRMT4vT7oEDN4Wdt5k87g3c6dXwVvGC2qhLNm6gNKVDHQ";
const ROLE_ADDR_D = "12D3KooWSr2HDqABjBbE3CH37YXZ3F6XDwGPDZgSwE8cQkLNB5rR";

describe("community edit null removal (real pkc instance)", () => {
    let daemonProcess: ManagedChildProcess;
    let communityAddress: string;

    beforeAll(async () => {
        daemonProcess = await startPkcDaemon(
            ["--pkcRpcUrl", rpcWsUrl],
            { KUBO_RPC_URL: kuboApiUrl, IPFS_GATEWAY_URL: gatewayUrl }
        );

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

        // Create a community for all tests to share
        const result = await runBitsocialCommand([
            "community", "create", "--description", "null removal test", "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(result.exitCode, `create failed: ${result.stderr}`).toBe(0);
        communityAddress = result.stdout.trim();
    }, 120_000);

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await Promise.all([
            waitForPortFree(RPC_PORT),
            waitForPortFree(KUBO_API_PORT),
            waitForPortFree(GATEWAY_PORT)
        ]);
    }, 60_000);

    it("Setting a role to null via CLI removes it", { timeout: 30_000 }, async () => {
        // Add a role
        const addResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            `--roles["${ROLE_ADDR_A}"].role`, "admin",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(addResult.exitCode, `edit add failed: ${addResult.stderr}`).toBe(0);

        // Verify role was added
        let community = await getCommunityJson(communityAddress);
        let roles = community.roles || {};
        expect(roles[ROLE_ADDR_A]).toEqual({ role: "admin" });

        // Remove via null
        const removeResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            `--roles["${ROLE_ADDR_A}"]`, "null",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(removeResult.exitCode, `edit remove failed: ${removeResult.stderr}`).toBe(0);

        // Verify role was removed
        community = await getCommunityJson(communityAddress);
        roles = community.roles || {};
        expect(roles[ROLE_ADDR_A]).toBeUndefined();
    });

    it("Setting a role to null via JSON file removes it", { timeout: 30_000 }, async () => {
        // Add a role first
        const addResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            `--roles["${ROLE_ADDR_B}"].role`, "moderator",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(addResult.exitCode, `edit add failed: ${addResult.stderr}`).toBe(0);

        let community = await getCommunityJson(communityAddress);
        let roles = community.roles || {};
        expect(roles[ROLE_ADDR_B]).toEqual({ role: "moderator" });

        // Remove via JSON file with null
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ roles: { [ROLE_ADDR_B]: null } }));

        const removeResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            "--jsonFile", jsonPath,
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(removeResult.exitCode, `edit remove via json failed: ${removeResult.stderr}`).toBe(0);

        community = await getCommunityJson(communityAddress);
        roles = community.roles || {};
        expect(roles[ROLE_ADDR_B]).toBeUndefined();
    });

    it("Setting a top-level field to null via CLI removes it", { timeout: 30_000 }, async () => {
        // Set a description first
        const setResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            "--description", "test description",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(setResult.exitCode, `edit set failed: ${setResult.stderr}`).toBe(0);

        let community = await getCommunityJson(communityAddress);
        expect(community.description).toBe("test description");

        // Remove via null
        const removeResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            "--description", "null",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(removeResult.exitCode, `edit remove failed: ${removeResult.stderr}`).toBe(0);

        community = await getCommunityJson(communityAddress);
        expect(community.description).toBeUndefined();
    });

    it("Setting a nested object to null via CLI removes it", { timeout: 30_000 }, async () => {
        // Set suggested fields first
        const setResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            "--suggested.primaryColor", "blue",
            "--suggested.language", "en",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(setResult.exitCode, `edit set failed: ${setResult.stderr}`).toBe(0);

        let community = await getCommunityJson(communityAddress);
        expect(community.suggested?.primaryColor).toBe("blue");

        // Remove via null
        const removeResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            "--suggested", "null",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(removeResult.exitCode, `edit remove failed: ${removeResult.stderr}`).toBe(0);

        community = await getCommunityJson(communityAddress);
        expect(community.suggested).toBeUndefined();
    });

    it("Mixed null and non-null roles: remove one, add another", { timeout: 30_000 }, async () => {
        // Add a role to remove later
        const addResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            `--roles["${ROLE_ADDR_C}"].role`, "admin",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(addResult.exitCode, `edit add failed: ${addResult.stderr}`).toBe(0);

        let community = await getCommunityJson(communityAddress);
        let roles = community.roles || {};
        expect(roles[ROLE_ADDR_C]).toEqual({ role: "admin" });

        // Simultaneously remove ROLE_ADDR_C and add ROLE_ADDR_D
        const editResult = await runBitsocialCommand([
            "community", "edit", communityAddress,
            `--roles["${ROLE_ADDR_D}"].role`, "moderator",
            `--roles["${ROLE_ADDR_C}"]`, "null",
            "--pkcRpcUrl", rpcWsUrl
        ]);
        expect(editResult.exitCode, `edit mixed failed: ${editResult.stderr}`).toBe(0);

        community = await getCommunityJson(communityAddress);
        roles = community.roles || {};
        expect(roles[ROLE_ADDR_D]).toEqual({ role: "moderator" });
        expect(roles[ROLE_ADDR_C]).toBeUndefined();
    });
});
