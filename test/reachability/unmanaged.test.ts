import { describe, expect, it, vi } from "vitest";
import { browserAddressCheck, isBrowserAddress, notConfiguredSummary, verifyUnmanagedAddresses } from "../../src/reachability/unmanaged.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";

describe("isBrowserAddress", () => {
    it.each([
        "/dns4/node.example/tcp/443/tls/ws",
        "/dns6/node.example/tcp/443/wss",
        `/dns4/node.example/tcp/443/tls/ws/p2p/${peerId}`,
        "/ip4/93.184.216.34/tcp/443/tls/ws",
        "/ip4/93.184.216.34/tcp/4001/tls/sni/93-184-216-34.k51.libp2p.direct/ws"
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
        expect(dial.mock.calls[0]).toEqual([`${wss}/p2p/${peerId}`, expect.objectContaining({ timeoutMs: 10_000 })]);
    });

    it("reports why a dial failed, on one line", async () => {
        const dial = async () => {
            throw new Error("connection\n  refused");
        };
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
            const both = async () => ({ v4: ["93.184.216.34"], v6: ["2606:4700::1"] });
            expect(await verifyUnmanagedAddresses({ running: [wss], config: [], dial, resolve: both, localIps: ["93.184.216.34"] })).toEqual([{ address: wss, status: "unconfirmed", error: "timed out" }]);
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

    it("leaves addresses in kubo's config unverified while kubo is down", async () => {
        const dial = vi.fn(async () => ({ peerId }));
        expect(await verifyUnmanagedAddresses({ running: undefined, config: [wss], dial, resolve })).toEqual([{ address: wss, status: "unverified" }]);
        expect(dial).not.toHaveBeenCalled();
    });

    it("goes by what running kubo announces when it is up", async () => {
        expect(await verifyUnmanagedAddresses({ running: [], config: [wss], resolve })).toEqual([]);
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

    it("does not say browsers cannot reach the node when a dial could only not confirm it", () => {
        const text = notConfiguredSummary([unconfirmed]).join("\n");
        expect(text).not.toContain("Browsers cannot reach this node");
        expect(text).toContain(unconfirmed.address);
        expect(text).toContain("timed out");
        expect(notConfiguredSummary([failed, unconfirmed]).join("\n")).not.toContain("Browsers cannot reach this node");
    });

    it("says browsers cannot reach the node only with nothing that works or may work", () => {
        const cannotReach = "Browsers cannot reach this node";
        expect(notConfiguredSummary([]).join("\n")).toContain(cannotReach);
        expect(notConfiguredSummary([failed]).join("\n")).toContain(cannotReach);
        expect(notConfiguredSummary([ok, failed]).join("\n")).not.toContain(cannotReach);
        expect(notConfiguredSummary([unverified]).join("\n")).not.toContain(cannotReach);
    });

    it("reports what was tested, without claiming browsers can reach the node", () => {
        const text = notConfiguredSummary([ok]).join("\n");
        expect(text).toContain("a handshake from this machine succeeded");
        expect(text).toContain("does not manage it");
        expect(text).not.toMatch(/browsers can reach/i);
    });
});
