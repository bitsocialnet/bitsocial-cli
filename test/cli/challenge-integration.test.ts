import { ChildProcess, spawn } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import dns from "node:dns";
import PKC from "@pkcprotocol/pkc-js";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    waitForCondition,
    startPkcDaemon,
    waitForKuboReady
} from "../helpers/daemon-helpers.js";

dns.setDefaultResultOrder("ipv4first");

type PKCInstance = Awaited<ReturnType<typeof PKC>>;

// --- Port allocation (unique to this test file) ---
const RPC_PORT = 59138;
const KUBO_API_PORT = 50039;
const GATEWAY_PORT = 6493;
const rpcWsUrl = `ws://localhost:${RPC_PORT}`;
const kuboApiUrl = `http://0.0.0.0:${KUBO_API_PORT}/api/v0`;
const gatewayUrl = `http://0.0.0.0:${GATEWAY_PORT}`;

// --- Helpers specific to this test file ---

const createMinimalChallengeDir = async (
    dir: string,
    name: string,
    opts: { version?: string; description?: string; challenge?: string; answer?: string }
): Promise<void> => {
    const challenge = opts.challenge || "1+1";
    const answer = opts.answer || "2";
    await fsPromise.mkdir(dir, { recursive: true });
    await fsPromise.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name, version: opts.version || "1.0.0", description: opts.description || "", type: "module" }, null, 2)
    );
    await fsPromise.writeFile(
        path.join(dir, "index.js"),
        `export default function(args) {
    return {
        type: 'text/plain',
        challenge: '${challenge}',
        getChallenge: async () => ({
            challenge: '${challenge}',
            type: 'text/plain',
            verify: async (answer) => ({
                success: answer === '${answer}',
                error: answer !== '${answer}' ? 'Wrong answer' : undefined
            })
        })
    };
};
`
    );
};

const runBitsocialChallenge = (
    args: string[],
    env?: Record<string, string>
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
            reject(new Error("bitsocial challenge command timed out"));
        }, 60000);
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
    challengeErrors?: (string | undefined)[];
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
                await comment.publishChallengeAnswers([challengeAnswer]);
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

