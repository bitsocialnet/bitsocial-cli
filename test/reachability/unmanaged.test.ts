import { describe, expect, it, vi } from "vitest";
import { HandshakeTimeoutError } from "../../src/reachability/libp2p-dial.js";
import type { RunCommand } from "../../src/reachability/tailscale.js";
import {
    autonatEvidence,
    browserAddressCheck,
    checkWssAddresses,
    isBrowserAddress,
    SLOW_HANDSHAKE_MS,
    verifyUnmanagedAddresses,
    wssHandshakeCheck
} from "../../src/reachability/unmanaged.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";

describe("isBrowserAddress", () => {
    it.each([
        "/dns4/node.example/tcp/443/tls/ws",
        "/dns6/node.example/tcp/443/wss",
        `/dns4/node.example/tcp/443/tls/ws/p2p/${peerId}`,
        "/ip4/93.184.216.34/tcp/443/tls/ws",
        "/ip4/93.184.216.34/tcp/4001/tls/sni/93-184-216-34.k51.libp2p.direct/ws",
        "/dns4/93-184-216-34.k51.libp2p.direct/tcp/4001/tls/ws"
    ])("accepts %s", (address) => expect(isBrowserAddress(address)).toBe(true));

    it.each([
        "/ip4/93.184.216.34/tcp/4001",
        "/ip4/93.184.216.34/tcp/4011/ws",
        "/ip4/93.184.216.34/udp/4001/quic-v1/webtransport",
        "/ip4/127.0.0.1/tcp/443/tls/ws",
        "/ip4/10.0.0.5/tcp/443/tls/ws",
        "/ip6/fd00::1/tcp/443/tls/ws",
        "/ip4/93.184.216.34/tcp/4001/tls/sni/*.k51.libp2p.direct/ws",
        `/dns4/relay.example/tcp/443/wss/p2p/${peerId}/p2p-circuit/p2p/${peerId}`
    ])("rejects %s", (address) => expect(isBrowserAddress(address)).toBe(false));

    it("accepts a private address the test hook counts as public", () => {
        expect(isBrowserAddress("/ip4/127.0.0.1/tcp/443/tls/ws", ["127.0.0.1"])).toBe(true);
    });
});

