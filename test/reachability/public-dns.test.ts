// Issue #281: an announced name is resolved over public DNS before it is dialed, so the handshake takes the path
// browsers take. With Tailscale's MagicDNS a machine resolves its own ts.net name to its tailnet address, and the
// dial then lands on whatever listens on that machine's own port 443.
// The DNS queries are faked throughout, and the one real dial goes to a listener on loopback, so no network is needed.
import dns from "dns";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLibp2p, type Libp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { noise } from "@libp2p/noise";
import { yamux } from "@libp2p/yamux";
import { identify } from "@libp2p/identify";
import { dialWithLibp2p } from "../../src/reachability/libp2p-dial.js";
import { PUBLIC_RESOLVERS, resolveOverPublicDns, withPinnedLookup, type DnsQuery } from "../../src/reachability/public-dns.js";

const dnsError = (code: string) => Object.assign(new Error(`query${code}`), { code });

describe("resolveOverPublicDns", () => {
    const name = "machine.tailnet.ts.net";

    it("asks public resolvers, not the ones this machine is configured with", async () => {
        const query = vi.fn<DnsQuery>(async (_name, type) => (type === "A" ? ["93.184.216.40"] : ["2606:4700::40"]));
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: ["93.184.216.40"], v6: ["2606:4700::40"], source: "public" });
        expect(query).toHaveBeenCalledTimes(2);
        for (const [asked, , servers] of query.mock.calls) {
            expect(asked).toBe(name);
            expect(servers).toEqual(PUBLIC_RESOLVERS);
        }
        expect(PUBLIC_RESOLVERS.length).toBeGreaterThan(1);
    });

    it("does not fall back to this machine's resolver for a name public DNS answered for, whatever MagicDNS would say", async () => {
        // The public answer is Tailscale's relay; this machine's resolver would say the tailnet address.
        const query = vi.fn<DnsQuery>(async (_name, type, servers) => {
            if (servers === undefined) return type === "A" ? ["100.101.102.103"] : [];
            if (type === "A") return ["93.184.216.40"];
            throw dnsError("ENODATA");
        });
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: ["93.184.216.40"], v6: [], source: "public" });
        expect(query.mock.calls.every(([, , servers]) => servers !== undefined)).toBe(true);
    });

    it.each(["ENOTFOUND", "ENODATA"])("reports a name public DNS does not know (%s) as resolving to nothing, since browsers cannot resolve it either", async (code) => {
        const query = vi.fn<DnsQuery>(async (_name, _type, servers) => {
            if (servers === undefined) return ["100.101.102.103"];
            throw dnsError(code);
        });
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: [], v6: [], source: "public" });
    });

    it.each(["ETIMEOUT", "ECONNREFUSED", "ESERVFAIL", "EREFUSED"])("uses this machine's resolver when no public resolver can be reached (%s), and says so", async (code) => {
        const query = vi.fn<DnsQuery>(async (_name, type, servers) => {
            if (servers !== undefined) throw dnsError(code);
            return type === "A" ? ["93.184.216.41"] : [];
        });
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: ["93.184.216.41"], v6: [], source: "system" });
    });

    // A query that got no answer says nothing about the record. Only one that public DNS answered "no such record" does.
    it("asks this machine's resolver for a family public DNS gave no answer for, instead of calling it absent", async () => {
        const query = vi.fn<DnsQuery>(async (_name, type, servers) => {
            if (servers === undefined) return type === "A" ? ["93.184.216.41"] : [];
            if (type === "A") throw dnsError("ETIMEOUT");
            throw dnsError("ENODATA");
        });
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: ["93.184.216.41"], v6: [], source: "system" });
    });

    it("keeps the public answer for the family that got one", async () => {
        const query = vi.fn<DnsQuery>(async (_name, type, servers) => {
            if (servers === undefined) return type === "A" ? ["100.101.102.103"] : ["fd7a::1"];
            if (type === "A") return ["93.184.216.40"];
            throw dnsError("ETIMEOUT");
        });
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: ["93.184.216.40"], v6: ["fd7a::1"], source: "system" });
    });

    it("resolves to nothing, by this machine's resolver, when nothing answers at all", async () => {
        const query: DnsQuery = async () => {
            throw dnsError("ETIMEOUT");
        };
        expect(await resolveOverPublicDns(name, { query })).toEqual({ v4: [], v6: [], source: "system" });
    });
});

