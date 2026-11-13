// Issue #239: the verdict `reachability status` opens with, saying plainly whether desktop nodes and browsers can connect.
import { describe, expect, it } from "vitest";
import type { KuboAutonat } from "../../src/reachability/discovery.js";
import type { UnmanagedAddress } from "../../src/reachability/unmanaged.js";
import { connectivityVerdict, formatConnectivity, type ConnectivityInput } from "../../src/reachability/verdict.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";
const quic = "/ip4/93.184.216.34/udp/4001/quic-v1";
const tcp = "/ip4/93.184.216.34/tcp/4001";
const webTransport = `${quic}/webtransport/certhash/uEiA`;
const relayed = `/ip4/198.51.100.9/tcp/4001/p2p/${peerId}/p2p-circuit`;
const wss = "/ip4/93.184.216.34/tcp/443/tls/ws";

const autonat = (part: Partial<KuboAutonat>): KuboAutonat => ({ reachable: [], unreachable: [], unknown: [], ...part });
const verdict = (input: Partial<ConnectivityInput>) =>
    connectivityVerdict({ kuboRunning: true, publicAddressAnnounced: true, announced: [tcp, quic], autonat: autonat({}), wss: [], ...input });
const handshake = (status: UnmanagedAddress["status"]): UnmanagedAddress[] => [{ address: wss, status, ...(status === "ok" ? {} : { error: "connection refused" }) }];

describe("connectivityVerdict: desktop nodes", () => {
    it("can connect when AutoNAT reached an address that is not a relay, and names it", () => {
        const { desktop } = verdict({ autonat: autonat({ reachable: [tcp] }) });
        expect(desktop.status).toBe("ok");
        expect(desktop.detail).toMatch(/^can connect/);
        expect(desktop.detail).toContain(tcp);
    });

    it("warns when they can connect only through a relay", () => {
        const { desktop } = verdict({ announced: [relayed], autonat: autonat({ unreachable: [tcp] }) });
        expect(desktop.status).toBe("warn");
        expect(desktop.detail).toMatch(/only through a relay/);
    });

    it("counts a relayed address AutoNAT reached as relay-only, not direct", () => {
        expect(verdict({ autonat: autonat({ reachable: [relayed] }) }).desktop.status).toBe("warn");
    });

    it("is not known yet while AutoNAT is still testing", () => {
        const { desktop } = verdict({ autonat: autonat({ unknown: [tcp, quic] }) });
        expect(desktop.status).toBe("unknown");
        expect(desktop.detail).toMatch(/not known yet/);
    });

    it("is not known when kubo gave no AutoNAT results", () => {
        expect(verdict({ autonat: undefined }).desktop.status).toBe("unknown");
    });

    it("blames having no peers, not an unfinished test, when kubo has none (#258)", () => {
        const { desktop } = verdict({ autonat: autonat({ unknown: [tcp, quic] }), peerCount: 0 });
        expect(desktop.status).toBe("unknown");
        expect(desktop.detail).toMatch(/no peers/);
        expect(desktop.detail).toMatch(/idle/);
        expect(desktop.detail).not.toContain(tcp);
    });

    it("keeps the unfinished-test wording while kubo has peers (#258)", () => {
        const { desktop } = verdict({ autonat: autonat({ unknown: [tcp, quic] }), peerCount: 3 });
        expect(desktop.detail).toMatch(/AutoNAT has not finished testing/);
        expect(desktop.detail).not.toMatch(/no peers/);
    });

    it("keeps a completed AutoNAT failure even if the peer count just dropped to 0 (#258)", () => {
        const { desktop } = verdict({ autonat: autonat({ unreachable: [tcp, quic] }), peerCount: 0 });
        expect(desktop.status).toBe("fail");
        expect(desktop.detail).toMatch(/cannot connect/);
        expect(desktop.detail).not.toMatch(/no peers/);
    });

    it("fails when AutoNAT could reach none of the public addresses", () => {
        const { desktop } = verdict({ autonat: autonat({ unreachable: [tcp, quic] }) });
        expect(desktop.status).toBe("fail");
        expect(desktop.detail).toMatch(/cannot connect/);
    });
});