describe("verifyUnmanagedAddresses", () => {
    const wss = "/dns4/node.example/tcp/443/tls/ws";
    const resolve = async () => ({ v4: ["93.184.216.34"], v6: [] });

    it("dials with the peer id, and reports without it, once per address", async () => {
        const dial = vi.fn(async () => ({ peerId }));
        const results = await verifyUnmanagedAddresses({ running: [`${wss}/p2p/${peerId}`, wss], config: [], dial, resolve });
        expect(results).toEqual([{ address: wss, status: "ok" }]);
        expect(dial).toHaveBeenCalledTimes(1);
        expect(dial.mock.calls[0]).toEqual([`${wss}/p2p/${peerId}`, expect.objectContaining({ timeoutMs: 6_000 })]);
    });

    // Issue #282: a browser gives up on an address after 6 seconds, so a handshake that needs most of that is no pass.
    describe("how long the handshake took", () => {
        const timed = (handshakeMs: number) => verifyUnmanagedAddresses({ running: [`${wss}/p2p/${peerId}`], config: [], dial: async () => ({ peerId, handshakeMs }), resolve });

        it("is reported with a handshake that worked", async () => {
            expect(await timed(640)).toEqual([{ address: wss, status: "ok", handshakeMs: 640 }]);
        });

        it("marks one that worked but took half the browsers' limit or more as slow", async () => {
            expect(SLOW_HANDSHAKE_MS).toBe(3_000);
            expect(await timed(SLOW_HANDSHAKE_MS - 1)).toEqual([{ address: wss, status: "ok", handshakeMs: SLOW_HANDSHAKE_MS - 1 }]);
            expect(await timed(SLOW_HANDSHAKE_MS)).toEqual([{ address: wss, status: "ok", handshakeMs: SLOW_HANDSHAKE_MS, slow: true }]);
        });

        it("marks one that outlasted the limit as timed out", async () => {
            const dial = async () => {
                throw new HandshakeTimeoutError(6_000);
            };
            const [result] = await verifyUnmanagedAddresses({ running: [`${wss}/p2p/${peerId}`], config: [], dial, resolve, localIps: ["93.184.216.34"] });
            expect(result).toMatchObject({ address: wss, status: "failed", timedOut: true });
            expect(result!.error).toMatch(/did not finish within 6 s/);
        });
    });

    // A Funnel name leads to Tailscale's servers, never back through this machine's own router, so there is no
    // hairpin to blame: a handshake that fails through it is a failure, not something this machine could not test.
    it("fails a ts.net address outright instead of calling it untestable from here", async () => {
        const funnel = "/dns4/machine.tailnet.ts.net/tcp/443/tls/ws";
        const dial = async () => {
            throw new HandshakeTimeoutError(6_000);
        };
        const [result] = await verifyUnmanagedAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve: async () => ({ v4: ["93.184.216.40"], v6: [] }), localIps: ["192.168.1.5"] });
        expect(result).toMatchObject({ address: funnel, status: "failed", timedOut: true });
    });

    // Issue #281: with MagicDNS this machine resolves its own ts.net name to its tailnet address. The check goes by
    // what public DNS says, and hands those records to the dial so it takes the path browsers take.
    describe("where the name leads", () => {
        const funnel = "/dns4/machine.tailnet.ts.net/tcp/443/tls/ws";
        const relay = { v4: ["93.184.216.40"], v6: [], source: "public" as const };

        it("dials the addresses the name was resolved to, instead of letting the dial resolve it again", async () => {
            const dial = vi.fn(async () => ({ peerId, handshakeMs: 700 }));
            const results = await verifyUnmanagedAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve: async () => relay });
            expect(results).toEqual([{ address: funnel, status: "ok", handshakeMs: 700 }]);
            expect(dial).toHaveBeenCalledWith(`${funnel}/p2p/${peerId}`, expect.objectContaining({ records: relay }));
        });

        it("says so when public DNS could not be reached and this machine's resolver was used", async () => {
            const system = { ...relay, source: "system" as const };
            const dial = async () => ({ peerId, handshakeMs: 700 });
            const results = await verifyUnmanagedAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve: async () => system });
            expect(results).toEqual([{ address: funnel, status: "ok", handshakeMs: 700, systemDns: true }]);
            expect(wssHandshakeCheck(results)!.detail).toMatch(/resolved by this machine's own resolver/);
        });

        it("says so when the dial reports that it ended up on this machine's resolver after all", async () => {
            const dial = async () => ({ peerId, handshakeMs: 700, dns: { name: "machine.tailnet.ts.net", source: "system" as const, ips: [] } });
            const results = await verifyUnmanagedAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve: async () => relay });
            expect(results).toEqual([{ address: funnel, status: "ok", handshakeMs: 700, systemDns: true }]);
        });

        it("still fails a name that even this machine's resolver only leads to a private address, as MagicDNS does", async () => {
            const dial = vi.fn(async () => ({ peerId }));
            const tailnet = { v4: ["100.101.102.103"], v6: [], source: "system" as const };
            const results = await verifyUnmanagedAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve: async () => tailnet });
            expect(results).toMatchObject([{ address: funnel, status: "failed", systemDns: true }]);
            expect(results[0]!.error).toMatch(/resolves only to private addresses/);
            expect(dial).not.toHaveBeenCalled();
        });
    });

    it("reports why a dial failed, on one line", async () => {
        const dial = async () => {
            throw new Error("connection\n  refused");
        };
        expect(await verifyUnmanagedAddresses({ running: [`${wss}/p2p/${peerId}`], config: [], dial, resolve, localIps: ["93.184.216.34"] })).toEqual([{ address: wss, status: "failed", error: "connection refused" }]);
    });

    it("reports a dial that rejects with something other than an Error", async () => {
        const dial = () => Promise.reject("connection\n  refused");
        expect(await verifyUnmanagedAddresses({ running: [`${wss}/p2p/${peerId}`], config: [], dial, resolve, localIps: ["93.184.216.34"] })).toEqual([{ address: wss, status: "failed", error: "connection refused" }]);
    });

    describe("a failed dial, by where the address leads", () => {
        const dial = async () => {
            throw new Error("timed out");
        };
        const literal = "/ip4/93.184.216.34/tcp/4001/tls/sni/93-184-216-34.k51.libp2p.direct/ws";

        it("is a failure when the IP is on this machine, which reaches it directly", async () => {
            expect(await verifyUnmanagedAddresses({ running: [literal], config: [], dial, localIps: ["93.184.216.34"] })).toEqual([{ address: literal, status: "failed", error: "timed out" }]);
        });

        it("is unconfirmed when the IP is elsewhere, as behind a router that may not loop it back", async () => {
            expect(await verifyUnmanagedAddresses({ running: [literal], config: [], dial, localIps: ["192.168.1.5"] })).toEqual([{ address: literal, status: "unconfirmed", error: "timed out" }]);
        });

        it("goes by what a name resolves to", async () => {
            expect(await verifyUnmanagedAddresses({ running: [wss], config: [], dial, resolve, localIps: ["93.184.216.34"] })).toEqual([{ address: wss, status: "failed", error: "timed out" }]);
            expect(await verifyUnmanagedAddresses({ running: [wss], config: [], dial, resolve, localIps: ["192.168.1.5"] })).toEqual([{ address: wss, status: "unconfirmed", error: "timed out" }]);
        });

        it("is unconfirmed when a name leads both here and elsewhere", async () => {
            const both = async () => ({ v4: ["93.184.216.34", "93.184.216.35"], v6: [] });
            expect(await verifyUnmanagedAddresses({ running: [wss], config: [], dial, resolve: both, localIps: ["93.184.216.34"] })).toEqual([{ address: wss, status: "unconfirmed", error: "timed out" }]);
        });

        // A DNS outage on this machine says nothing about whether browsers can resolve the name, Funnel or not.
        it.each(["/dns4/node.example/tcp/443/tls/ws", "/dns4/machine.tailnet.ts.net/tcp/443/tls/ws"])("is unconfirmed, without dialing, when no DNS resolver answered for %s", async (address) => {
            const dial = vi.fn(async () => ({ peerId }));
            const resolve = async () => ({ v4: [], v6: [], source: "system" as const, unanswered: ["v4" as const, "v6" as const] });
            const name = address.split("/")[2];
            expect(await verifyUnmanagedAddresses({ running: [`${address}/p2p/${peerId}`], config: [], dial, resolve, localIps: [] })).toEqual([
                { address, status: "unconfirmed", error: `no DNS resolver answered for ${name}, so where it leads could not be checked`, systemDns: true }
            ]);
            expect(dial).not.toHaveBeenCalled();
        });

        it("is a failure when a name resolves to nothing", async () => {
            expect(await verifyUnmanagedAddresses({ running: [wss], config: [], dial, resolve: async () => ({ v4: [], v6: [] }), localIps: [] })).toEqual([{ address: wss, status: "failed", error: "timed out" }]);
        });
    });

    it("fails a name that resolves only to private addresses, without dialing it", async () => {
        const dial = vi.fn(async () => ({ peerId }));
        const results = await verifyUnmanagedAddresses({ running: [`${wss}/p2p/${peerId}`], config: [], dial, resolve: async () => ({ v4: ["192.168.1.5"], v6: [] }) });
        expect(results).toEqual([{ address: wss, status: "failed", error: "node.example resolves only to private addresses" }]);
        expect(dial).not.toHaveBeenCalled();
    });

    // A /dns4 address is dialed over IPv4 only, so a public IPv6 record says nothing about where it leads.
    it.each([
        ["/dns4/node.example/tcp/443/tls/ws", { v4: ["192.168.1.20"], v6: ["2606:4700::40"] }],
        ["/dns6/node.example/tcp/443/tls/ws", { v4: ["93.184.216.34"], v6: ["fd00::20"] }]
    ])("judges %s only by the records of the family it dials", async (address, records) => {
        const dial = vi.fn(async () => ({ peerId }));
        const results = await verifyUnmanagedAddresses({ running: [`${address}/p2p/${peerId}`], config: [], dial, resolve: async () => records });
        expect(results).toEqual([{ address, status: "failed", error: "node.example resolves only to private addresses" }]);
        expect(dial).not.toHaveBeenCalled();
    });

    it("leaves addresses in kubo's config unverified while kubo is down", async () => {
        const dial = vi.fn(async () => ({ peerId }));
        expect(await verifyUnmanagedAddresses({ running: undefined, config: [wss], dial, resolve })).toEqual([{ address: wss, status: "unverified" }]);
        expect(dial).not.toHaveBeenCalled();
    });

    it("goes by what running kubo announces when it is up", async () => {
        expect(await verifyUnmanagedAddresses({ running: [], config: [wss], resolve })).toEqual([]);
    });
});

