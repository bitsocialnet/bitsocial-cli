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
    startPkcDaemonWithDynamicPorts,
    waitForCondition,
    waitForWebSocketOpen,
    waitForPortFree
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first");

// Ports/URLs are allocated dynamically per run and assigned in beforeAll (issue #87).
let RPC_PORT: number;
let KUBO_API_PORT: number;
let GATEWAY_PORT: number;
let rpcWsUrl: string;

// Cap diagnostic dumps so a timeout error stays readable
const tailOf = (text: string, maxChars = 8_000): string =>
    text.length > maxChars ? `...(truncated)...${text.slice(-maxChars)}` : text;

// Generic subprocess runner with timeout.
//
// The vitest per-test timeouts below are intentionally LARGER than timeoutMs:
// this rejection (which carries the child's stdout/stderr and any extra
// diagnostics) must fire before vitest's generic "Test timed out", otherwise a
// hang in CI produces no information at all (issue #140).
const runBitsocialCommand = (
    args: string[],
    env?: Record<string, string>,
    timeoutMs = 10_000,
    collectTimeoutDiagnostics?: () => Promise<string>
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
        // Once the timeout fires, the SIGKILL below triggers "close" while we
        // are still awaiting the diagnostics collection — the close handler
        // must not resolve then, or the informative rejection would be lost.
        let timedOut = false;
        const timer = setTimeout(async () => {
            timedOut = true;
            proc.kill("SIGKILL");
            let extraDiagnostics = "";
            if (collectTimeoutDiagnostics)
                extraDiagnostics = await collectTimeoutDiagnostics().catch((e) => `failed to collect diagnostics: ${e}`);
            reject(
                new Error(
                    `Command timed out after ${timeoutMs}ms: bitsocial ${args.join(" ")}\nstdout: ${tailOf(stdout)}\nstderr: ${tailOf(stderr)}\n${extraDiagnostics}`
                )
            );
        }, timeoutMs);
        proc.on("close", (exitCode) => {
            if (timedOut) return;
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

    // Daemon-side context for command timeouts: the daemon's captured output
    // plus the tail of its log files, which otherwise live in a temp dir CI
    // never surfaces (issue #140).
    const collectDaemonDiagnostics = async (): Promise<string> => {
        const parts: string[] = [
            `daemon stdout (tail): ${tailOf(daemonProcess?.capturedStdout ?? "<none>")}`,
            `daemon stderr (tail): ${tailOf(daemonProcess?.capturedStderr ?? "<none>")}`
        ];
        try {
            const logFiles = (await fsPromise.readdir(logDir)).filter((f) => f.endsWith(".log"));
            for (const logFile of logFiles) {
                const content = await fsPromise.readFile(path.join(logDir, logFile), "utf8");
                parts.push(`daemon log ${logFile} (tail): ${tailOf(content)}`);
            }
            if (logFiles.length === 0) parts.push(`daemon log dir ${logDir} contains no .log files`);
        } catch (e) {
            parts.push(`failed to read daemon log dir ${logDir}: ${e}`);
        }
        return parts.join("\n");
    };

    beforeAll(async () => {
        stateHome = randomDirectory();
        logDir = path.join(stateHome, "bitsocial");
        await fsPromise.mkdir(logDir, { recursive: true });

        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--logPath", logDir, "--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        ({ rpcPort: RPC_PORT, kuboPort: KUBO_API_PORT, gatewayPort: GATEWAY_PORT, rpcWsUrl } = daemon);

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

    it("community create completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "create", "--description", "test community", "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        communityAddress = result.stdout.trim();
        expect(communityAddress.length).toBeGreaterThan(0);
    });

    it("community list -q completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "list", "-q", "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain(communityAddress);
    });

    it("community list (table) completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "list", "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain(communityAddress);
    });

    it("community get completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "get", communityAddress, "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        const json = JSON.parse(result.stdout);
        expect(json).toHaveProperty("address");
    });

    it("community edit completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "edit", communityAddress, "--title", "new title", "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community stop completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community start completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "start", communityAddress, "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community stop (before delete) completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "stop", communityAddress, "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community delete completes within 30s", { timeout: 60_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "delete", communityAddress, "--pkcRpcUrl", rpcWsUrl],
            undefined,
            30_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).toBe(communityAddress);
    });

    it("community list -q shows no communities after delete", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["community", "list", "-q", "--pkcRpcUrl", rpcWsUrl],
            undefined,
            10_000,
            collectDaemonDiagnostics
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout.trim()).not.toContain(communityAddress);
    });

    it("logs --tail 1 completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["logs", "--tail", "1", "--logPath", logDir],
            undefined,
            10_000,
            collectDaemonDiagnostics
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

    it("challenge list (empty) completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "list", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("No challenge packages installed");
    });

    it("challenge install completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("added test-challenge@1.0.0 in");
    });

    it("challenge list (after install) completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "list", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("test-challenge");
    });

    it("challenge remove completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "remove", "test-challenge", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("removed test-challenge@1.0.0");
    });

    it("challenge list (after remove) completes within 10s", { timeout: 30_000 }, async () => {
        const result = await runBitsocialCommand(
            ["challenge", "list", "--pkcOptions.dataPath", dataPath]
        );
        expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
        expect(result.stdout).toContain("No challenge packages installed");
    });
});
