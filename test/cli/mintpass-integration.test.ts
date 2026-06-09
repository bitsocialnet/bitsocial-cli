import { ChildProcess, spawn } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import dns from "node:dns";
import PKC from "@pkcprotocol/pkc-js";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    waitForCondition,
    startPkcDaemonWithDynamicPorts,
    waitForKuboReady
} from "../helpers/daemon-helpers.js";

dns.setDefaultResultOrder("ipv4first");

type PKCInstance = Awaited<ReturnType<typeof PKC>>;

// Ports/URLs are allocated dynamically per run and assigned in beforeAll (issue #87).
let RPC_PORT: number;
let KUBO_API_PORT: number;
let rpcWsUrl: string;

// --- Helpers specific to this test file ---

const runBitsocialChallenge = (
    args: string[],
    env?: Record<string, string>,
    timeoutMs = 240_000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", "challenge", ...args], {
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
            reject(new Error(`bitsocial challenge command timed out after ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, timeoutMs);
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });
};

// --- Core helper: publish a comment and go through the challenge flow ---

async function publishCommentWithChallenge(opts: {
    pkc: PKCInstance;
    communityAddress: string;
    challengeAnswer: string;
    timeoutMs?: number;
}): Promise<{
    challengeSuccess: boolean;
    challengeText?: string;
    challengeErrors?: Record<string, string>;
}> {
    const { pkc, communityAddress, challengeAnswer, timeoutMs = 60000 } = opts;
    const signer = await pkc.createSigner();
    const comment = await pkc.createComment({
        signer,
        communityAddress: communityAddress,
        content: "test comment " + Date.now(),
        title: "test title"
    });

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for challenge flow to complete`));
        }, timeoutMs);

        let challengeText: string | undefined;

        comment.on("challenge", async (challengeMsg: any) => {
            try {
                challengeText = challengeMsg.challenges?.[0]?.challenge;
                await comment.publishChallengeAnswers({ challengeAnswers: [challengeAnswer] });
            } catch (err) {
                clearTimeout(timeout);
                reject(err);
            }
        });

        comment.on("challengeverification", (verification: any) => {
            clearTimeout(timeout);
            resolve({
                challengeSuccess: verification.challengeSuccess,
                challengeText,
                challengeErrors: verification.challengeErrors
            });
        });

        comment.on("error", (err: Error) => {
            clearTimeout(timeout);
            reject(err);
        });

        comment.publish();
    });
}

// --- Tests ---

// Skipped on Windows: npm install for this challenge package is extremely slow on Windows CI
// (NTFS + Windows Defender overhead with hundreds of transitive deps + sqlite3 native compilation).
// The same logic is covered by Ubuntu and macOS CI runs.
describe.skipIf(process.platform === "win32")("@bitsocial/mintpass-challenge integration tests", { timeout: 720_000 }, () => {
    let daemonProcess: ManagedChildProcess | undefined;
    let pkc: PKCInstance;
    let dataPath: string;

    beforeAll(async () => {
        dataPath = randomDirectory();

        // Install the real @bitsocial/mintpass-challenge package from npm
        const installResult = await runBitsocialChallenge(["install", "@bitsocial/mintpass-challenge", "--pkcOptions.dataPath", dataPath], undefined, 420_000);
        expect(installResult.exitCode).toBe(0);
        expect(installResult.stdout).toContain("added @bitsocial/mintpass-challenge");

        // Start daemon — it handles kubo, RPC, and webui internally. Dynamic ports + retry guard
        // against the macOS ephemeral-range bind race (issue #87); the seeded dataPath is reused
        // across retries (preInitKuboWithEphemeralSwarm is idempotent).
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        ({ rpcPort: RPC_PORT, kuboPort: KUBO_API_PORT, rpcWsUrl } = daemon);

        // Wait for kubo API to be fully ready (it can lag behind the "Communities in data path" message)
        const kuboReady = await waitForKuboReady(`http://localhost:${KUBO_API_PORT}/api/v0`, 30000);
        expect(kuboReady).toBe(true);

        // Connect pkc-js RPC client
        pkc = await PKC({ pkcRpcClientsOptions: [rpcWsUrl] });
        pkc.on("error", (err) => console.error("PKC RPC error:", err));
        await new Promise((resolve) => pkc.once("communitieschange", resolve));

        // Give the daemon's internal IPFS connections time to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }, 480_000);

    afterAll(async () => {
        try {
            await pkc?.destroy();
        } catch {
            /* ignore */
        }
        await stopPkcDaemon(daemonProcess);
    });

    it("daemon loads @bitsocial/mintpass-challenge on startup", () => {
        expect(daemonProcess?.capturedStdout).toContain("@bitsocial/mintpass-challenge");
    });

    it("challenge list includes @bitsocial/mintpass-challenge", { timeout: 120_000 }, async () => {
        const listResult = await runBitsocialChallenge(["list", "--pkcOptions.dataPath", dataPath]);
        expect(listResult.exitCode).toBe(0);
        expect(listResult.stdout).toContain("@bitsocial/mintpass-challenge");
    });

    it("challenge reload endpoint includes @bitsocial/mintpass-challenge", { timeout: 120_000 }, async () => {
        const reloadRes = await fetch(`http://localhost:${RPC_PORT}/api/challenges/reload`, { method: "POST" });
        expect(reloadRes.status).toBe(200);
        const reloadBody = (await reloadRes.json()) as { ok: boolean; challenges: string[] };
        expect(reloadBody.ok).toBe(true);
        // Entries are name@version strings; the installed version follows npm's latest
        expect(reloadBody.challenges.some((c) => c.startsWith("@bitsocial/mintpass-challenge@"))).toBe(true);
    });

    it("publish without wallet fails with wallet-not-defined error", { timeout: 120_000 }, async () => {
        const sub = await pkc.createCommunity();
        await sub.edit({
            settings: {
                challenges: [{ name: "@bitsocial/mintpass-challenge" }]
            }
        });
        await sub.start();
        await waitForCondition(() => !!sub.updatedAt, 60000, 500);

        try {
            const result = await publishCommentWithChallenge({
                pkc,
                communityAddress: sub.address,
                challengeAnswer: ""
            });
            expect(result.challengeSuccess).toBe(false);
            expect(result.challengeErrors).toBeDefined();
            const errorText = Object.values(result.challengeErrors!).filter(Boolean).join(" ");
            expect(errorText).toContain("Author wallet address is not defined");
        } finally {
            try {
                await sub.stop();
            } catch {
                /* ignore */
            }
        }
    });
});