describe("checkWssAddresses", () => {
    const funnel = "/dns4/machine.tailnet.ts.net/tcp/443/tls/ws";
    const other = "/dns4/node.example/tcp/443/tls/ws";
    const resolve = async () => ({ v4: ["93.184.216.40"], v6: [] });
    const now = Date.parse("2026-11-20T12:00:00Z");
    const tailscaleStatus = JSON.stringify({
        BackendState: "Running",
        Peer: { a: { HostName: "funnel-ingress-node", Tags: ["tag:ingress"], TailscaleIPs: ["fd7a::1"], Relay: "par", InEngine: true, LastHandshake: new Date(now - 5_000).toISOString() } }
    });

    it("pings the Funnel ingress only after the handshake has put traffic through it", async () => {
        const order: string[] = [];
        const dial = async () => (order.push("dial"), { peerId, handshakeMs: 700 });
        const runTailscale: RunCommand = async (_file, args) => {
            order.push(args[0]!);
            return { stdout: args[0] === "status" ? tailscaleStatus : "pong from funnel-ingress-node (fd7a::1) via DERP(par) in 91ms\n" };
        };
        const result = await checkWssAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve, runTailscale, now: () => now });
        expect(order).toEqual(["dial", "status", "ping"]);
        expect(result.addresses).toEqual([{ address: funnel, status: "ok", handshakeMs: 700 }]);
        expect(result.funnelIngress).toMatchObject({ status: "ok", hops: [{ address: "fd7a::1", latencyMs: 91, via: "DERP(par)" }] });
    });

    it("leaves Tailscale alone when no announced address is a ts.net name", async () => {
        const runTailscale = vi.fn<RunCommand>();
        const result = await checkWssAddresses({ running: [`${other}/p2p/${peerId}`], config: [], dial: async () => ({ peerId, handshakeMs: 300 }), resolve, runTailscale });
        expect(result.funnelIngress).toBeUndefined();
        expect(runTailscale).not.toHaveBeenCalled();
    });

    it("leaves Tailscale alone while kubo is down, when nothing was dialed", async () => {
        const runTailscale = vi.fn<RunCommand>();
        const result = await checkWssAddresses({ running: undefined, config: [funnel], resolve, runTailscale });
        expect(result).toEqual({ addresses: [{ address: funnel, status: "unverified" }] });
        expect(runTailscale).not.toHaveBeenCalled();
    });

    it("still reports the handshake when the tailscale command is missing", async () => {
        const runTailscale: RunCommand = async () => {
            throw Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" });
        };
        const result = await checkWssAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial: async () => ({ peerId, handshakeMs: 4_200 }), resolve, runTailscale });
        expect(result.addresses).toEqual([{ address: funnel, status: "ok", handshakeMs: 4_200, slow: true }]);
        expect(result.funnelIngress).toMatchObject({ status: "skipped", hops: [] });
    });

    it("still pings when the handshake failed, which is when the hop's latency matters most", async () => {
        const dial = async () => {
            throw new HandshakeTimeoutError(6_000);
        };
        const runTailscale: RunCommand = async (_file, args) => ({ stdout: args[0] === "status" ? tailscaleStatus : "pong from funnel-ingress-node (fd7a::1) via DERP(par) in 1.9s\n" });
        const result = await checkWssAddresses({ running: [`${funnel}/p2p/${peerId}`], config: [], dial, resolve, runTailscale, now: () => now });
        expect(result.addresses).toMatchObject([{ status: "failed", timedOut: true }]);
        expect(result.funnelIngress).toMatchObject({ status: "warn", hops: [{ latencyMs: 1900 }] });
    });
});

