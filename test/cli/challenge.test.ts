import { ChildProcess, spawn, execSync } from "child_process";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
//@ts-ignore
import Sinon from "sinon";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import fs from "fs";
import path from "path";
import dns from "node:dns";
import { ensureNpmAvailable, findChallengeUsages } from "../../src/challenge-packages/challenge-utils.js";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";
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
        expect(result.stdout).toContain("added test-challenge@1.0.0 in");

        // Verify directory structure
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        const stat = await fsPromise.stat(challengeDir);
        expect(stat.isDirectory()).toBe(true);

        // Verify package.json exists
        const pkg = JSON.parse(await fsPromise.readFile(path.join(challengeDir, "package.json"), "utf-8"));
        expect(pkg.name).toBe("test-challenge");
    });

    it("reinstall replaces an existing installation (idempotent, like npm)", async () => {
        const dataPath = randomDirectory();
        const srcDir = path.join(randomDirectory(), "reinstall-challenge");
        await createMinimalChallengeDir(srcDir, "reinstall-challenge", { version: "1.0.0" });

        // Install once
        const first = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(first.exitCode).toBe(0);
        expect(first.stdout).toContain("added reinstall-challenge@1.0.0 in");

        // Bump the version and install again — must replace, not error
        const pkgPath = path.join(srcDir, "package.json");
        const pkg = JSON.parse(await fsPromise.readFile(pkgPath, "utf-8"));
        pkg.version = "1.1.0";
        await fsPromise.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

        const second = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(second.exitCode, `reinstall failed with stderr:\n${second.stderr}`).toBe(0);
        expect(second.stdout).toContain("changed reinstall-challenge@1.1.0 in");

        // Installed package.json must reflect the new version
        const installedPkg = JSON.parse(
            await fsPromise.readFile(path.join(dataPath, "challenges", "reinstall-challenge", "package.json"), "utf-8")
        );
        expect(installedPkg.version).toBe("1.1.0");
    });

    it("reinstall with the same version still replaces the content", async () => {
        const dataPath = randomDirectory();
        const srcDir = path.join(randomDirectory(), "same-version-challenge");
        await createMinimalChallengeDir(srcDir, "same-version-challenge", { version: "1.0.0" });

        const first = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(first.exitCode).toBe(0);

        // Change index.js content without bumping the version (e.g. local/git installs)
        const newIndexContent = `export default function() { return { type: 'text/plain', challenge: '2+2', getChallenge: async () => ({ challenge: '2+2', type: 'text/plain', verify: async (answer) => ({ success: answer === '4' }) }) }; };\n`;
        await fsPromise.writeFile(path.join(srcDir, "index.js"), newIndexContent);

        const second = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(second.exitCode, `reinstall failed with stderr:\n${second.stderr}`).toBe(0);
        expect(second.stdout).toContain("changed same-version-challenge@1.0.0 in");

        const installedIndex = await fsPromise.readFile(
            path.join(dataPath, "challenges", "same-version-challenge", "index.js"), "utf-8"
        );
        expect(installedIndex).toBe(newIndexContent);
    });

    it("installs successfully when devDependencies have unresolvable versions", async () => {
        const dataPath = randomDirectory();
        const srcDir = path.join(randomDirectory(), "devdep-challenge");
        await fsPromise.mkdir(srcDir, { recursive: true });
        await fsPromise.writeFile(
            path.join(srcDir, "package.json"),
            JSON.stringify({
                name: "devdep-challenge",
                version: "1.0.0",
                devDependencies: {
                    "@test/nonexistent-pkg-abc123": "99.99.99"
                }
            }, null, 2)
        );
        await fsPromise.writeFile(
            path.join(srcDir, "index.js"),
            `export default function() { return { type: 'text/plain', challenge: '1+1', getChallenge: async () => ({ challenge: '1+1', type: 'text/plain', verify: async (answer) => ({ success: answer === '2' }) }) }; };`
        );

        const result = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode, `install failed with stderr:\n${result.stderr}`).toBe(0);

        // Verify package.json is restored with devDependencies intact
        const installedPkg = JSON.parse(
            await fsPromise.readFile(path.join(dataPath, "challenges", "devdep-challenge", "package.json"), "utf-8")
        );
        expect(installedPkg.devDependencies).toEqual({ "@test/nonexistent-pkg-abc123": "99.99.99" });
    });

    it("preserves original package.json after install with devDependencies", async () => {
        const dataPath = randomDirectory();
        const srcDir = path.join(randomDirectory(), "preserve-pkg-challenge");
        const originalPkg = {
            name: "preserve-pkg-challenge",
            version: "2.0.0",
            description: "test that package.json is byte-identical after install",
            devDependencies: {
                "prettier": "*"
            }
        };
        const originalContent = JSON.stringify(originalPkg, null, 2);
        await fsPromise.mkdir(srcDir, { recursive: true });
        await fsPromise.writeFile(path.join(srcDir, "package.json"), originalContent);
        await fsPromise.writeFile(
            path.join(srcDir, "index.js"),
            `export default function() { return { type: 'text/plain', challenge: '1+1', getChallenge: async () => ({ challenge: '1+1', type: 'text/plain', verify: async (answer) => ({ success: answer === '2' }) }) }; };`
        );

        const result = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode, `install failed with stderr:\n${result.stderr}`).toBe(0);

        // The installed package.json must still contain devDependencies
        const restoredContent = await fsPromise.readFile(
            path.join(dataPath, "challenges", "preserve-pkg-challenge", "package.json"), "utf-8"
        );
        const restoredPkg = JSON.parse(restoredContent);
        expect(restoredPkg.devDependencies).toEqual({ "prettier": "*" });
    });

    it("installs successfully when package has a prepare script (e.g. husky)", async () => {
        const dataPath = randomDirectory();
        const srcDir = path.join(randomDirectory(), "husky-challenge");
        await fsPromise.mkdir(srcDir, { recursive: true });
        await fsPromise.writeFile(
            path.join(srcDir, "package.json"),
            JSON.stringify({
                name: "husky-challenge",
                version: "1.0.0",
                scripts: {
                    prepare: "husky"
                }
            }, null, 2)
        );
        await fsPromise.writeFile(
            path.join(srcDir, "index.js"),
            `export default function() { return { type: 'text/plain', challenge: '1+1', getChallenge: async () => ({ challenge: '1+1', type: 'text/plain', verify: async (answer) => ({ success: answer === '2' }) }) }; };`
        );

        const result = await runBitsocialChallenge(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode, `install failed with stderr:\n${result.stderr}`).toBe(0);
    });

    it("does not pass --legacy-peer-deps on non-Windows platforms", async () => {
        if (process.platform === "win32") return; // skip on Windows — flag is expected there
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["install", challengeSrcDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        const combined = `${result.stdout}\n${result.stderr}`;
        expect(combined).not.toContain("--legacy-peer-deps");
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

    // pkc-js's validateChallengeFileFactory runs before the swap, so a wrong-kind package never lands in challenges/
    it("refuses a package whose default export is not a challenge (e.g. a page sort)", async () => {
        const dataPath = randomDirectory();
        const pageSortDir = path.join(randomDirectory(), "not-a-challenge");
        await fsPromise.mkdir(pageSortDir, { recursive: true });
        await fsPromise.writeFile(path.join(pageSortDir, "package.json"), JSON.stringify({ name: "not-a-challenge", version: "1.0.0" }));
        await fsPromise.writeFile(
            path.join(pageSortDir, "index.js"),
            "export default function () { return { sortName: 'x', score: () => 1 }; }\n"
        );
        const result = await runBitsocialChallenge(["install", pageSortDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("ERR_CHALLENGE_FILE_INVALID");
        expect(fs.existsSync(path.join(dataPath, "challenges", "not-a-challenge"))).toBe(false);
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
        expect(result.stdout).toContain("added @test-scope/my-challenge@2.0.0 in");

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

    it("shows installed challenges as an npm-ls-style tree", async () => {
        const dataPath = randomDirectory();
        // Manually create a challenge dir
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge"
        });

        const result = await runBitsocialChallenge(["list", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        // Header line is the challenges dir, entries are name@version
        expect(result.stdout).toContain(path.join(dataPath, "challenges"));
        expect(result.stdout).toContain("└── test-challenge@1.0.0");
    });

    it("sorts tree entries alphabetically with ├──/└── branches", async () => {
        const dataPath = randomDirectory();
        await createMinimalChallengeDir(path.join(dataPath, "challenges", "test-challenge"), "test-challenge", {
            version: "1.0.0"
        });
        await createMinimalChallengeDir(
            path.join(dataPath, "challenges", "@test-scope", "my-challenge"),
            "@test-scope/my-challenge",
            { version: "2.0.0" }
        );

        const result = await runBitsocialChallenge(["list", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("├── @test-scope/my-challenge@2.0.0");
        expect(result.stdout).toContain("└── test-challenge@1.0.0");
    });

    it("works via the ls alias", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["ls", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("No challenge packages installed");
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

// No daemon listens on this port, so remove's in-use check cannot connect
const NO_DAEMON_RPC_URL = "ws://127.0.0.1:1";

// oclif wraps warnings and errors at the terminal width and prefixes each line with "›" ("»" on Windows)
const unwrap = (output: string) => output.replace(/[›»]/g, " ").replace(/\s+/g, " ");

describe("bitsocial challenge remove", () => {
    it("refuses a name that escapes the challenges dir instead of deleting another data dir", async () => {
        const dataPath = randomDirectory();
        const communityDb = path.join(dataPath, "communities", "board.bso");
        await fsPromise.mkdir(path.dirname(communityDb), { recursive: true });
        await fsPromise.writeFile(communityDb, "db");
        const result = await runBitsocialChallenge(["remove", "../communities", "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Invalid package name");
        expect(fs.existsSync(communityDb)).toBe(true);
    });

    it("refuses to remove when the daemon cannot be reached to check usage", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", { version: "1.0.0" });

        const result = await runBitsocialChallenge(["remove", "test-challenge", "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", NO_DAEMON_RPC_URL]);
        expect(result.exitCode).not.toBe(0);
        expect(unwrap(result.stderr)).toContain('Could not check whether any community uses "test-challenge"');
        expect(result.stderr).toContain("--force");
        expect(fs.existsSync(challengeDir)).toBe(true);
    });

    it("removes with --force without contacting the daemon, and warns that the check was skipped", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", { version: "1.0.0" });

        const result = await runBitsocialChallenge([
            "remove",
            "test-challenge",
            "--force",
            "--pkcOptions.dataPath",
            dataPath,
            "--pkcRpcUrl",
            NO_DAEMON_RPC_URL
        ]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("removed test-challenge@1.0.0");
        expect(unwrap(result.stderr)).toContain(
            'Skipped the in-use check. A community whose settings.challenges still names "test-challenge" rejects every publication and fails to start'
        );

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
            "--force",
            "--pkcOptions.dataPath",
            dataPath,
            "--pkcRpcUrl",
            NO_DAEMON_RPC_URL
        ]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("removed @test-scope/my-challenge@1.0.0");

        // Verify both the challenge dir and scope dir are gone
        const scopeDir = path.join(dataPath, "challenges", "@test-scope");
        await expect(fsPromise.access(scopeDir)).rejects.toThrow();
    });

    // Checked before the daemon, so the error names the real problem rather than an unreachable daemon
    it("errors on non-existent challenge without contacting the daemon", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["remove", "nonexistent", "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", NO_DAEMON_RPC_URL]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('Challenge "nonexistent" is not installed.');
        expect(result.stderr).not.toContain("Could not check");
    });

    it("works via the uninstall alias", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", { version: "1.0.0" });

        const result = await runBitsocialChallenge([
            "uninstall",
            "test-challenge",
            "--force",
            "--pkcOptions.dataPath",
            dataPath,
            "--pkcRpcUrl",
            NO_DAEMON_RPC_URL
        ]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("removed test-challenge@1.0.0");
        await expect(fsPromise.access(challengeDir)).rejects.toThrow();
    });
});

// Issue #176: a community whose settings.challenges names a removed package rejects every publication and fails to start
describe("bitsocial challenge remove: in-use check against the daemon", () => {
    const sandbox = Sinon.createSandbox();

    const settingsByAddress: Record<string, unknown> = {
        "board.bso": { challenges: [{ name: "question", options: { question: "q?", answer: "a" } }, { name: "test-challenge" }] },
        "other.bso": { challenges: [{ name: "test-challenge", exclude: [{ role: ["moderator"] }] }] },
        // A path entry loads that file, not the registered package
        "by-path.bso": { challenges: [{ name: "test-challenge", path: "/some/challenge.js" }] },
        "unrelated.bso": {}
    };

    const installAt = async (dataPath: string, name: string) =>
        createMinimalChallengeDir(path.join(dataPath, "challenges", name), name, { version: "1.0.0" });

    afterEach(() => clearPkcRpcConnectOverride());
    afterAll(() => sandbox.restore());

    const fakeDaemon = (settings: Record<string, unknown>) =>
        setPkcRpcConnectOverride(
            sandbox.fake.resolves({
                communities: Object.keys(settings).map((address) => ({ address, publicKey: address, started: true })),
                createCommunity: async ({ address }: { address: string }) => ({ address, settings: settings[address] }),
                destroy: async () => {}
            })
        );

    it("findChallengeUsages reports each index that names the package, skipping path entries", () => {
        expect(findChallengeUsages([{ name: "a" }, { name: "b" }, { name: "b", path: "/x.js" }, { name: "b" }], "b")).toEqual([
            "challenges[1]",
            "challenges[3]"
        ]);
        expect(findChallengeUsages(undefined, "b")).toEqual([]);
    });

    it("refuses and lists every community entry that names the package", async () => {
        const dataPath = randomDirectory();
        await installAt(dataPath, "test-challenge");
        fakeDaemon(settingsByAddress);
        const { result } = await runCliCommand(["challenge", "remove", "test-challenge", "--pkcOptions.dataPath", dataPath]);
        const message = unwrap(result.error?.message ?? "");
        expect(message).toContain('Challenge "test-challenge" is still used by:');
        expect(message).toContain("board.bso settings.challenges[1]");
        expect(message).toContain("other.bso settings.challenges[0]");
        expect(message).not.toContain("by-path.bso");
        expect(message).not.toContain("unrelated.bso");
        expect(message).toContain("reject every publication and fail to start");
        expect(fs.existsSync(path.join(dataPath, "challenges", "test-challenge"))).toBe(true);
    });

    it("removes when no community uses it", async () => {
        const dataPath = randomDirectory();
        await installAt(dataPath, "test-challenge");
        fakeDaemon({ "unrelated.bso": {}, "by-path.bso": settingsByAddress["by-path.bso"] });
        const { result, stdout } = await runCliCommand([
            "challenge",
            "remove",
            "test-challenge",
            "--pkcOptions.dataPath",
            dataPath,
            "--pkcRpcUrl",
            NO_DAEMON_RPC_URL
        ]);
        expect(result.error).toBeUndefined();
        expect(stdout).toContain("removed test-challenge@1.0.0");
        expect(fs.existsSync(path.join(dataPath, "challenges", "test-challenge"))).toBe(false);
    });

    // Removing a package named after a pkc-js built-in hands the built-in back: nothing breaks, but the community's
    // challenge changes, so it still refuses and says what removal would do
    it("refuses a package that shadows a pkc-js built-in, and says it would fall back to the built-in", async () => {
        const dataPath = randomDirectory();
        await installAt(dataPath, "question");
        fakeDaemon(settingsByAddress);
        const { result } = await runCliCommand(["challenge", "remove", "question", "--pkcOptions.dataPath", dataPath]);
        const message = unwrap(result.error?.message ?? "");
        expect(message).toContain("board.bso settings.challenges[0]");
        expect(message).toContain('falls back to the pkc-js built-in challenge of the same name');
        expect(fs.existsSync(path.join(dataPath, "challenges", "question"))).toBe(true);
    });

    it("--force on a package that shadows a built-in warns that communities now use the built-in", async () => {
        const dataPath = randomDirectory();
        await installAt(dataPath, "question");
        const result = await runBitsocialChallenge(["remove", "question", "--force", "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", NO_DAEMON_RPC_URL]);
        expect(result.exitCode).toBe(0);
        expect(unwrap(result.stderr)).toContain('still names "question" now uses the pkc-js built-in challenge of the same name');
    });
});
