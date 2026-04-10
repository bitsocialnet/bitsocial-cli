import { spawn } from "child_process";
import { describe, it, expect } from "vitest";
import { join } from "path";
import { readFileSync } from "fs";

const CLI_PATH = join(process.cwd(), "bin", "run");
const PACKAGE_JSON_PATH = join(process.cwd(), "package.json");

// Get expected values from package.json
const getExpectedValues = () => {
    const cliPkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
    const cliVersion = cliPkg.version;
    const pkcJsDep = cliPkg.dependencies["@pkcprotocol/pkc-js"];
    // Extract commit hash from URL like "https://github.com/pkcprotocol/pkc-js#542952a1..."
    const commitMatch = pkcJsDep?.match(/#([a-f0-9]+)$/);
    const commit = commitMatch ? commitMatch[1].substring(0, 7) : undefined;
    return { cliVersion, commit };
};

describe("bitsocial --version", () => {
    it("should print CLI version and pkc-js version with commit hash", async () => {
        const { cliVersion, commit } = getExpectedValues();

        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
            const proc = spawn("node", [CLI_PATH, "--version"], {
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

        expect(result.exitCode).toBe(0);

        const lines = result.stdout.trim().split("\n");
        expect(lines.length).toBe(2);

        // First line should contain CLI name and version
        expect(lines[0]).toContain("bitsocial-cli");
        expect(lines[0]).toContain(cliVersion);
        expect(lines[0]).toMatch(/linux-x64|darwin-x64|darwin-arm64|win32-x64/);
        expect(lines[0]).toMatch(/node-v\d+\.\d+\.\d+/);

        // Second line should contain pkc-js version and commit
        expect(lines[1]).toContain("pkc-js/");
        if (commit) {
            expect(lines[1]).toContain(`(${commit})`);
        }
    });
});
