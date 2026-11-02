import { describe, expect, it } from "vitest";
import {
    computeKuboConfig,
    LOOPBACK_ADDR_FILTER,
    localWsSwarmAddress,
    planKuboConfig,
    WEBTRANSPORT_SWARM_ADDRESSES,
    type ReachabilityKuboInput
} from "../../src/reachability/kubo-config.js";

const DEFAULT_SWARM = [
    "/ip4/0.0.0.0/tcp/4001",
    "/ip6/::/tcp/4001",
    "/ip4/0.0.0.0/udp/4001/webrtc-direct",
    "/ip4/0.0.0.0/udp/4001/quic-v1",
    "/ip4/0.0.0.0/udp/4001/quic-v1/webtransport",
    "/ip6/::/udp/4001/webrtc-direct",
    "/ip6/::/udp/4001/quic-v1",
    "/ip6/::/udp/4001/quic-v1/webtransport"
];
const SERVER_ADDR_FILTERS = ["/ip4/10.0.0.0/ipcidr/8", "/ip4/100.64.0.0/ipcidr/10", LOOPBACK_ADDR_FILTER, "/ip4/169.254.0.0/ipcidr/16"];
const ANNOUNCE_V4 = "/ip4/203.0.113.7/tcp/443/tls/ws";
const ANNOUNCE_V6 = "/ip6/2001:db8::7/tcp/443/tls/ws";
const reachability = (overrides: Partial<ReachabilityKuboInput> = {}): ReachabilityKuboInput => ({
    wsPort: 4002,
    announce: [ANNOUNCE_V4, ANNOUNCE_V6],
    ...overrides
});
const serverProfileConfig = () => ({
    Identity: { PeerID: "peer" },
    Addresses: { API: "/ip4/127.0.0.1/tcp/50019", Swarm: [...DEFAULT_SWARM], Announce: [], AppendAnnounce: [], NoAnnounce: [] },
    Swarm: { AddrFilters: [...SERVER_ADDR_FILTERS], DisableNatPortMap: true },
    AutoTLS: { Enabled: true }
});

// One enable, then one disable, as the commands would run them: each persists the returned record.
const enable = (kubo: any, input: ReachabilityKuboInput) => {
    const { kuboConfig, kuboEdits } = planKuboConfig(kubo, input, true);
    return { kubo: kuboConfig, input: { ...input, kuboEdits } };
};
const disable = (kubo: any, input: ReachabilityKuboInput) => {
    const { kuboConfig, kuboEdits } = planKuboConfig(kubo, input, false);
    return { kubo: kuboConfig, input: { ...input, kuboEdits } };
};
const bytes = (value: unknown) => JSON.stringify(value, null, 4);