describe("wssHandshakeCheck", () => {
    const fast = { address: "/dns4/a.example/tcp/443/tls/ws", status: "ok", handshakeMs: 640 } as const;
    const slow = { address: "/dns4/machine.tailnet.ts.net/tcp/443/tls/ws", status: "ok", handshakeMs: 4_230, slow: true } as const;
    const timedOut = { address: "/dns4/machine.tailnet.ts.net/tcp/443/tls/ws", status: "failed", error: "the handshake did not finish within 6 s, which is when browsers give up on an address", timedOut: true } as const;
    const refused = { address: "/dns4/b.example/tcp/443/tls/ws", status: "failed", error: "refused" } as const;

    it("says how long each handshake took", () => {
        const check = wssHandshakeCheck([fast])!;
        expect(check).toMatchObject({ id: "wss-handshake", status: "ok" });
        expect(check.detail).toContain(`${fast.address} took 0.6 s`);
        expect(check.fix).toBeUndefined();
    });

    it("warns about a slow one, with the browsers' limit", () => {
        const check = wssHandshakeCheck([fast, slow])!;
        expect(check.status).toBe("warn");
        expect(check.detail).toContain(`${slow.address} took 4.2 s`);
        expect(check.detail).toContain("6 s");
        expect(check.fix).toContain("tailscale-funnel.md");
    });

    it("fails on one that outlasted the limit", () => {
        const check = wssHandshakeCheck([fast, timedOut])!;
        expect(check.status).toBe("fail");
        expect(check.detail).toContain("did not finish within 6 s");
    });

    // A router without NAT hairpin drops a machine's connection to its own public address, which also ends in a timeout.
    it("does not call a timeout slow when this machine could not test the address from inside its own network", () => {
        const untestable = { address: "/ip4/93.184.216.34/tcp/443/tls/ws", status: "unconfirmed", error: timedOut.error, timedOut: true } as const;
        expect(wssHandshakeCheck([untestable])).toBeUndefined();
        expect(wssHandshakeCheck([fast, untestable])).toMatchObject({ status: "ok" });
        expect(wssHandshakeCheck([fast, untestable])!.detail).not.toContain(untestable.address);
    });

    it("does not point at the Funnel doc for an address that is not a Funnel", () => {
        expect(wssHandshakeCheck([{ ...slow, address: "/dns4/a.example/tcp/443/tls/ws" }])!.fix).not.toContain("tailscale");
    });

    it("is absent with nothing timed, as other failures are reported elsewhere", () => {
        expect(wssHandshakeCheck([])).toBeUndefined();
        expect(wssHandshakeCheck([refused, { address: "/dns4/c.example/tcp/443/tls/ws", status: "unverified" }])).toBeUndefined();
    });
});

