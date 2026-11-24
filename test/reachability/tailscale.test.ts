// Issue #282: the hop from Tailscale's Funnel ingress servers to this node, measured with `tailscale ping`.
// The tailscale command is faked throughout, so none of this needs Tailscale or a network.
import { describe, expect, it, vi } from "vitest";
import {
    activeFunnelIngressPeers,
    funnelIngressCheck,
    isFunnelAddress,
    parseTailscalePing,
    pingFunnelIngress,
    SLOW_INGRESS_MS,
    type RunCommand
} from "../../src/reachability/tailscale.js";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const ingress = (ip: string, overrides: Record<string, unknown> = {}) => ({
    HostName: "funnel-ingress-node",
    Tags: ["tag:ingress"],
    ShareeNode: true,
    TailscaleIPs: [ip],
    Relay: "par",
    CurAddr: "",
    InEngine: true,
    LastHandshake: ago(20),
    ...overrides
});

const statusJson = (peers: Record<string, unknown>[], backendState = "Running") =>
    JSON.stringify({ BackendState: backendState, Peer: Object.fromEntries(peers.map((peer, index) => [`nodekey:${index}`, peer])) });

const pong = (ip: string, latency: string, via = "DERP(par)") => `pong from funnel-ingress-node (${ip}) via ${via} in ${latency}\n`;

// A tailscale command that answers `status --json` with the given JSON and `ping` from a table of outputs by IP.
const fakeTailscale = (status: string, pings: Record<string, string | Error> = {}) =>
    vi.fn<RunCommand>(async (_file, args) => {
        if (args[0] === "status") return { stdout: status };
        const answer = pings[args.at(-1)!];
        if (answer === undefined) throw Object.assign(new Error("exit 1"), { stdout: "no reply\n" });
        if (answer instanceof Error) throw answer;
        return { stdout: answer };
    });

describe("isFunnelAddress", () => {
    it.each(["/dns4/machine.tailnet.ts.net/tcp/443/tls/ws", "/dns4/Machine.Tailnet.TS.NET/tcp/8443/tls/ws/p2p/12D3KooW"])("accepts %s", (address) => expect(isFunnelAddress(address)).toBe(true));
    it.each(["/dns4/node.example/tcp/443/tls/ws", "/ip4/93.184.216.34/tcp/443/tls/ws", "/dns4/ts.net.example/tcp/443/tls/ws"])("rejects %s", (address) =>
        expect(isFunnelAddress(address)).toBe(false)
    );
});

describe("activeFunnelIngressPeers", () => {
    it("keeps the ingress servers that carried traffic recently, most recent first", () => {
        const status = JSON.parse(
            statusJson([
                ingress("fd7a::1", { LastHandshake: ago(90) }),
                ingress("fd7a::2", { LastHandshake: ago(10), Relay: "fra" }),
                ingress("fd7a::3", { InEngine: false }),
                ingress("fd7a::4", { LastHandshake: ago(3600) }),
                ingress("fd7a::5", { LastHandshake: "0001-01-01T00:00:00Z" }),
                { HostName: "laptop", TailscaleIPs: ["100.64.0.2"], InEngine: true, LastHandshake: ago(5) },
                // Named like one, but not tagged by Tailscale as one.
                ingress("fd7a::6", { Tags: ["tag:other"] })
            ])
        );
        expect(activeFunnelIngressPeers(status, NOW)).toEqual([
            { address: "fd7a::2", relay: "fra" },
            { address: "fd7a::1", relay: "par" }
        ]);
    });

    it.each([undefined, null, "text", 5, {}, { Peer: null }, { Peer: [] }, { Peer: { a: null, b: "x", c: { HostName: "funnel-ingress-node" } } }])(
        "finds none in %j instead of throwing, since the JSON is not a documented interface",
        (status) => expect(activeFunnelIngressPeers(status, NOW)).toEqual([])
    );
});