describe("computeKuboConfig when enabled", () => {
    it("adds the local ws and WebTransport listeners next to the existing ones", () => {
        const result = computeKuboConfig(serverProfileConfig(), reachability(), true);
        expect(result.Addresses.Swarm).toEqual([...DEFAULT_SWARM, localWsSwarmAddress(4002), ...WEBTRANSPORT_SWARM_ADDRESSES]);
    });

    it("announces every address that succeeded", () => {
        expect(computeKuboConfig(serverProfileConfig(), reachability(), true).Addresses.AppendAnnounce).toEqual([ANNOUNCE_V4, ANNOUNCE_V6]);
    });

    it("removes only the loopback AddrFilter", () => {
        const result = computeKuboConfig(serverProfileConfig(), reachability(), true);
        expect(result.Swarm.AddrFilters).toEqual(SERVER_ADDR_FILTERS.filter((entry) => entry !== LOOPBACK_ADDR_FILTER));
    });

    it("turns AutoTLS off and leaves every other key alone", () => {
        const result = computeKuboConfig(serverProfileConfig(), reachability(), true);
        expect(result.AutoTLS.Enabled).toBe(false);
        expect(result.Identity).toEqual({ PeerID: "peer" });
        expect(result.Swarm.DisableNatPortMap).toBe(true);
        expect(result.Addresses.API).toBe("/ip4/127.0.0.1/tcp/50019");
    });

    it("does not mutate its input", () => {
        const input = serverProfileConfig();
        const before = bytes(input);
        computeKuboConfig(input, reachability(), true);
        expect(bytes(input)).toBe(before);
    });

    it("is idempotent", () => {
        const first = enable(serverProfileConfig(), reachability());
        const second = enable(first.kubo, first.input);
        expect(bytes(second.kubo)).toBe(bytes(first.kubo));
        expect(second.input.kuboEdits).toEqual(first.input.kuboEdits);
    });

    it("replaces the old address after an IP change", () => {
        const first = enable(serverProfileConfig(), reachability());
        const moved = "/ip4/203.0.113.99/tcp/443/tls/ws";
        const second = enable(first.kubo, { ...first.input, announce: [moved] });
        expect(second.kubo.Addresses.AppendAnnounce).toEqual([moved]);
    });

    it("replaces the old listener when the ws port moves", () => {
        const first = enable(serverProfileConfig(), reachability());
        const second = enable(first.kubo, { ...first.input, wsPort: 4003 });
        expect(second.kubo.Addresses.Swarm).toContain(localWsSwarmAddress(4003));
        expect(second.kubo.Addresses.Swarm).not.toContain(localWsSwarmAddress(4002));
    });

    it("removes a loopback filter the operator put back, since it would block the terminator", () => {
        const first = enable(serverProfileConfig(), reachability());
        first.kubo.Swarm.AddrFilters.push(LOOPBACK_ADDR_FILTER);
        expect(enable(first.kubo, first.input).kubo.Swarm.AddrFilters).not.toContain(LOOPBACK_ADDR_FILTER);
    });

    it("keeps AutoTLS on after a repair if the operator flipped it back", () => {
        const first = enable(serverProfileConfig(), reachability());
        first.kubo.AutoTLS.Enabled = true;
        expect(enable(first.kubo, first.input).kubo.AutoTLS.Enabled).toBe(true);
    });
});

describe("computeKuboConfig when disabled", () => {
    it("changes nothing if reachability was never applied", () => {
        const input = serverProfileConfig();
        expect(bytes(computeKuboConfig(input, reachability(), false))).toBe(bytes(input));
    });

    it("keeps an identical entry the operator had before we enabled", () => {
        const original = serverProfileConfig();
        original.Addresses.Swarm.push(WEBTRANSPORT_SWARM_ADDRESSES[0]);
        (original.Addresses.AppendAnnounce as string[]).push(ANNOUNCE_V4);
        const enabled = enable(original, reachability());
        expect(bytes(disable(enabled.kubo, enabled.input).kubo)).toBe(bytes(original));
    });

    it("keeps what the operator added while enabled", () => {
        const enabled = enable(serverProfileConfig(), reachability());
        enabled.kubo.Addresses.Swarm.push("/ip4/0.0.0.0/tcp/9999");
        enabled.kubo.Addresses.AppendAnnounce.push("/dns4/operator.example/tcp/443/tls/ws");
        enabled.kubo.Swarm.AddrFilters.push("/ip4/192.0.2.0/ipcidr/24");
        const { kubo } = disable(enabled.kubo, enabled.input);
        expect(kubo.Addresses.Swarm).toEqual([...DEFAULT_SWARM, "/ip4/0.0.0.0/tcp/9999"]);
        expect(kubo.Addresses.AppendAnnounce).toEqual(["/dns4/operator.example/tcp/443/tls/ws"]);
        expect(kubo.Swarm.AddrFilters).toEqual([...SERVER_ADDR_FILTERS, "/ip4/192.0.2.0/ipcidr/24"]);
    });

    it("does not override an operator's AutoTLS flip", () => {
        const original = serverProfileConfig();
        original.AutoTLS.Enabled = false;
        const enabled = enable(original, reachability());
        enabled.kubo.AutoTLS.Enabled = true;
        expect(disable(enabled.kubo, enabled.input).kubo.AutoTLS.Enabled).toBe(true);
    });

    it("clears the edit record", () => {
        const enabled = enable(serverProfileConfig(), reachability());
        expect(disable(enabled.kubo, enabled.input).input.kuboEdits).toBeUndefined();
    });
});

