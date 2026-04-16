import { spawn } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
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
const RPC_PORT = 9538;
const KUBO_API_PORT = 50209;
const GATEWAY_PORT = 6703;
const rpcWsUrl = `ws://localhost:${RPC_PORT}`;
const kuboApiUrl = `http://0.0.0.0:${KUBO_API_PORT}/api/v0`;
const gatewayUrl = `http://0.0.0.0:${GATEWAY_PORT}`;

// Generic subprocess runner with timeout
const runBitsocialCommand = (
    args: string[],
    env?: Record<string, string>,
    timeoutMs = 10_000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", ...args], {
            stdio: ["pipe", "pipe", "pipe"],
            env: env ? { ...process.env, ...env } : undefined
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

// Helper to create a minimal challenge package directory (same pattern as challenge.test.ts)
const createMinimalChallengeDir = async (
    dir: string,
    name: string,
    opts?: { version?: string; description?: string }
): Promise<void> => {
    await fsPromise.mkdir(dir, { recursive: true });
    const pkg: Record<string, string> = { name };
    if (opts?.version) pkg.version = opts.version;
    if (opts?.description) pkg.description = opts.description;
    await fsPromise.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    await fsPromise.writeFile(
        path.join(dir, "index.js"),
        `export default function(args) {
    return {
        type: 'text/plain',
        challenge: '1+1',
        getChallenge: async () => ({ challenge: '1+1', type: 'text/plain', verify: async (answer) => ({ success: answer === '2' }) })
    };
};
`
    );
};

describe("CLI commands complete within 10s (real pkc instance)", () => {
    let daemonProcess: ManagedChildProcess;
    let communityAddress: string;
    let stateHome: string;
    let logDir: string;

    beforeAll(async () => {
        stateHome = randomDirectory();
        logDir = path.join(stateHome, "bitsocial");
        await fsPromise.mkdir(logDir, { recursive: true });

        daemonProcess = await startPkcDaemon(
            ["--logPath", logDir, "--pkcRpcUrl", rpcWsUrl],
            { KUBO_RPC_URL: kuboApiUrl, IPFS_GATEWAY_URL: gatewayUrl }
        );

        // Wait for log file to appear
        await waitForCondition(async () => {
            const files = await fsPromise.readdir(logDir);
            return files.some((f) => f.startsWith("bitsocial_cli_daemon_") && f.endsWith(".log"));
        }, 10000, 500);

        // Wait for RPC WebSocket to accept connections
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
    }, 120_000);

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
        await Promise.all([
            waitForPortFree(RPC_PORT),
            waitForPortFree(KUBO_API_PORT),
            waitForPortFree(GATEWAY_PORT),
        ]);
    }, 60_000);

    it("community create completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "create", "--description", "test community", "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        communityAddress = result.stdout.trim();
        expect(communityAddress.length).toBeGreaterThan(0);
    });

    it("community list -q completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "list", "-q", "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain(communityAddress);
    });

    it("community list (table) completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "list", "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain(communityAddress);
    });

    it("community get completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "get", communityAddress, "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        const json = JSON.parse(result.stdout);
        expect(json).toHaveProperty("address");
    });

    it("community edit completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "edit", communityAddress, "--title", "new title", "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community stop completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community start completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "start", communityAddress, "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community stop (before delete) completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community delete completes within 30s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "delete", communityAddress, "--pkcRpcUrl", rpcWsUrl],
            undefined,
            30_000
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community list -q shows no communities after delete", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "list", "-q", "--pkcRpcUrl", rpcWsUrl]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).not.toContain(communityAddress);
    });

    it("logs --tail 1 completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["logs", "--tail", "1", "--logPath", logDir]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.length).toBeGreaterThan(0);
    });
});

describe("challenge commands complete within 10s", () => {
    let challengeSrcDir: string;
    let dataPath: string;

    beforeAll(async () => {
        const tmpDir = randomDirectory();
        challengeSrcDir = path.join(tmpDir, "test-challenge");
        await createMinimalChallengeDir(challengeSrcDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge for completion time tests"
        });
        dataPath = randomDirectory();
    });

    it("challenge list (empty) completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "list", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("No challenge packages installed");
    });

    it("challenge install completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("Installed challenge 'test-challenge@1.0.0'");
    });

    it("challenge list (after install) completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "list", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("test-challenge");
    });

    it("challenge remove completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "remove", "test-challenge", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("Removed challenge 'test-challenge'");
    });

    it("challenge list (after remove) completes within 10s", { timeout: 10_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "list", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("No challenge packages installed");
    });
});