describe("reporting", () => {
    const ok = { address: "/dns4/a.example/tcp/443/tls/ws", status: "ok" } as const;
    const failed = { address: "/dns4/b.example/tcp/443/tls/ws", status: "failed", error: "refused" } as const;
    const unverified = { address: "/dns4/c.example/tcp/443/tls/ws", status: "unverified" } as const;
    const unconfirmed = { address: "/dns4/d.example/tcp/443/tls/ws", status: "unconfirmed", error: "timed out" } as const;

    it("has no check without an address", () => expect(browserAddressCheck([])).toBeUndefined());
    it("passes when every address works", () => expect(browserAddressCheck([ok])!.status).toBe("ok"));
    it("warns, naming the broken one, when only some work", () => {
        const check = browserAddressCheck([ok, failed])!;
        expect(check.status).toBe("warn");
        expect(check.detail).toContain(failed.address);
    });
    it("fails when none works", () => expect(browserAddressCheck([failed])!.status).toBe("fail"));
    it("is unknown while it cannot verify", () => expect(browserAddressCheck([unverified])!.status).toBe("unknown"));

    it("warns, naming the address and why, when a dial could not confirm it", () => {
        const check = browserAddressCheck([unconfirmed])!;
        expect(check.status).toBe("warn");
        expect(check.detail).toContain(unconfirmed.address);
        expect(check.detail).toContain("timed out");
        expect(browserAddressCheck([ok, unconfirmed])!.status).toBe("warn");
        expect(browserAddressCheck([failed, unconfirmed])!.status).toBe("warn");
    });

});