describe("disable/enable byte-for-byte round trip", () => {
    const fixtures: [string, () => any][] = [
        ["server profile", serverProfileConfig],
        ["empty config", () => ({})],
        ["no AutoTLS section", () => ({ Addresses: { Swarm: [...DEFAULT_SWARM] }, Swarm: { AddrFilters: null } })],
        ["AutoTLS section without Enabled", () => ({ AutoTLS: {}, Addresses: { Swarm: [] } })],
        ["AutoTLS explicitly off", () => ({ AutoTLS: { Enabled: false, ShortAddrs: true } })],
        ["null lists", () => ({ Addresses: { Swarm: null, AppendAnnounce: null }, Swarm: { AddrFilters: null } })],
        ["loopback filter first", () => ({ Swarm: { AddrFilters: [LOOPBACK_ADDR_FILTER, "/ip4/10.0.0.0/ipcidr/8"] } })],
        ["loopback filter last", () => ({ Swarm: { AddrFilters: ["/ip4/10.0.0.0/ipcidr/8", LOOPBACK_ADDR_FILTER] } })],
        ["loopback filter twice", () => ({ Swarm: { AddrFilters: [LOOPBACK_ADDR_FILTER, "/ip4/10.0.0.0/ipcidr/8", LOOPBACK_ADDR_FILTER] } })],
        ["only the loopback filter", () => ({ Swarm: { AddrFilters: [LOOPBACK_ADDR_FILTER] } })],
        ["no loopback filter", () => ({ Swarm: { AddrFilters: ["/ip4/10.0.0.0/ipcidr/8"] } })],
        ["operator already listens on udp/443", () => ({ Addresses: { Swarm: [...WEBTRANSPORT_SWARM_ADDRESSES, "/ip4/0.0.0.0/tcp/4001"] } })],
        ["operator already announces our address", () => ({ Addresses: { AppendAnnounce: [ANNOUNCE_V6, "/ip4/192.0.2.1/tcp/1"] } })],
        ["unusual key order", () => ({ AutoTLS: { Enabled: true }, Swarm: {}, Identity: {}, Addresses: { AppendAnnounce: [], API: "x", Swarm: [] } })]
    ];

    it.each(fixtures)("%s: disable(enable(x)) is x", (_name, fixture) => {
        const original = fixture();
        const enabled = enable(original, reachability());
        expect(bytes(disable(enabled.kubo, enabled.input).kubo)).toBe(bytes(original));
    });

    it.each(fixtures)("%s: enable(disable(enable(x))) is enable(x)", (_name, fixture) => {
        const enabled = enable(fixture(), reachability());
        const disabled = disable(enabled.kubo, enabled.input);
        const reenabled = enable(disabled.kubo, disabled.input);
        expect(bytes(reenabled.kubo)).toBe(bytes(enabled.kubo));
        expect(reenabled.input.kuboEdits).toEqual(enabled.input.kuboEdits);
    });

    it.each(fixtures)("%s: survives an IP change and a port move before disable", (_name, fixture) => {
        const original = fixture();
        const first = enable(original, reachability());
        const moved = enable(first.kubo, { ...first.input, announce: ["/ip4/203.0.113.99/tcp/443/tls/ws"], wsPort: 4003 });
        expect(bytes(disable(moved.kubo, moved.input).kubo)).toBe(bytes(original));
    });

    it.each(fixtures)("%s: stays exact when the record goes through config.json", (_name, fixture) => {
        const original = fixture();
        const enabled = enable(original, reachability());
        const reloaded = JSON.parse(JSON.stringify(enabled.input));
        expect(bytes(disable(JSON.parse(bytes(enabled.kubo)), reloaded).kubo)).toBe(bytes(original));
    });
});
