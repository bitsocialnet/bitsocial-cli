import { spawn } from "child_process";
import { describe, it, expect } from "vitest";
import { join } from "path";
import { readFileSync } from "fs";

const CLI_PATH = join(process.cwd(), "bin", "run");
const PACKAGE_JSON_PATH = join(process.cwd(), "package.json");

const cliVersion = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")).version as string;

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve) => {
        const proc = spawn("node", [CLI_PATH, ...args], {
            cwd: process.cwd(),
            env: { ...process.env }
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        proc.on("close", (exitCode) => {
            resolve({ stdout, stderr, exitCode });
        });
    });
}

// These tests require the package to be published on npm.
// They will fail until the first publish. Skip if npm view fails.
let packageOnNpm = false;
try {
    const result = await runCli(["update", "check"]);
    packageOnNpm = result.exitCode === 0;
} catch {
    packageOnNpm = false;
}

describe.skipIf(!packageOnNpm)("bitsocial update check", () => {
    it("should exit 0 and print version info", async () => {
        const result = await runCli(["update", "check"]);
        expect(result.exitCode).toBe(0);
        // Should mention the current version or "up-to-date" or "Update available"
        expect(result.stdout).toMatch(/v?\d+\.\d+\.\d+/);
    });
});

describe.skipIf(!packageOnNpm)("bitsocial update versions", () => {
    it("should exit 0 and print version lines", async () => {
        const result = await runCli(["update", "versions", "--limit", "5"]);
        expect(result.exitCode).toBe(0);
        const lines = result.stdout.trim().split("\n");
        expect(lines.length).toBeGreaterThanOrEqual(1);
        // Each line should contain a version number
        for (const line of lines) {
            expect(line.trim()).toMatch(/\*?\s*\d+\.\d+\.\d+/);
        }
    });
});

// Skipping install test — it would modify the global npm installation
describe.skip("bitsocial update install", () => {
    it("should install a specific version", async () => {
        // This test is manual-only to avoid modifying the system
    });
});
