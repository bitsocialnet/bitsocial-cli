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
        expect(installResult.stdout).toContain("added test-challenge@1.0.0 in");

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
            expect(await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500)).toBe(true);
        }, 120_000);

        afterAll(async () => {
            try {
                await sub?.stop();
            } catch {
                /* ignore */
            }
        });

        it("daemon loads installed challenge on startup", () => {
            expect(daemonProcess?.capturedStdout).toContain("Loaded challenge packages: test-challenge@1.0.0");
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
            expect(await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500)).toBe(true);
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
            expect(installResult.stdout).toContain("added test-challenge-v2@1.0.0 in");

            // Trigger reload
            const reloadRes = await fetch(`http://localhost:${RPC_PORT}/api/challenges/reload`, { method: "POST" });
            expect(reloadRes.status).toBe(200);
            const reloadBody = (await reloadRes.json()) as { ok: boolean; challenges: string[] };
            expect(reloadBody.ok).toBe(true);
            expect(reloadBody.challenges).toContain("test-challenge-v2@1.0.0");

            // Create a community using the hot-reloaded challenge
            const sub = await pkc.createCommunity();
            await sub.edit({
                settings: {
                    challenges: [{ name: "test-challenge-v2" }]
                }
            });
            await sub.start();
            expect(await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500)).toBe(true);

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

        // Issue #124: replacing an already-imported package under the same name left the
        // daemon running the old ESM module while reporting the new version.
        it("upgrading an installed challenge in place takes effect without a daemon restart", { timeout: 180_000 }, async () => {
            const sub = await pkc.createCommunity();
            await sub.edit({
                settings: {
                    challenges: [{ name: "test-challenge" }]
                }
            });
            await sub.start();
            expect(await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500)).toBe(true);

            try {
                // v1 (installed in beforeAll) is active
                const v1Result = await publishCommentWithChallenge({
                    pkc,
                    communityAddress: sub.address,
                    challengeAnswer: "2"
                });
                expect(v1Result.challengeSuccess).toBe(true);
                expect(v1Result.challengeText).toBe("1+1");

                // Replace test-challenge with v2 — same package name, different behavior
                const v2SrcDir = path.join(randomDirectory(), "test-challenge");
                await createMinimalChallengeDir(v2SrcDir, "test-challenge", {
                    version: "2.0.0",
                    description: "A test challenge for integration tests",
                    challenge: "3+3",
                    answer: "6"
                });

                const installResult = await runBitsocialChallenge(["install", v2SrcDir, "--pkcOptions.dataPath", dataPath]);
                expect(installResult.exitCode).toBe(0);
                expect(installResult.stdout).toContain("changed test-challenge@2.0.0 in");

                // Reload without restarting the daemon
                const reloadRes = await fetch(`http://localhost:${RPC_PORT}/api/challenges/reload`, { method: "POST" });
                expect(reloadRes.status).toBe(200);
                const reloadBody = (await reloadRes.json()) as { ok: boolean; challenges: string[] };
                expect(reloadBody.ok).toBe(true);
                expect(reloadBody.challenges).toContain("test-challenge@2.0.0");
                expect(reloadBody.challenges).not.toContain("test-challenge@1.0.0");

                // The active factory must match the reported version
                const v2Result = await publishCommentWithChallenge({
                    pkc,
                    communityAddress: sub.address,
                    challengeAnswer: "6"
                });
                expect(v2Result.challengeText).toBe("3+3");
                expect(v2Result.challengeSuccess).toBe(true);

                // The old answer must no longer pass
                const staleAnswerResult = await publishCommentWithChallenge({
                    pkc,
                    communityAddress: sub.address,
                    challengeAnswer: "2"
                });
                expect(staleAnswerResult.challengeSuccess).toBe(false);

                // Reloading again without changing anything keeps v2 active
                const reloadAgainRes = await fetch(`http://localhost:${RPC_PORT}/api/challenges/reload`, { method: "POST" });
                expect(reloadAgainRes.status).toBe(200);
                const reloadAgainBody = (await reloadAgainRes.json()) as { ok: boolean; challenges: string[] };
                expect(reloadAgainBody.challenges).toContain("test-challenge@2.0.0");

                const afterIdempotentReload = await publishCommentWithChallenge({
                    pkc,
                    communityAddress: sub.address,
                    challengeAnswer: "6"
                });
                expect(afterIdempotentReload.challengeText).toBe("3+3");
                expect(afterIdempotentReload.challengeSuccess).toBe(true);
            } finally {
                try {
                    await sub.stop();
                } catch {
                    /* ignore */
                }
            }
        });

        // `challenge install` reloads on its own. It used to POST a hardcoded localhost:9138,
        // so a daemon on a non-default RPC port (like this one) never saw the install; the
        // reload target now comes from the command's own --pkcRpcUrl.
        it("challenge install --pkcRpcUrl alone updates a daemon on a non-default RPC port", { timeout: 180_000 }, async () => {
            const sub = await pkc.createCommunity();
            await sub.edit({
                settings: {
                    challenges: [{ name: "test-challenge" }]
                }
            });
            await sub.start();
            expect(await waitForCondition(() => !!(sub as any).updatedAt, 60000, 500)).toBe(true);

            try {
                const v3SrcDir = path.join(randomDirectory(), "test-challenge");
                await createMinimalChallengeDir(v3SrcDir, "test-challenge", {
                    version: "3.0.0",
                    description: "A test challenge for integration tests",
                    challenge: "5+5",
                    answer: "10"
                });

                // No explicit /api/challenges/reload call anywhere in this test — install must
                // reload the daemon at --pkcRpcUrl by itself
                const installResult = await runBitsocialChallenge([
                    "install",
                    v3SrcDir,
                    "--pkcOptions.dataPath",
                    dataPath,
                    "--pkcRpcUrl",
                    rpcWsUrl
                ]);
                expect(installResult.exitCode).toBe(0);
                expect(installResult.stdout).toContain("changed test-challenge@3.0.0 in");
                expect(installResult.stdout).toContain(`reloaded test-challenge@3.0.0 in the daemon at ${rpcWsUrl}`);

                const result = await publishCommentWithChallenge({
                    pkc,
                    communityAddress: sub.address,
                    challengeAnswer: "10"
                });
                expect(result.challengeText).toBe("5+5");
                expect(result.challengeSuccess).toBe(true);
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