describe("challenge integration tests", { timeout: 600_000 }, () => {
    let daemonProcess: ManagedChildProcess | undefined;
    let pkc: PKCInstance;
    let dataPath: string;

    beforeAll(async () => {
        dataPath = randomDirectory();

        // Create and install the local test challenge before starting the daemon
        const challengeSrcDir = path.join(randomDirectory(), "test-challenge");
        await createMinimalChallengeDir(challengeSrcDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge for integration tests",
            challenge: "1+1",
            answer: "2"
        });

        const installResult = await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
        expect(installResult.exitCode).toBe(0);
        expect(installResult.stdout).toContain("Installed challenge 'test-challenge@1.0.0'");

        // Start daemon — it handles kubo, RPC, and webui internally
        daemonProcess = await startPkcDaemon(
            ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", rpcWsUrl],
            { KUBO_RPC_URL: kuboApiUrl, IPFS_GATEWAY_URL: gatewayUrl }
        );

        // Wait for kubo API to be fully ready (it can lag behind the "Communities in data path" message)
        const kuboReady = await waitForKuboReady(`http://localhost:${KUBO_API_PORT}/api/v0`, 30000);
        expect(kuboReady).toBe(true);

        // Connect pkc-js RPC client
        pkc = await PKC({ pkcRpcClientsOptions: [rpcWsUrl] });
        pkc.on("error", (err) => console.error("PKC RPC error:", err));
        await new Promise((resolve) => pkc.once("communitieschange", resolve));

        // Give the daemon's internal IPFS connections time to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }, 180_000);

    afterAll(async () => {
        try {
            await pkc?.destroy();
        } catch {
            /* ignore */
        }
        await stopPkcDaemon(daemonProcess);
    });

    describe("local custom challenge", () => {
        let subAddress: string;
        let sub: any;

        beforeAll(async () => {
            sub = await pkc.createCommunity();
            subAddress = sub.address;
            await sub.edit({
                settings: {
                    challenges: [{ name: "test-challenge" }]
                }
            });
            await sub.start();
            // Wait for community to publish its first IPNS record
            await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500);
        }, 120_000);

        afterAll(async () => {
            try {
                await sub?.stop();
            } catch {
                /* ignore */
            }
        });

        it("daemon loads installed challenge on startup", () => {
            expect(daemonProcess?.capturedStdout).toContain("Loaded challenge packages: test-challenge");
        });

        it("correct answer passes challenge verification", { timeout: 120_000 }, async () => {
            const result = await publishCommentWithChallenge({
                pkc,
                communityAddress: subAddress,
                challengeAnswer: "2"
            });
            expect(result.challengeSuccess).toBe(true);
            expect(result.challengeText).toBe("1+1");
        });

        it("wrong answer fails challenge verification", { timeout: 120_000 }, async () => {
            const result = await publishCommentWithChallenge({
                pkc,
                communityAddress: subAddress,
                challengeAnswer: "wrong"
            });
            expect(result.challengeSuccess).toBe(false);
        });
    });

    describe("built-in question challenge", () => {
        let subAddress: string;
        let sub: any;

        beforeAll(async () => {
            sub = await pkc.createCommunity();
            subAddress = sub.address;
            await sub.edit({
                settings: {
                    challenges: [
                        {
                            name: "question",
                            options: {
                                question: "What is the password?",
                                answer: "secret123"
                            }
                        }
                    ]
                }
            });
            await sub.start();
            await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500);
        }, 120_000);

        afterAll(async () => {
            try {
                await sub?.stop();
            } catch {
                /* ignore */
            }
        });

        it("correct answer passes question challenge", { timeout: 120_000 }, async () => {
            const result = await publishCommentWithChallenge({
                pkc,
                communityAddress: subAddress,
                challengeAnswer: "secret123"
            });
            expect(result.challengeSuccess).toBe(true);
        });

        it("wrong answer fails question challenge", { timeout: 120_000 }, async () => {
            const result = await publishCommentWithChallenge({
                pkc,
                communityAddress: subAddress,
                challengeAnswer: "wrong"
            });
            expect(result.challengeSuccess).toBe(false);
        });
    });

    describe("hot-reload via /api/challenges/reload", () => {
        it("installing challenge while daemon running and reloading works", { timeout: 120_000 }, async () => {
            // Create a second challenge package
            const challengeSrcDir = path.join(randomDirectory(), "test-challenge-v2");
            await createMinimalChallengeDir(challengeSrcDir, "test-challenge-v2", {
                version: "1.0.0",
                description: "A second test challenge",
                challenge: "2+2",
                answer: "4"
            });

            // Install while daemon is running
            const installResult = await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
            expect(installResult.exitCode).toBe(0);
            expect(installResult.stdout).toContain("Installed challenge 'test-challenge-v2@1.0.0'");

            // Trigger reload
            const reloadRes = await fetch(`http://localhost:${RPC_PORT}/api/challenges/reload`, { method: "POST" });
            expect(reloadRes.status).toBe(200);
            const reloadBody = (await reloadRes.json()) as { ok: boolean; challenges: string[] };
            expect(reloadBody.ok).toBe(true);
            expect(reloadBody.challenges).toContain("test-challenge-v2");

            // Create a community using the hot-reloaded challenge
            const sub = await pkc.createCommunity();
            await sub.edit({
                settings: {
                    challenges: [{ name: "test-challenge-v2" }]
                }
            });
            await sub.start();
            await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500);

            try {
                const result = await publishCommentWithChallenge({
                    pkc,
                    communityAddress: sub.address,
                    challengeAnswer: "4"
                });
                expect(result.challengeSuccess).toBe(true);
                expect(result.challengeText).toBe("2+2");
            } finally {
                try {
                    await sub.stop();
                } catch {
                    /* ignore */
                }
            }
        });
    });
});