describe("parseTailscalePing", () => {
    it("reads the latency and the route of each pong", () => {
        const output = pong("fd7a::1", "91ms") + pong("fd7a::1", "1.912s") + pong("fd7a::1", "5ms", "203.0.113.9:41641") + "direct connection not established\n";
        expect(parseTailscalePing(output)).toEqual([
            { latencyMs: 91, via: "DERP(par)" },
            { latencyMs: 1912, via: "DERP(par)" },
            { latencyMs: 5, via: "203.0.113.9:41641" }
        ]);
    });

    it("reads sub-millisecond and minute-long durations the way Go prints them", () => {
        expect(parseTailscalePing(pong("fd7a::1", "850µs") + pong("fd7a::1", "1m2.5s"))).toEqual([
            { latencyMs: 0.85, via: "DERP(par)" },
            { latencyMs: 62_500, via: "DERP(par)" }
        ]);
    });

    it("finds nothing in a timeout", () => {
        expect(parseTailscalePing('ping "fd7a::1" timed out\nno reply\n')).toEqual([]);
    });
});

describe("pingFunnelIngress", () => {
    it("pings the ingress servers that carried traffic and reports the latency of each", async () => {
        const run = fakeTailscale(statusJson([ingress("fd7a::1"), ingress("fd7a::2", { Relay: "fra" }), ingress("fd7a::3", { InEngine: false })]), {
            "fd7a::1": pong("fd7a::1", "95ms") + pong("fd7a::1", "91ms") + pong("fd7a::1", "93ms"),
            "fd7a::2": pong("fd7a::2", "60ms", "DERP(fra)")
        });
        const report = await pingFunnelIngress({ run, now: () => NOW });
        expect(report.status).toBe("ok");
        expect(report.hops).toEqual([
            { address: "fd7a::1", relay: "par", latencyMs: 93, via: "DERP(par)" },
            { address: "fd7a::2", relay: "fra", latencyMs: 60, via: "DERP(fra)" }
        ]);
        const pinged = run.mock.calls.filter(([, args]) => args[0] === "ping").map(([, args]) => args.at(-1));
        expect(pinged.sort()).toEqual(["fd7a::1", "fd7a::2"]);
        // A relayed pong must not make tailscale keep pinging, or exit non-zero, while it waits for a direct path.
        expect(run.mock.calls.find(([, args]) => args[0] === "ping")![1]).toContain("--until-direct=false");
    });

    it("is healthy when the hop is relayed through DERP at about 90 ms, which is what a working Funnel looks like", async () => {
        const run = fakeTailscale(statusJson([ingress("fd7a::1")]), { "fd7a::1": pong("fd7a::1", "91ms") });
        const report = await pingFunnelIngress({ run, now: () => NOW });
        expect(report.status).toBe("ok");
        expect(funnelIngressCheck(report)).toMatchObject({ id: "funnel-ingress", status: "ok" });
        expect(funnelIngressCheck(report).detail).toContain("91 ms");
        expect(funnelIngressCheck(report).detail).toContain("DERP(par)");
    });

    it("warns on latency, as with the 1.9 s seen on the degraded node", async () => {
        const run = fakeTailscale(statusJson([ingress("fd7a::1")]), { "fd7a::1": pong("fd7a::1", "1.9s") + pong("fd7a::1", "1.95s") + pong("fd7a::1", "1.85s") });
        const report = await pingFunnelIngress({ run, now: () => NOW });
        expect(report.status).toBe("warn");
        const check = funnelIngressCheck(report);
        expect(check.status).toBe("warn");
        expect(check.detail).toContain("1900 ms");
        expect(check.fix).toBeDefined();
    });

    it("draws the line at a fixed latency, not at whether the hop is direct", async () => {
        const at = (latencyMs: number, via: string) => pingFunnelIngress({ run: fakeTailscale(statusJson([ingress("fd7a::1")]), { "fd7a::1": pong("fd7a::1", `${latencyMs}ms`, via) }), now: () => NOW });
        expect((await at(SLOW_INGRESS_MS - 1, "DERP(par)")).status).toBe("ok");
        expect((await at(SLOW_INGRESS_MS, "203.0.113.9:41641")).status).toBe("warn");
    });

    it("warns when one of the servers is slow, since a browser may land on either", async () => {
        const run = fakeTailscale(statusJson([ingress("fd7a::1"), ingress("fd7a::2")]), { "fd7a::1": pong("fd7a::1", "90ms"), "fd7a::2": pong("fd7a::2", "2.1s") });
        expect((await pingFunnelIngress({ run, now: () => NOW })).status).toBe("warn");
    });

    it("warns when a server that just carried traffic does not answer", async () => {
        const run = fakeTailscale(statusJson([ingress("fd7a::1")]));
        const report = await pingFunnelIngress({ run, now: () => NOW });
        expect(report.status).toBe("warn");
        expect(report.hops).toEqual([{ address: "fd7a::1", relay: "par", error: "no reply" }]);
        expect(funnelIngressCheck(report).detail).toContain("did not answer");
    });

    it("reads the pongs of a ping that exits non-zero", async () => {
        const failed = Object.assign(new Error("exit 1"), { stdout: pong("fd7a::1", "92ms") + "direct connection not established\n" });
        const report = await pingFunnelIngress({ run: fakeTailscale(statusJson([ingress("fd7a::1")]), { "fd7a::1": failed }), now: () => NOW });
        expect(report).toMatchObject({ status: "ok", hops: [{ latencyMs: 92 }] });
    });

    describe("is skipped with a short note", () => {
        const skipped = async (run: RunCommand) => {
            const report = await pingFunnelIngress({ run, now: () => NOW });
            expect(report.status).toBe("skipped");
            expect(report.hops).toEqual([]);
            expect(funnelIngressCheck(report).status).toBe("unknown");
            expect(funnelIngressCheck(report).fix).toBeUndefined();
            return report.note;
        };

        it("when the tailscale command is missing", async () => {
            const run = vi.fn<RunCommand>(async () => {
                throw Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" });
            });
            expect(await skipped(run)).toMatch(/tailscale command was not found/);
        });

        it("when tailscaled is not running", async () => {
            const run = vi.fn<RunCommand>(async () => {
                throw Object.assign(new Error("exit 1"), { code: 1, stderr: "failed to connect to local tailscaled; it doesn't appear to be running" });
            });
            expect(await skipped(run)).toMatch(/Tailscale is not running/);
        });

        it.each([
            ["NeedsLogin", /logged out/],
            ["Stopped", /stopped/],
            ["NoState", /not running/]
        ])("when Tailscale is %s", async (state, note) => {
            const run = fakeTailscale(statusJson([ingress("fd7a::1")], state));
            expect(await skipped(run)).toMatch(note);
            expect(run).toHaveBeenCalledTimes(1);
        });

        it("when no ingress server carried traffic recently", async () => {
            expect(await skipped(fakeTailscale(statusJson([ingress("fd7a::1", { InEngine: false })])))).toMatch(/no Funnel ingress server/i);
        });

        it("when the status output is not the JSON it used to be", async () => {
            expect(await skipped(fakeTailscale("not json"))).toMatch(/could not be read/);
            expect(await skipped(fakeTailscale(JSON.stringify({ BackendState: "Running" })))).toMatch(/no Funnel ingress server/i);
        });
    });

    it("tries the app's own binary on macOS when tailscale is not on the PATH", async () => {
        const run = vi.fn<RunCommand>(async (file, args) => {
            if (file === "tailscale") throw Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" });
            if (args[0] === "status") return { stdout: statusJson([ingress("fd7a::1")]) };
            return { stdout: pong("fd7a::1", "88ms") };
        });
        const report = await pingFunnelIngress({ run, now: () => NOW, platform: "darwin" });
        expect(report.status).toBe("ok");
        expect(run.mock.calls.at(-1)![0]).toBe("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    });

    it("pings at most three servers", async () => {
        const peers = ["fd7a::1", "fd7a::2", "fd7a::3", "fd7a::4", "fd7a::5"];
        const run = fakeTailscale(statusJson(peers.map((ip) => ingress(ip))), Object.fromEntries(peers.map((ip) => [ip, pong(ip, "90ms")])));
        expect((await pingFunnelIngress({ run, now: () => NOW })).hops).toHaveLength(3);
    });
});