// Issue #238: kubo's WebTransport on UDP 4001 lets browsers in without any WSS address.
describe("WebTransport and desktop reachability from AutoNAT", () => {
    const webTransport = "/ip4/93.184.216.34/udp/4001/quic-v1/webtransport/certhash/uEiA/certhash/uEiB";
    const quic = "/ip4/93.184.216.34/udp/4001/quic-v1";
    const tcp = "/ip4/93.184.216.34/tcp/4001";
    const failed = { address: "/dns4/b.example/tcp/443/tls/ws", status: "failed", error: "refused" } as const;
    const autonat = (fields: { reachable?: string[]; unreachable?: string[]; unknown?: string[] }) =>
        autonatEvidence({ reachable: [], unreachable: [], unknown: [], ...fields });
    const reached = autonat({ reachable: [tcp, quic, webTransport] });
    const untested = autonat({ reachable: [tcp], unknown: [quic, webTransport] });
    const desktopOnly = autonat({ reachable: [tcp, quic], unreachable: [webTransport] });
    const nothing = autonat({ unreachable: [tcp, quic, webTransport] });

    it("sorts AutoNAT's results into WebTransport reached, untested, and anything reached", () => {
        expect(reached).toEqual({ reached: [tcp, quic, webTransport], webTransportReached: [webTransport], webTransportUntested: [] });
        expect(untested.webTransportUntested).toEqual([webTransport]);
        expect(autonatEvidence(undefined)).toEqual({ reached: [], webTransportReached: [], webTransportUntested: [] });
    });

    it("warns, not fails, on browser-address when WebTransport was reached and no WSS works", () => {
        expect(browserAddressCheck([], reached)).toMatchObject({
            id: "browser-address",
            status: "warn",
            detail: expect.stringContaining("UDP 4001")
        });
        expect(browserAddressCheck([failed], reached)).toMatchObject({ status: "warn", detail: expect.stringContaining(failed.address) });
    });

    it("is unknown while WebTransport is not tested yet, and warns beside a failed WSS address", () => {
        expect(browserAddressCheck([], untested)!.status).toBe("unknown");
        expect(browserAddressCheck([failed], untested)!.status).toBe("warn");
    });

    it("tells a node desktop peers reach that it seeds for them, and warns rather than fails on browsers", () => {
        expect(browserAddressCheck([failed], desktopOnly)).toMatchObject({
            status: "warn",
            detail: expect.stringContaining("Desktop nodes can reach this node")
        });
    });

    it("keeps failing when AutoNAT reached nothing", () => {
        expect(browserAddressCheck([failed], nothing)!.status).toBe("fail");
        expect(browserAddressCheck([], nothing)).toBeUndefined();
    });

    it("adds the WebTransport result beside a WSS address that only some checks could confirm", () => {
        const unconfirmed = { address: "/dns4/d.example/tcp/443/tls/ws", status: "unconfirmed", error: "timed out" } as const;
        expect(browserAddressCheck([unconfirmed], reached)!.detail).toContain("UDP 4001");
    });
});
