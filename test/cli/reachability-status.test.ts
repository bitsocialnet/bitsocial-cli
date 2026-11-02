import { spawn } from "child_process";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { writeReachabilityConfig, writeReachabilityRuntimeStatus } from "../../src/reachability/state.js";

const runStatus = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", "reachability", "status", ...args], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        proc.on("error", reject);
        proc.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
    });

describe("bitsocial reachability status", () => {
    it("--json prints only parseable JSON when not configured", async () => {
        const { stdout, exitCode } = await runStatus(["--json", "--pkcOptions.dataPath", randomDirectory()]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ configured: false, enabled: false, addresses: [] });
    });

    it("--json reflects the stored config", async () => {
        const dataPath = randomDirectory();
        const announce = ["/ip4/203.0.113.7/tcp/443/tls/ws"];
        await writeReachabilityConfig(dataPath, { version: 1, enabled: true, mode: "ip", wsPort: 4002, announce, publicIps: ["203.0.113.7"], staging: true, acmeDirectory: "https://acme-staging-v02.api.letsencrypt.org/directory" });
        const { stdout, exitCode } = await runStatus(["--json", "--pkcOptions.dataPath", dataPath]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ configured: true, mode: "ip", addresses: announce, wsPort: 4002, staging: true });
    });

    it("prints domain and Caddy checks for a person", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, { version: 1, enabled: true, mode: "domain", wsPort: 4002, announce: [], publicIps: [], domain: "node.example", staging: false, acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory" });
        await writeReachabilityRuntimeStatus(dataPath, {
            updatedAt: "2026-11-02T00:00:00.000Z",
            domains: { "node.example": { lastCheckAt: "2026-11-02T00:00:00.000Z", ok: false, failingSince: "2026-11-01T00:00:00.000Z" } },
            caddy: { running: false, lastExitAt: "2026-11-02T00:00:00.000Z" }
        });
        const { stdout } = await runStatus(["--pkcOptions.dataPath", dataPath]);
        expect(stdout).toContain("Domain check node.example: failing since 2026-11-01T00:00:00.000Z");
        expect(stdout).toContain("Caddy: not running");
    });

    it("names the setup command for a person when not configured", async () => {
        const { stdout } = await runStatus(["--pkcOptions.dataPath", randomDirectory()]);
        expect(stdout).toContain("bitsocial reachability setup");
    });

    it("exits non-zero on a config from a newer version", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, { version: 2 } as any);
        const { exitCode, stderr } = await runStatus(["--pkcOptions.dataPath", dataPath]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("newer bitsocial-cli");
    });
});
