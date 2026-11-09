// Issue #222: a node whose browser address was set up by hand, without `bitsocial reachability setup`.
import { spawn } from "child_process";
import fs from "fs/promises";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { writeReachabilityConfig } from "../../src/reachability/state.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";
// A closed port on an address the test hook below counts as public, so the handshake really runs and really fails.
const deadWss = "/ip4/127.0.0.1/tcp/9/tls/ws";
// Counted as public too, but not on this machine's interfaces, like a public IP behind a router.
const notOnThisMachineWss = "/ip4/127.0.0.2/tcp/9/tls/ws";
// The opener `status` printed before #239, which the line saying who can connect replaced.
const CANNOT_REACH = "Browsers cannot reach this node";

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

const withKubo = async <T>(answers: { announced?: string[]; autonat?: object }, test: (kuboRpcUrl: string) => Promise<T>): Promise<T> => {
    const server = http.createServer((request, response) => {
        response.setHeader("content-type", "application/json");
        if (request.url?.startsWith("/api/v0/swarm/addrs/autonat") && answers.autonat) response.end(JSON.stringify(answers.autonat));
        else if (request.url?.startsWith("/api/v0/swarm/addrs/listen")) response.end(JSON.stringify({ Strings: [] }));
        else if (request.url?.startsWith("/api/v0/id")) response.end(JSON.stringify({ ID: peerId, Addresses: (answers.announced ?? []).map((address) => `${address}/p2p/${peerId}`) }));
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

const dataPathWithKuboConfig = async (appendAnnounce: string[]) => {
    const dataPath = randomDirectory();
    const repo = path.join(dataPath, ".bitsocial-cli.ipfs");
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, "config"), JSON.stringify({ Identity: { PeerID: peerId }, Addresses: { Swarm: [], AppendAnnounce: appendAnnounce } }));
    return dataPath;
};

describe("reachability status on a node that never ran setup", () => {
    it("names an announced WSS address that fails its handshake, and keeps the warning", { timeout: 60_000 }, async () => {
        await withKubo({ announced: [deadWss] }, async (url) => {
            const human = await run(["--pkcOptions.dataPath", randomDirectory()], url);
            expect(human.stdout).toMatch(/^Browsers: .*the WSS handshake with \/ip4\/127\.0\.0\.1\/tcp\/9\/tls\/ws/m);

            const parsed = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(parsed.configured).toBe(false);
            expect(parsed.unmanagedAddresses).toMatchObject([{ address: deadWss, status: "failed" }]);
            expect(parsed.checks.find((check: { id: string }) => check.id === "browser-address")).toMatchObject({ status: "fail" });
        });
    });

    it("does not say browsers cannot reach it when the failed address is not on this machine", { timeout: 60_000 }, async () => {
        await withKubo({ announced: [notOnThisMachineWss] }, async (url) => {
            const human = await run(["--pkcOptions.dataPath", randomDirectory()], url);
            expect(human.stdout).toMatch(/^Browsers: may be able to connect over WSS through \/ip4\/127\.0\.0\.2\/tcp\/9\/tls\/ws/m);

            const parsed = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(parsed.unmanagedAddresses).toMatchObject([{ address: notOnThisMachineWss, status: "unconfirmed" }]);
            expect(parsed.checks.find((check: { id: string }) => check.id === "browser-address")).toMatchObject({ status: "warn" });
        });
    });

    it("does not say browsers cannot reach it when kubo is down and its config announces WSS", { timeout: 60_000 }, async () => {
        const dataPath = await dataPathWithKuboConfig(["/dns4/node.example/tcp/443/tls/ws"]);
        const human = await run(["--pkcOptions.dataPath", dataPath], "http://127.0.0.1:9/api/v0");
        expect(human.stdout).toMatch(/^Cannot tell who can connect: kubo is not running/);
        expect(human.stdout).toContain("/dns4/node.example/tcp/443/tls/ws");

        const parsed = JSON.parse((await run(["--json", "--pkcOptions.dataPath", dataPath], "http://127.0.0.1:9/api/v0")).stdout);
        expect(parsed.unmanagedAddresses).toEqual([{ address: "/dns4/node.example/tcp/443/tls/ws", status: "unverified" }]);
    });

    it("says browsers cannot connect when kubo announces nothing a browser can use", { timeout: 60_000 }, async () => {
        const relayed = `/dns4/relay.example/tcp/443/wss/p2p/${peerId}/p2p-circuit`;
        const autonat = { reachable: ["/ip4/203.0.113.7/tcp/4001"], unreachable: [], unknown: [] };
        await withKubo({ announced: ["/ip4/203.0.113.7/tcp/4001", "/ip4/10.0.0.5/tcp/443/tls/ws", relayed], autonat }, async (url) => {
            const parsed = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(parsed.unmanagedAddresses).toEqual([]);
            expect(parsed.checks.map((check: { id: string }) => check.id)).not.toContain("browser-address");
            expect((await run(["--pkcOptions.dataPath", randomDirectory()], url)).stdout).toMatch(/^Browsers: cannot connect directly; run: bitsocial reachability setup$/m);
        });
    });

    it("shows AutoNAT's per-address results under inbound, and says they do not cover WSS", { timeout: 60_000 }, async () => {
        const autonat = { reachability: "Public", reachable: ["/ip4/93.184.216.34/tcp/4001"], unreachable: ["/ip6/2606:4700::1/udp/4001/quic-v1"], unknown: ["/ip4/93.184.216.34/udp/4001/quic-v1"] };
        await withKubo({ autonat }, async (url) => {
            const { checks } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            const inbound = checks.find((check: { id: string }) => check.id === "inbound");
            expect(inbound.status).toBe("ok");
            for (const address of [...autonat.reachable, ...autonat.unreachable, ...autonat.unknown]) expect(inbound.detail).toContain(address);
            expect(inbound.detail).toMatch(/not cover WSS through a reverse proxy/);
        });
    });

    // Issue #238: kubo's WebTransport on UDP 4001 reaches browsers without any WSS address.
    it("does not say browsers cannot reach a node AutoNAT reached on its WebTransport port", { timeout: 60_000 }, async () => {
        const webTransport = "/ip4/93.184.216.34/udp/4001/quic-v1/webtransport/certhash/uEiA";
        const autonat = { reachable: ["/ip4/93.184.216.34/udp/4001/quic-v1", webTransport], unreachable: [], unknown: [] };
        await withKubo({ announced: ["/ip4/93.184.216.34/udp/4001/quic-v1", webTransport], autonat }, async (url) => {
            const human = await run(["--pkcOptions.dataPath", randomDirectory()], url);
            expect(human.stdout).not.toContain(CANNOT_REACH);
            expect(human.stdout).toContain("browsers that support WebTransport should be able to connect");

            const { checks } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(checks.find((check: { id: string }) => check.id === "browser-address")).toMatchObject({ status: "warn" });
        });
    });

    // Issue #231: a VM on QEMU user-mode networking announces only addresses nobody else can dial.
    it("fails public-address-announced when kubo announces only loopback and private addresses", { timeout: 60_000 }, async () => {
        await withKubo(
            { announced: ["/ip4/10.0.2.15/tcp/4001", "/ip6/fec0::5054:ff:fe12:3456/udp/4001/quic-v1", "/ip6/::1/tcp/4001"] },
            async (url) => {
                const human = await run(["--pkcOptions.dataPath", randomDirectory()], url);
                expect(human.stdout).toMatch(/\[problem\] This node announces no public address/);
                expect(human.stdout).toContain("bridged networking");

                const { checks } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
                expect(checks.find((check: { id: string }) => check.id === "public-address-announced")).toMatchObject({ status: "fail" });
            }
        );
    });

    it("passes public-address-announced when kubo announces a public address", { timeout: 60_000 }, async () => {
        await withKubo({ announced: ["/ip4/10.0.2.15/tcp/4001", "/ip4/93.184.216.34/tcp/4001"] }, async (url) => {
            const { checks } = JSON.parse((await run(["--json", "--pkcOptions.dataPath", randomDirectory()], url)).stdout);
            expect(checks.find((check: { id: string }) => check.id === "public-address-announced")).toMatchObject({ status: "ok" });
        });
    });

    it("leaves a node setup manages alone", { timeout: 60_000 }, async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, { version: 1, enabled: true, mode: "ip", wsPort: 4002, announce: [], publicIps: ["203.0.113.7"], staging: false, acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory", caddyAdminPort: 2019 });
        await withKubo({ announced: [deadWss] }, async (url) => {
            const parsed = JSON.parse((await run(["--json", "--pkcOptions.dataPath", dataPath], url)).stdout);
            expect(parsed.unmanagedAddresses).toEqual([]);
        });
    });
});
