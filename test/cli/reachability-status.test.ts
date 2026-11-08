import { spawn } from "child_process";
import fs from "fs/promises";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { planKuboConfig } from "../../src/reachability/kubo-config.js";
import { writeReachabilityConfig, writeReachabilityDeclined, writeReachabilityRuntimeStatus } from "../../src/reachability/state.js";

const runStatus = (args: string[], kuboRpcUrl = "http://127.0.0.1:9/api/v0"): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        // A dead kubo port, so these never read from a kubo that happens to be running on this machine.
        const proc = spawn("node", ["./bin/run", "reachability", "status", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, KUBO_RPC_URL: kuboRpcUrl, IPFS_PATH: "" }
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        proc.on("error", reject);
        proc.on("close", (exitCode) => resolve({ stdout, stderr: stderr.replace(/[\s›]+/g, " "), exitCode }));
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
        await writeReachabilityConfig(dataPath, { version: 1, enabled: true, mode: "ip", wsPort: 4002, announce, publicIps: ["203.0.113.7"], staging: true, acmeDirectory: "https://acme-staging-v02.api.letsencrypt.org/directory", caddyAdminPort: 2019 });
        const { stdout, exitCode } = await runStatus(["--json", "--pkcOptions.dataPath", dataPath]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ configured: true, mode: "ip", addresses: announce, wsPort: 4002, staging: true });
    });

    it("prints domain and Caddy checks for a person", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, { version: 1, enabled: true, mode: "domain", wsPort: 4002, announce: [], publicIps: [], domain: "node.example", staging: false, acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory", caddyAdminPort: 2019 });
        await writeReachabilityRuntimeStatus(dataPath, {
            updatedAt: "2026-11-02T00:00:00.000Z",
            domains: { "node.example": { lastCheckAt: "2026-11-02T00:00:00.000Z", ok: false, failingSince: "2026-11-01T00:00:00.000Z" } },
            caddy: { running: false, lastExitAt: "2026-11-02T00:00:00.000Z" }
        });
        const { stdout } = await runStatus(["--pkcOptions.dataPath", dataPath]);
        expect(stdout).toContain("Domain check node.example: failing since 2026-11-01T00:00:00.000Z");
        expect(stdout).toContain("Caddy: not running");
    });

    it("--json lists each requirement it checked, including UDP 443", async () => {
        const { stdout } = await runStatus(["--json", "--pkcOptions.dataPath", randomDirectory()]);
        const ids = JSON.parse(stdout).checks.map((check: { id: string }) => check.id);
        expect(ids).toEqual(expect.arrayContaining(["public-address", "tcp-443", "udp-443", "tcp-80", "inbound"]));
    });

    it("prints requirements for a person even when not configured", async () => {
        const { stdout } = await runStatus(["--pkcOptions.dataPath", randomDirectory()]);
        expect(stdout).toContain("Requirements:");
        expect(stdout).toMatch(/UDP 443/);
    });

    it("names the setup command for a person when not configured", async () => {
        const { stdout } = await runStatus(["--pkcOptions.dataPath", randomDirectory()]);
        expect(stdout).toContain("bitsocial reachability setup");
    });

    it("says a declined node is off on purpose, and how to turn it on (#225)", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityDeclined(dataPath);
        const { stdout } = await runStatus(["--pkcOptions.dataPath", dataPath]);
        expect(stdout).toContain("Reachability: declined. To turn it on, run: bitsocial reachability setup");
        expect(stdout).not.toContain("Browsers cannot reach this node");
        const json = await runStatus(["--json", "--pkcOptions.dataPath", dataPath]);
        expect(JSON.parse(json.stdout)).toMatchObject({ configured: false, declined: true });
    });

    it("exits non-zero on a config from a newer version", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, { version: 2 } as any);
        const { exitCode, stderr } = await runStatus(["--pkcOptions.dataPath", dataPath]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("newer bitsocial-cli");
    });

    // Issue #216: "Announced addresses" comes from our own state, so it says nothing about what kubo announces.
    describe("when kubo does not announce what setup applied", () => {
        const address = "/ip4/203.0.113.7/tcp/443/tls/ws";
        const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";

        const configuredNode = async ({ enabled = true, appendAnnounce, serveWss }: { enabled?: boolean; appendAnnounce: string[]; serveWss?: false }) => {
            const dataPath = randomDirectory();
            // The real edits setup would make, so the test cannot drift from what setup stores and writes.
            const applied = planKuboConfig({ Addresses: { Swarm: [], Announce: [] } }, { wsPort: 4002, announce: [address], ...(serveWss === false ? { serveWss } : {}) }, true);
            await writeReachabilityConfig(dataPath, {
                version: 1,
                enabled,
                mode: "ip",
                wsPort: 4002,
                announce: [address],
                publicIps: ["203.0.113.7"],
                staging: false,
                acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory",
                caddyAdminPort: 2019,
                kuboEdits: applied.kuboEdits,
                ...(serveWss === false ? { serveWss } : {})
            });
            const repo = path.join(dataPath, ".bitsocial-cli.ipfs");
            await fs.mkdir(repo, { recursive: true });
            await fs.writeFile(path.join(repo, "config"), JSON.stringify({ ...applied.kuboConfig, Addresses: { ...applied.kuboConfig.Addresses, AppendAnnounce: appendAnnounce } }));
            return dataPath;
        };

        // Answers like a running kubo that loaded the given announce list. Real kubo appends /p2p to each address.
        const withRunningKubo = async <T>(announced: string[], run: (kuboRpcUrl: string) => Promise<T>, listen = ["/ip4/127.0.0.1/tcp/4002/ws", "/ip4/0.0.0.0/udp/443/quic-v1/webtransport"]): Promise<T> => {
            const server = http.createServer((request, response) => {
                response.setHeader("content-type", "application/json");
                if (request.url?.startsWith("/api/v0/swarm/addrs/listen")) response.end(JSON.stringify({ Strings: listen }));
                else if (request.url?.startsWith("/api/v0/id")) response.end(JSON.stringify({ ID: peerId, Addresses: announced.map((a) => `${a}/p2p/${peerId}`) }));
                else {
                    response.statusCode = 404;
                    response.end("{}");
                }
            });
            await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
            try {
                return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v0`);
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        };

        const checksNaming = (stdout: string) => JSON.parse(stdout).checks.filter((check: { detail: string }) => check.detail.includes(address));

        it("fails when the address was removed from kubo's config, with the daemon down", async () => {
            const dataPath = await configuredNode({ appendAnnounce: [] });
            const { stdout } = await runStatus(["--json", "--pkcOptions.dataPath", dataPath]);
            const [check] = checksNaming(stdout);
            expect(check, "no check names the address missing from kubo's config").toBeDefined();
            expect(check).toMatchObject({ status: "fail", fix: expect.stringContaining("bitsocial reachability enable") });
        });

        it("fails when the config has the address but running kubo has not loaded it", async () => {
            const dataPath = await configuredNode({ appendAnnounce: [address] });
            const { stdout } = await withRunningKubo([], (url) => runStatus(["--json", "--pkcOptions.dataPath", dataPath], url));
            const [check] = checksNaming(stdout);
            expect(check, "no check names the address kubo is not announcing").toBeDefined();
            expect(check).toMatchObject({ status: "fail", fix: expect.stringContaining("bitsocial reachability enable") });
        });

        it("shows the failure to a person too", async () => {
            const dataPath = await configuredNode({ appendAnnounce: [] });
            const { stdout } = await runStatus(["--pkcOptions.dataPath", dataPath]);
            expect(stdout).toMatch(new RegExp(`\\[problem\\].*${address}`));
        });

        it("stays quiet when kubo's config and running kubo both have the address", async () => {
            const dataPath = await configuredNode({ appendAnnounce: [address] });
            const { stdout } = await withRunningKubo([address], (url) => runStatus(["--json", "--pkcOptions.dataPath", dataPath], url));
            expect(checksNaming(stdout)).toEqual([]);
        });

        const NO_WS_LISTENER = ["/ip4/0.0.0.0/udp/443/quic-v1/webtransport"];
        const checkIds = (stdout: string) => JSON.parse(stdout).checks.map((check: { id: string }) => check.id);

        it("fails when kubo lacks the WSS listener a WSS node needs", async () => {
            const dataPath = await configuredNode({ appendAnnounce: [address] });
            const { stdout } = await withRunningKubo([address], (url) => runStatus(["--json", "--pkcOptions.dataPath", dataPath], url), NO_WS_LISTENER);
            expect(JSON.parse(stdout).checks.find((check: { id: string }) => check.id === "kubo-ws")).toMatchObject({ status: "fail" });
        });

        it("does not ask for that listener on a node setup left without WSS, where enable could not add it", async () => {
            const dataPath = await configuredNode({ appendAnnounce: [address], serveWss: false });
            const { stdout } = await withRunningKubo([address], (url) => runStatus(["--json", "--pkcOptions.dataPath", dataPath], url), NO_WS_LISTENER);
            expect(checkIds(stdout)).not.toContain("kubo-ws");
        });

        it("stays quiet when reachability is disabled", async () => {
            const dataPath = await configuredNode({ enabled: false, appendAnnounce: [] });
            const { stdout } = await runStatus(["--json", "--pkcOptions.dataPath", dataPath]);
            expect(checksNaming(stdout)).toEqual([]);
        });
    });
});
