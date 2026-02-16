import { ChildProcess, spawn, execSync } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import fs from "fs";
import path from "path";
import http from "http";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

// Helper to create a tar.gz archive from a directory
const createTarGz = async (sourceDir: string, outPath: string): Promise<void> => {
    execSync(`tar -czf "${outPath}" -C "${path.dirname(sourceDir)}" "${path.basename(sourceDir)}"`, { stdio: "ignore" });
};

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

// Serve a file over HTTP on a random port
const serveFile = (filePath: string): Promise<{ server: http.Server; url: string }> => {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === "/challenge.tar.gz") {
                const stat = fs.statSync(filePath);
                res.writeHead(200, {
                    "Content-Type": "application/gzip",
                    "Content-Length": stat.size
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404);
                res.end("Not found");
            }
        });
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as any;
            resolve({ server, url: `http://127.0.0.1:${addr.port}/challenge.tar.gz` });
        });
    });
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

describe("bitsocial challenge install", () => {
    let tmpDir: string;
    let httpServer: http.Server;
    let archiveUrl: string;

    beforeAll(async () => {
        tmpDir = randomDirectory();
        // Create a challenge package
        const challengeDir = path.join(tmpDir, "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", {
            version: "1.0.0",
            description: "A test challenge"
        });
        // Create tar.gz
        const archivePath = path.join(tmpDir, "test-challenge.tar.gz");
        await createTarGz(challengeDir, archivePath);
        // Serve it
        const served = await serveFile(archivePath);
        httpServer = served.server;
        archiveUrl = served.url;
    });

    afterAll(async () => {
        httpServer?.close();
    });

    it("installs a valid challenge package", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["install", archiveUrl, "--plebbitOptions.dataPath", dataPath]);
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
        await runBitsocialChallenge(["install", archiveUrl, "--plebbitOptions.dataPath", dataPath]);
        // Try again
        const result = await runBitsocialChallenge(["install", archiveUrl, "--plebbitOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        const combined = `${result.stdout}\n${result.stderr}`;
        expect(combined).toContain("already installed");
    });

    it("errors on HTTP 404", async () => {
        const dataPath = randomDirectory();
        const badUrl = archiveUrl.replace("challenge.tar.gz", "nonexistent.tar.gz");
        const result = await runBitsocialChallenge(["install", badUrl, "--plebbitOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        const combined = `${result.stdout}\n${result.stderr}`;
        expect(combined).toContain("404");
    });

    it("errors on archive with no package.json", async () => {
        const dataPath = randomDirectory();
        const noPkgDir = path.join(tmpDir, "no-pkg-challenge");
        await fsPromise.mkdir(noPkgDir, { recursive: true });
        await fsPromise.writeFile(path.join(noPkgDir, "index.js"), "export default function() {}");
        const archivePath = path.join(tmpDir, "no-pkg.tar.gz");
        await createTarGz(noPkgDir, archivePath);
        const served = await serveFile(archivePath);
        try {
            const result = await runBitsocialChallenge(["install", served.url, "--plebbitOptions.dataPath", dataPath]);
            expect(result.exitCode).not.toBe(0);
            const combined = `${result.stdout}\n${result.stderr}`;
            expect(combined).toContain("No valid package.json");
        } finally {
            served.server.close();
        }
    });
});

describe("bitsocial challenge install (scoped package)", () => {
    let tmpDir: string;
    let httpServer: http.Server;
    let archiveUrl: string;

    beforeAll(async () => {
        tmpDir = randomDirectory();
        const challengeDir = path.join(tmpDir, "scoped-challenge");
        await createMinimalChallengeDir(challengeDir, "@test-scope/my-challenge", {
            version: "2.0.0",
            description: "A scoped test challenge"
        });
        const archivePath = path.join(tmpDir, "scoped-challenge.tar.gz");
        await createTarGz(challengeDir, archivePath);
        const served = await serveFile(archivePath);
        httpServer = served.server;
        archiveUrl = served.url;
    });

    afterAll(async () => {
        httpServer?.close();
    });

    it("installs a scoped package correctly", async () => {
        const dataPath = randomDirectory();
        const result = await runBitsocialChallenge(["install", archiveUrl, "--plebbitOptions.dataPath", dataPath]);
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
        const result = await runBitsocialChallenge(["list", "--plebbitOptions.dataPath", dataPath]);
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

        const result = await runBitsocialChallenge(["list", "--plebbitOptions.dataPath", dataPath]);
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

        const result = await runBitsocialChallenge(["list", "-q", "--plebbitOptions.dataPath", dataPath]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("test-challenge");
    });
});

describe("bitsocial challenge remove", () => {
    it("removes an installed challenge", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", "test-challenge");
        await createMinimalChallengeDir(challengeDir, "test-challenge", { version: "1.0.0" });

        const result = await runBitsocialChallenge(["remove", "test-challenge", "--plebbitOptions.dataPath", dataPath]);
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
            "--plebbitOptions.dataPath",
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
        const result = await runBitsocialChallenge(["remove", "nonexistent", "--plebbitOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        const combined = `${result.stdout}\n${result.stderr}`;
        expect(combined).toContain("not installed");
    });
});
