// Issue #239: `reachability status` opens with whether desktop nodes and browsers can connect, on every kind of node.
import { spawn } from "child_process";
import http from "http";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { writeReachabilityConfig, writeReachabilityDeclined } from "../../src/reachability/state.js";
import { KUBO_NOT_RUNNING, NOBODY_CAN_CONNECT } from "../../src/reachability/verdict.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";
const tcp = "/ip4/93.184.216.34/tcp/4001";
const quic = "/ip4/93.184.216.34/udp/4001/quic-v1";
const webTransport = `${quic}/webtransport/certhash/uEiA`;
// A closed port on an address the test hook counts as public, so the handshake really runs and really fails.
const deadWss = "/ip4/127.0.0.1/tcp/9/tls/ws";
// Counted as public too, but not on this machine's interfaces, so a failed handshake is only unconfirmed, like an AutoTLS address behind a router.
const otherWss = "/ip4/127.0.0.2/tcp/9/tls/ws";

const run = (args: string[], kuboRpcUrl: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        const child = spawn("node", ["./bin/run", "reachability", "status", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, KUBO_RPC_URL: kuboRpcUrl, IPFS_PATH: "", BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1,127.0.0.2" }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
    });

const withKubo = async <T>(answers: { announced: string[]; autonat?: object; peers?: unknown[] }, test: (kuboRpcUrl: string) => Promise<T>): Promise<T> => {
    const server = http.createServer((request, response) => {
        response.setHeader("content-type", "application/json");
        if (request.url?.startsWith("/api/v0/swarm/addrs/autonat") && answers.autonat) response.end(JSON.stringify(answers.autonat));
        else if (request.url?.startsWith("/api/v0/swarm/peers") && answers.peers) response.end(JSON.stringify({ Peers: answers.peers }));
        else if (request.url?.startsWith("/api/v0/swarm/addrs/listen")) response.end(JSON.stringify({ Strings: [] }));
        else if (request.url?.startsWith("/api/v0/id")) response.end(JSON.stringify({ ID: peerId, Addresses: answers.announced.map((address) => `${address}/p2p/${peerId}`) }));
        else {
            response.statusCode = 404;
            response.end("{}");
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        return await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v0`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
};

const managedNode = async (enabled: boolean, announce: string[], serveWss?: false) => {
    const dataPath = randomDirectory();
    await writeReachabilityConfig(dataPath, {
        version: 1,
        enabled,
        mode: "ip",
        wsPort: 4002,
        announce,
        publicIps: ["127.0.0.1"],
        staging: false,
        acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory",
        caddyAdminPort: 2019,
        ...(serveWss === false ? { serveWss } : {})
    });
    return dataPath;
};

const lines = (stdout: string) => stdout.split("\n");
const DEAD_KUBO = "http://127.0.0.1:9/api/v0";

describe("reachability status opens with who can connect", () => {
    it("on a node that never ran setup, with WebTransport only, and replaces the old opener", { timeout: 60_000 }, async () => {
        const autonat = { reachable: [tcp, quic, webTransport], unreachable: [], unknown: [] };
        await withKubo({ announced: [tcp, quic, webTransport], autonat }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", randomDirectory()], url);
            expect(lines(stdout)[0]).toMatch(/^Desktop nodes \(kubo\/helia\): can connect \(AutoNAT reached /);
            expect(lines(stdout)[1]).toMatch(/^Browsers: those that support WebTransport should be able to connect, unless their network blocks UDP; run setup to add WSS/);
            expect(stdout).not.toContain("Browsers cannot reach this node");

            const { connectivity } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(connectivity).toMatchObject({ desktop: { status: "ok" }, browsers: { status: "warn" } });
            expect(connectivity.summary).toBeUndefined();
        });
    });

    it("says nobody can connect on a node that announces no public address (#231)", { timeout: 60_000 }, async () => {
        await withKubo({ announced: ["/ip4/10.0.2.15/tcp/4001"], autonat: { reachable: [], unreachable: [], unknown: [] } }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", randomDirectory()], url);
            expect(lines(stdout)[0]).toBe(NOBODY_CAN_CONNECT);
            expect(stdout).not.toContain("Desktop nodes");

            const { connectivity } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(connectivity).toMatchObject({ desktop: { status: "fail" }, browsers: { status: "fail" }, summary: NOBODY_CAN_CONNECT });
        });
    });

    it("reframes an idle node with no peers instead of listing untested addresses (#258)", { timeout: 60_000 }, async () => {
        const autonat = { reachable: [], unreachable: [], unknown: [tcp, quic, webTransport] };
        await withKubo({ announced: [tcp, quic, webTransport], autonat, peers: [] }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", randomDirectory()], url);
            expect(lines(stdout)[0]).toMatch(/^Desktop nodes \(kubo\/helia\): not known yet: AutoNAT can't test while kubo has no peers/);
            expect(lines(stdout)[0]).toMatch(/idle/);
            expect(lines(stdout)[1]).toMatch(/^Browsers: not known yet: AutoNAT can't test while kubo has no peers/);
            // The ~10-address "not tested yet" wall is gone from the verdict lines.
            expect(lines(stdout)[0]).not.toContain(webTransport);

            const { connectivity, diagnostics } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(connectivity).toMatchObject({ desktop: { status: "unknown" }, browsers: { status: "unknown" } });
            // The inbound diagnostic is reframed as the normal idle state, not a wall of addresses.
            const inbound = diagnostics.find((d: { id: string }) => d.id === "inbound");
            expect(inbound.detail).toMatch(/no peers/);
            expect(inbound.detail).not.toContain(webTransport);
        });
    });

    it("says it cannot tell while kubo is not running", async () => {
        const { stdout } = await run(["--pkcOptions.dataPath", randomDirectory()], DEAD_KUBO);
        expect(lines(stdout)[0]).toBe(KUBO_NOT_RUNNING);
        expect(stdout).not.toContain("Nobody can connect");
    });

    it("comes before the declined line", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityDeclined(dataPath);
        const { stdout } = await run(["--pkcOptions.dataPath", dataPath], DEAD_KUBO);
        expect(lines(stdout)[0]).toBe(KUBO_NOT_RUNNING);
        expect(lines(stdout)[1]).toMatch(/^Reachability: declined/);
    });

    it("comes before Enabled on a managed node, and tests its WSS address with a handshake", { timeout: 60_000 }, async () => {
        const dataPath = await managedNode(true, [deadWss]);
        await withKubo({ announced: [tcp, deadWss], autonat: { reachable: [tcp], unreachable: [], unknown: [] } }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", dataPath], url);
            expect(lines(stdout)[0]).toMatch(/^Desktop nodes \(kubo\/helia\): can connect/);
            expect(lines(stdout)[1]).toMatch(/^Browsers: cannot connect directly; the WSS handshake with \/ip4\/127\.0\.0\.1\/tcp\/9\/tls\/ws/);
            expect(lines(stdout)[2]).toBe("Enabled: yes");

            const parsed = JSON.parse((await run(["--json", "--pkcOptions.dataPath", dataPath], url)).stdout);
            expect(parsed.connectivity.browsers.status).toBe("warn");
            // Still only for nodes setup does not manage.
            expect(parsed.unmanagedAddresses).toEqual([]);
        });
    });

    // Review on #243: disable restores AutoTLS, whose WSS address setup does not manage and must still be tested.
    it("still tests WSS addresses setup does not manage on a disabled node, and skips setup's own", { timeout: 60_000 }, async () => {
        const dataPath = await managedNode(false, [deadWss]);
        await withKubo({ announced: [tcp, deadWss, otherWss], autonat: { reachable: [tcp], unreachable: [], unknown: [] } }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", dataPath], url);
            expect(lines(stdout)[1]).toMatch(/^Browsers: may be able to connect over WSS through \/ip4\/127\.0\.0\.2\/tcp\/9\/tls\/ws/);
            expect(lines(stdout)[1]).not.toContain(deadWss);
        });
    });

    it("points an enabled managed node whose WSS is not announced at the requirements, not at setup", { timeout: 60_000 }, async () => {
        const dataPath = await managedNode(true, [deadWss]);
        await withKubo({ announced: [tcp], autonat: { reachable: [tcp], unreachable: [], unknown: [] } }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", dataPath], url);
            expect(lines(stdout)[1]).toMatch(/^Browsers: cannot connect directly; .*see the requirements below/);
            expect(lines(stdout)[1]).not.toMatch(/run:? (bitsocial reachability )?setup/);
        });
    });

    // Review on #243: enable restores a setup that has no WSS, so "enable" would not add any.
    it("tells a disabled node whose setup has no WSS to run setup, not enable", { timeout: 60_000 }, async () => {
        const dataPath = await managedNode(false, [], false);
        await withKubo({ announced: [tcp], autonat: { reachable: [tcp], unreachable: [], unknown: [] } }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", dataPath], url);
            expect(lines(stdout)[1]).toBe("Browsers: cannot connect directly; run: bitsocial reachability setup");
        });
    });

    it("says WSS is off on a disabled managed node, without a handshake", { timeout: 60_000 }, async () => {
        const dataPath = await managedNode(false, [deadWss]);
        await withKubo({ announced: [tcp], autonat: { reachable: [tcp], unreachable: [], unknown: [] } }, async (url) => {
            const { stdout } = await run(["--pkcOptions.dataPath", dataPath], url);
            expect(lines(stdout)[1]).toBe("Browsers: cannot connect directly: reachability is disabled. Run: bitsocial reachability enable");
        });
    });
});
