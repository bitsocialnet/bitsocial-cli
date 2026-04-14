import { ChildProcess, spawn, execSync } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import fs from "fs";
import path from "path";
import dns from "node:dns";
import { ensureNpmAvailable } from "../../src/challenge-packages/challenge-utils.js";
dns.setDefaultResultOrder("ipv4first");

// Helper to create a minimal challenge package directory
const createMinimalChallengeDir = async (
    dir: string,
    name: string,
    opts?: { version?: string; description?: string; noPackageJson?: boolean; noName?: boolean }
): Promise<void> => {
    await fsPromise.mkdir(dir, { recursive: true });
    if (!opts?.noPackageJson) {
        const pkg: any = {};
        if (!opts?.noName) pkg.name = name;
        if (opts?.version) pkg.version = opts.version;
        if (opts?.description) pkg.description = opts.description;
        await fsPromise.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    }
    // Create a minimal challenge factory
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
        }, 60000); // 60s timeout because npm install can be slow
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });
};

describe("npm resolution", () => {
    it("ensureNpmAvailable resolves successfully", async () => {
        await expect(ensureNpmAvailable()).resolves.toBeUndefined();
    });
});

describe("bitsocial challenge install", () => {
    let tmpDir: string;
    let challengeSrcDir: string;

    beforeAll(async () => {
        tmpDir = randomDirectory();
        // Create a challenge package directory (npm pack can pack local paths)
        challengeSrcDir = path.join(tmpDir, "test-challenge");
        await createMinimalChallengeDir(challengeSrcDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge"
        });
    });

    it("installs a valid challenge package from local path", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Installed challenge 'test-challenge@1.0.0'");

        // Verify directory structure
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        const stat = await fsPromise.stat(challengeDir);
        expect(stat.isDirectory()).toBe(true);

        // Verify package.json exists
        const pkg = JSON.parse(await fsPromise.readFile(path.join(challengeDir, "package.json"), "utf-8"));
        expect(pkg.name).toBe("test-challenge");
    });

    it("errors when already installed", async () => {
        const dataPath = randomDirectory();
        // Install once
        await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
        // Try again
        const result = await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        const combined = `${result.stdout}\n${result.stderr}`;
        expect(combined).toContain("already installed");
    });

    it("errors on non-existent package name", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge([
            "install",
            "@nonexistent-scope-abc123/this-package-does-not-exist-xyz789",
            "--pkcOptions.dataPath",
            dataPath
        ]);
        expect(result.exitCode).not.toBe(0);
    });
});

describe("bitsocial challenge install (scoped package)", () => {
    let tmpDir: string;
    let challengeSrcDir: string;

    beforeAll(async () => {
        tmpDir = randomDirectory();
        challengeSrcDir = path.join(tmpDir, "scoped-challenge");
        await createMinimalChallengeDir(challengeSrcDir, "@test-scope/my-challenge", {
            version: "2.0.0",
            description: "A scoped test challenge"
        });
    });

    it("installs a scoped package correctly", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Installed challenge '@test-scope/my-challenge@2.0.0'");

        // Verify nested directory structure @scope/name
        const challengeDir = path.join(dataPath, "challenges", "@test-scope", "my-challenge");
        const stat = await fsPromise.stat(challengeDir);
        expect(stat.isDirectory()).toBe(true);
    });
});

describe("bitsocial challenge list", () => {
    it("shows 'No challenge packages installed' when empty", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["list", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("No challenge packages installed");
    });

    it("shows installed challenges in table", async () => {
        const dataPath = randomDirectory();
        // Manually create a challenge dir
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge"
        });

        const result = await runBitsocialChallenge(["list", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("test-challenge");
        expect(result.stdout).toContain("1.0.0");
    });

    it("shows names only with -q", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge"
        });

        const result = await runBitsocialChallenge(["list", "-q", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("test-challenge");
    });
});

describe("bitsocial challenge remove", () => {
    it("removes an installed challenge", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", { version: "1.0.0" });

        const result = await runBitsocialChallenge(["remove", "test-challenge", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Removed challenge 'test-challenge'");

        // Verify it's gone
        await expect(fsPromise.access(challengeDir)).rejects.toThrow();
    });

    it("cleans up empty @scope dir", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "@test-scope", "my-challenge");
        await createMinimalChallengeDir(challengeDir, "@test-scope/my-challenge", { version: "1.0.0" });

        const result = await runBitsocialChallenge([
            "remove",
            "@test-scope/my-challenge",
            "--pkcOptions.dataPath",
            dataPath
        ]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Removed challenge '@test-scope/my-challenge'");

        // Verify both the challenge dir and scope dir are gone
        const scopeDir = path.join(dataPath, "challenges", "@test-scope");
        await expect(fsPromise.access(scopeDir)).rejects.toThrow();
    });

    it("errors on non-existent challenge", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["remove", "nonexistent", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        const combined = `${result.stdout}\n${result.stderr}`;
        expect(combined).toContain("not installed");
    });
});