describe("withPinnedLookup", () => {
    const lookup = (hostname: string, options: dns.LookupOptions = {}) =>
        new Promise((resolve, reject) => dns.lookup(hostname, options, (error, address, family) => (error ? reject(error) : resolve(typeof address === "string" ? { address, family } : address))));

    it("answers lookups of that one name with the given addresses while the work runs, and not afterwards", async () => {
        const original = dns.lookup;
        await withPinnedLookup("pinned.invalid", ["93.184.216.40", "2606:4700::40"], async () => {
            expect(await lookup("pinned.invalid")).toEqual({ address: "93.184.216.40", family: 4 });
            expect(await lookup("PINNED.invalid", { family: 6 })).toEqual({ address: "2606:4700::40", family: 6 });
            expect(await lookup("pinned.invalid", { all: true })).toEqual([
                { address: "93.184.216.40", family: 4 },
                { address: "2606:4700::40", family: 6 }
            ]);
            // Every other name still goes to the real resolver.
            await expect(lookup("other.invalid")).rejects.toThrow();
        });
        expect(dns.lookup).toBe(original);
        await expect(lookup("pinned.invalid")).rejects.toThrow();
    });

    it("fails a lookup for a family the name has no address in", async () => {
        await withPinnedLookup("pinned.invalid", ["93.184.216.40"], async () => {
            await expect(lookup("pinned.invalid", { family: 6 })).rejects.toMatchObject({ code: "ENOTFOUND" });
        });
    });

    it("keeps two names pinned at once, and each until its own work is done", async () => {
        const original = dns.lookup;
        let releaseFirst!: () => void;
        const first = withPinnedLookup("a.invalid", ["93.184.216.40"], () => new Promise<void>((resolve) => (releaseFirst = resolve)));
        await withPinnedLookup("b.invalid", ["93.184.216.41"], async () => {
            expect(await lookup("a.invalid")).toMatchObject({ address: "93.184.216.40" });
            expect(await lookup("b.invalid")).toMatchObject({ address: "93.184.216.41" });
        });
        expect(await lookup("a.invalid")).toMatchObject({ address: "93.184.216.40" });
        releaseFirst();
        await first;
        expect(dns.lookup).toBe(original);
    });

    // Two announced addresses can share a name, such as a Funnel on ports 443 and 8443, and are dialed at the same time.
    // A /dns4 and a /dns6 address with the same name are dialed at the same time and must each go to their own family:
    // the WebSocket only sees the name, so the pin is all that tells them apart.
    it("gives each of several dials through one name its own addresses, one after the other", async () => {
        const original = dns.lookup;
        const order: string[] = [];
        let releaseFirst!: () => void;
        const first = withPinnedLookup("shared.invalid", ["93.184.216.40"], async () => {
            order.push("first starts");
            await new Promise<void>((resolve) => (releaseFirst = resolve));
            order.push(`first sees ${JSON.stringify(await lookup("shared.invalid", { all: true }))}`);
        });
        const second = withPinnedLookup("shared.invalid", ["2606:4700::40"], async () => {
            order.push(`second sees ${JSON.stringify(await lookup("shared.invalid", { all: true }))}`);
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(order).toEqual(["first starts"]);
        releaseFirst();
        expect(await first).toMatchObject({ lookups: 1 });
        expect(await second).toMatchObject({ lookups: 1 });
        expect(order).toEqual(["first starts", 'first sees [{"address":"93.184.216.40","family":4}]', 'second sees [{"address":"2606:4700::40","family":6}]']);
        expect(dns.lookup).toBe(original);
    });

    it("lets the next dial through a name run after one that failed", async () => {
        const failed = withPinnedLookup("shared.invalid", ["93.184.216.40"], async () => Promise.reject(new Error("dial failed")));
        const next = withPinnedLookup("shared.invalid", ["93.184.216.41"], () => lookup("shared.invalid"));
        await expect(failed).rejects.toThrow("dial failed");
        expect(await next).toMatchObject({ result: { address: "93.184.216.41" } });
    });

    it("says how many lookups it answered, so a caller can tell a connection that never asked", async () => {
        expect(await withPinnedLookup("pinned.invalid", ["93.184.216.40"], async () => "done")).toEqual({ result: "done", lookups: 0 });
        expect(await withPinnedLookup("pinned.invalid", ["93.184.216.40"], () => lookup("pinned.invalid"))).toMatchObject({ lookups: 1 });
    });

    it("removes the pin when the work fails", async () => {
        const original = dns.lookup;
        await expect(withPinnedLookup("pinned.invalid", ["93.184.216.40"], async () => Promise.reject(new Error("dial failed")))).rejects.toThrow("dial failed");
        expect(dns.lookup).toBe(original);
    });
});

describe("dialWithLibp2p through a name", () => {
    let listener: Libp2p;
    let port: number;
    // A name no resolver on this machine knows, so the dial can only succeed by going where the injected resolver says.
    const name = "only-public-dns-knows-this.invalid";

    beforeAll(async () => {
        listener = await createLibp2p({
            addresses: { listen: ["/ip4/127.0.0.1/tcp/0/ws"] },
            transports: [webSockets()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            services: { identify: identify() }
        });
        port = Number(listener.getMultiaddrs()[0]!.toString().match(/\/tcp\/(\d+)\//)![1]);
    });

    afterAll(() => listener.stop());

    const address = () => `/dns4/${name}/tcp/${port}/ws/p2p/${listener.peerId.toString()}`;

    it("dials the addresses public DNS gave, not what this machine resolves the name to", async () => {
        const resolveName = vi.fn(async () => ({ v4: ["127.0.0.1"], v6: [], source: "public" as const }));
        const result = await dialWithLibp2p(address(), { resolveName });
        expect(resolveName).toHaveBeenCalledWith(name);
        expect(result).toMatchObject({ peerId: listener.peerId.toString(), dns: { name, source: "public", ips: ["127.0.0.1"] } });
    });

    it("uses records the caller already looked up, without asking again", async () => {
        const resolveName = vi.fn(async () => ({ v4: [], v6: [], source: "public" as const }));
        const result = await dialWithLibp2p(address(), { resolveName, records: { v4: ["127.0.0.1"], v6: [], source: "system" } });
        expect(resolveName).not.toHaveBeenCalled();
        expect(result.dns).toEqual({ name, source: "system", ips: ["127.0.0.1"] });
    });

    it("fails without dialing when public DNS has no record of the right family for the name", async () => {
        const resolveName = async () => ({ v4: [], v6: ["2606:4700::40"], source: "public" as const });
        await expect(dialWithLibp2p(address(), { resolveName })).rejects.toThrow(`${name} has no A record in public DNS, so browsers cannot resolve it`);
    });

    it("does not blame public DNS when this machine's resolver was the one asked", async () => {
        const resolveName = async () => ({ v4: [], v6: [], source: "system" as const });
        await expect(dialWithLibp2p(address(), { resolveName })).rejects.toThrow(`${name} has no A record`);
        await expect(dialWithLibp2p(address(), { resolveName })).rejects.not.toThrow(/public DNS/);
    });

    // The pin works by answering dns.lookup. A WebSocket that resolved names some other way would walk past it, and
    // the handshake would then prove nothing about the public path. That must show, not pass silently.
    it("reports the machine's own resolver when the connection never asked the pin", async () => {
        const RealWebSocket = globalThis.WebSocket;
        // Stands in for a WebSocket implementation that finds the address by itself.
        globalThis.WebSocket = class extends RealWebSocket {
            constructor(url: string | URL) {
                super(String(url).replace(name, "127.0.0.1"));
            }
        } as typeof WebSocket;
        try {
            const result = await dialWithLibp2p(address(), { resolveName: async () => ({ v4: ["127.0.0.1"], v6: [], source: "public" }) });
            expect(result.dns).toEqual({ name, source: "system", ips: [] });
        } finally {
            globalThis.WebSocket = RealWebSocket;
        }
    });

    // Dials through one name take turns at the pin, so one can wait for another. That wait is not the handshake:
    // it must not use up the browsers' time limit or show in the handshake time.
    it("does not count the wait for another dial through the same name against the handshake", async () => {
        let release!: () => void;
        const holder = withPinnedLookup(name, ["127.0.0.1"], () => new Promise<void>((resolve) => (release = resolve)));
        const dialing = dialWithLibp2p(address(), { timeoutMs: 1_000, records: { v4: ["127.0.0.1"], v6: [], source: "public" } });
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        release();
        await holder;
        const result = await dialing;
        expect(result.peerId).toBe(listener.peerId.toString());
        expect(result.handshakeMs).toBeLessThan(1_000);
    });

    it("asks nothing for an address that is already an IP", async () => {
        const resolveName = vi.fn(async () => ({ v4: [], v6: [], source: "public" as const }));
        const result = await dialWithLibp2p(`/ip4/127.0.0.1/tcp/${port}/ws/p2p/${listener.peerId.toString()}`, { resolveName });
        expect(resolveName).not.toHaveBeenCalled();
        expect(result.dns).toBeUndefined();
    });
});