describe("connectivityVerdict: browsers", () => {
    it("should be able to connect over WSS after a handshake from this machine, without claiming the firewall was tested", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }), wss: handshake("ok") });
        expect(browsers.status).toBe("ok");
        expect(browsers.detail).toMatch(/should be able to connect over WSS/);
        expect(browsers.detail).toMatch(/handshake from this machine succeeded/);
        expect(browsers.detail).toMatch(/firewall/);
    });

    it("may be able to connect over WSS when this machine could not test it", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }), wss: handshake("unconfirmed") });
        expect(browsers.status).toBe("unknown");
        expect(browsers.detail).toMatch(/may be able to connect over WSS/);
    });

    it("uses the WebTransport wording when the WSS test was inconclusive but AutoNAT reached WebTransport", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [quic, webTransport] }), wss: handshake("unconfirmed") });
        expect(browsers.status).toBe("warn");
        expect(browsers.detail).toMatch(/support WebTransport should be able to connect, unless their network blocks UDP/);
    });

    it("warns with WebTransport only, and says to add WSS", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [quic, webTransport] }) });
        expect(browsers.status).toBe("warn");
        expect(browsers.detail).toMatch(/^those that support WebTransport should be able to connect, unless their network blocks UDP; run setup to add WSS/);
        expect(browsers.detail).not.toMatch(/Chrome|Firefox|Safari/);
    });

    it("names a failed WSS handshake next to the WebTransport wording", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [quic, webTransport] }), wss: handshake("failed") });
        expect(browsers.status).toBe("warn");
        expect(browsers.detail).toContain(wss);
    });

    it("warns that browsers cannot connect directly when desktop nodes can", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }) });
        expect(browsers).toMatchObject({ status: "warn", detail: expect.stringMatching(/^cannot connect directly/) });
    });

    it("fails when neither desktop nodes nor browsers can connect", () => {
        const { browsers } = verdict({ autonat: autonat({ unreachable: [tcp, quic] }), wss: handshake("failed") });
        expect(browsers.status).toBe("fail");
        expect(browsers.detail).toMatch(/^cannot connect directly/);
    });

    it("is not known yet while AutoNAT has not tested WebTransport and no WSS handshake succeeded", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp], unknown: [webTransport] }) });
        expect(browsers.status).toBe("unknown");
        expect(browsers.detail).toMatch(/not known yet/);
    });

    it("blames having no peers for not knowing about WebTransport when kubo has none (#258)", () => {
        const { browsers } = verdict({ autonat: autonat({ unknown: [webTransport] }), peerCount: 0 });
        expect(browsers.status).toBe("unknown");
        expect(browsers.detail).toMatch(/no peers/);
        expect(browsers.detail).toMatch(/idle/);
    });

    it("says WSS is off on a disabled node, and how to turn it back on", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }), setupWss: "disabled" });
        expect(browsers.status).toBe("warn");
        expect(browsers.detail).toMatch(/reachability is disabled/);
        expect(browsers.detail).toContain("bitsocial reachability enable");
    });

    // Review on #243: disable restores AutoTLS, so a disabled node can still serve WSS that setup does not manage.
    it("uses a WSS handshake that worked on a disabled node, rather than saying WSS is off", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }), wss: handshake("ok"), setupWss: "disabled" });
        expect(browsers.status).toBe("ok");
        expect(browsers.detail).not.toMatch(/reachability is disabled/);
    });

    it("says a WSS address on a disabled node may work when it could not be tested", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }), wss: handshake("unconfirmed"), setupWss: "disabled" });
        expect(browsers.status).toBe("unknown");
        expect(browsers.detail).toMatch(/may be able to connect over WSS/);
    });

    // Review on #243: "disabled" must not outrank not knowing yet, nor hide a failed handshake.
    it("is not known yet on a disabled node while AutoNAT has not tested WebTransport", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp], unknown: [webTransport] }), setupWss: "disabled" });
        expect(browsers.status).toBe("unknown");
        expect(browsers.detail).toMatch(/not known yet/);
    });

    it("names a failed WSS handshake on a disabled node", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [tcp] }), wss: handshake("failed"), setupWss: "disabled" });
        expect(browsers.detail).toMatch(/reachability is disabled/);
        expect(browsers.detail).toContain(wss);
    });

    // Review on #243: setup already ran, so running it again is the wrong advice; the requirements below say what is wrong.
    it("does not tell a node whose setup WSS is not working to run setup", () => {
        const nothing = verdict({ autonat: autonat({ reachable: [tcp] }), setupWss: "enabled" }).browsers;
        expect(nothing.detail).not.toMatch(/run:? (bitsocial reachability )?setup/);
        expect(nothing.detail).toMatch(/see the requirements below/);
        const webTransportOnly = verdict({ autonat: autonat({ reachable: [quic, webTransport] }), setupWss: "enabled" }).browsers;
        expect(webTransportOnly.detail).not.toMatch(/run setup/);
        expect(webTransportOnly.detail).toMatch(/see the requirements below/);
    });

    it("still counts WebTransport on a disabled node", () => {
        const { browsers } = verdict({ autonat: autonat({ reachable: [quic, webTransport] }), setupWss: "disabled" });
        expect(browsers.status).toBe("warn");
        expect(browsers.detail).toMatch(/support WebTransport should be able to connect/);
        expect(browsers.detail).toContain("bitsocial reachability enable");
    });
});

describe("connectivityVerdict: nobody, and kubo down", () => {
    it("says nobody can connect when no public address is announced and AutoNAT reached nothing (#231)", () => {
        const result = verdict({ publicAddressAnnounced: false, announced: ["/ip4/10.0.2.15/tcp/4001"], autonat: autonat({ unknown: ["/ip4/10.0.2.15/tcp/4001"] }) });
        expect(result.summary).toBe("Nobody can connect: this node announces no public address, so it seeds nothing for anyone.");
        expect(result.desktop.status).toBe("fail");
        expect(result.browsers.status).toBe("fail");
    });

    it("lets AutoNAT win over the announcement check", () => {
        const result = verdict({ publicAddressAnnounced: false, autonat: autonat({ reachable: [tcp] }) });
        expect(result.summary).toBeUndefined();
        expect(result.desktop.status).toBe("ok");
    });

    it("cannot tell anything while kubo is not running", () => {
        const result = verdict({ kuboRunning: false, publicAddressAnnounced: false, autonat: undefined });
        expect(result.summary).toBe("Cannot tell who can connect: kubo is not running. Run: bitsocial daemon");
        expect(result.desktop.status).toBe("unknown");
        expect(result.browsers.status).toBe("unknown");
    });
});

describe("formatConnectivity", () => {
    it("prints a line for desktop nodes and one for browsers", () => {
        const lines = formatConnectivity(verdict({ autonat: autonat({ reachable: [quic, webTransport] }) }));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/^Desktop nodes \(kubo\/helia\): can connect/);
        expect(lines[1]).toMatch(/^Browsers: /);
    });

    it("prints the single summary line instead when there is one", () => {
        const lines = formatConnectivity(verdict({ publicAddressAnnounced: false, autonat: autonat({}) }));
        expect(lines).toEqual(["Nobody can connect: this node announces no public address, so it seeds nothing for anyone."]);
    });
});
