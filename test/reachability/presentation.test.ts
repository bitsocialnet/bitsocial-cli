// Issue #258: `reachability status` composes the shared checks into a Diagnostics section (findings) and a
// Suggestions section (ranked actions), with the no-peers case reframed and Tailscale Funnel promoted when
// browser reachability is undetermined.
import { describe, expect, it } from "vitest";
import type { ReachabilityCheck } from "../../src/reachability/checks.js";
import { composeStatus, NO_PEERS_DIAGNOSTIC } from "../../src/reachability/presentation.js";

const compose = (checks: ReachabilityCheck[], opts: { noPeers?: boolean } = {}) => composeStatus({ checks, noPeers: opts.noPeers ?? false });

describe("composeStatus: diagnostics are findings only", () => {
    it("strips the fix off each diagnostic", () => {
        const { diagnostics } = compose([{ id: "udp-443", status: "fail", detail: "kubo has no permission to bind UDP 443", fix: "run setcap" }]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ id: "udp-443", status: "fail", detail: "kubo has no permission to bind UDP 443" });
        expect(diagnostics[0]!.fix).toBeUndefined();
    });

    it("keeps the checks' order", () => {
        const { diagnostics } = compose([
            { id: "public-address", status: "ok", detail: "a" },
            { id: "tcp-443", status: "ok", detail: "b" },
            { id: "inbound", status: "unknown", detail: "c" }
        ]);
        expect(diagnostics.map((d) => d.id)).toEqual(["public-address", "tcp-443", "inbound"]);
    });
});

describe("composeStatus: suggestions collect and rank the fixes", () => {
    it("turns each check's fix into a suggestion with the same id", () => {
        const { suggestions } = compose([
            { id: "udp-443", status: "fail", detail: "no UDP 443", fix: "run setcap" },
            { id: "public-address", status: "ok", detail: "fine" }
        ]);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]).toMatchObject({ id: "udp-443", detail: "run setcap" });
    });

    it("ranks the Tailscale Funnel (browser-address) suggestion first, since it unblocks reachability most", () => {
        const { suggestions } = compose([
            { id: "udp-443", status: "fail", detail: "no UDP 443", fix: "run setcap" },
            { id: "browser-address", status: "warn", detail: "no WSS address", fix: "Tailscale Funnel ..." }
        ]);
        expect(suggestions.map((s) => s.id)).toEqual(["browser-address", "udp-443"]);
    });
});

describe("composeStatus: no-peers reframing", () => {
    it("replaces the inbound address wall with a single normal-idle diagnostic", () => {
        const wall = "Not tested yet: /ip6/a/tcp/4001, /ip6/a/udp/4001/quic-v1, and 8 more. This does not cover WSS ...";
        const { diagnostics } = compose([{ id: "inbound", status: "unknown", detail: wall }], { noPeers: true });
        const inbound = diagnostics.find((d) => d.id === "inbound")!;
        expect(inbound.detail).toBe(NO_PEERS_DIAGNOSTIC);
        expect(inbound.detail).not.toContain("/tcp/4001");
        expect(inbound.status).toBe("unknown");
    });

    it("does not touch the inbound diagnostic when there are peers", () => {
        const wall = "Not tested yet: /ip6/a/tcp/4001. This does not cover WSS ...";
        const { diagnostics } = compose([{ id: "inbound", status: "unknown", detail: wall }], { noPeers: false });
        expect(diagnostics.find((d) => d.id === "inbound")!.detail).toBe(wall);
    });

    it("keeps a completed inbound result even when the peer count is 0 (#258)", () => {
        const reached = "AutoNAT reached: /ip6/a/udp/4001/quic-v1. This does not cover WSS ...";
        const { diagnostics } = compose([{ id: "inbound", status: "ok", detail: reached }], { noPeers: true });
        const inbound = diagnostics.find((d) => d.id === "inbound")!;
        expect(inbound).toMatchObject({ status: "ok", detail: reached });
    });

    it("does not blame bootstrap, framing it as normal for an idle node", () => {
        expect(NO_PEERS_DIAGNOSTIC).toMatch(/idle/);
        expect(NO_PEERS_DIAGNOSTIC).not.toMatch(/fail|error|bootstrap/i);
    });
});

describe("composeStatus: Funnel leads only when a browser-address check carries it", () => {
    it("ranks the browser-address Funnel fix first when a check supplies it", () => {
        const { suggestions } = compose([
            { id: "udp-443", status: "fail", detail: "no UDP 443", fix: "run setcap" },
            { id: "browser-address", status: "warn", detail: "no WSS address", fix: "Tailscale Funnel ..." }
        ]);
        expect(suggestions[0]).toMatchObject({ id: "browser-address" });
        expect(suggestions[0]!.detail).toContain("Tailscale Funnel");
    });

    it("does not invent a Funnel suggestion from the verdict when no check carries one", () => {
        // Browsers can be undetermined for reasons where Funnel is the wrong advice (daemon stopped, disabled,
        // a WSS address that could not be tested here); those carry their own fixes, not Funnel.
        const { suggestions } = compose([
            { id: "daemon", status: "warn", detail: "The daemon is not running", fix: "Run: bitsocial daemon" },
            { id: "inbound", status: "unknown", detail: "not tested" }
        ]);
        expect(suggestions.some((s) => s.id === "browser-address")).toBe(false);
        expect(suggestions[0]).toMatchObject({ id: "daemon" });
    });

    it("keeps every suggestion tied to a diagnostic of the same id", () => {
        const { diagnostics, suggestions } = compose([
            { id: "udp-443", status: "fail", detail: "no UDP 443", fix: "run setcap" },
            { id: "browser-address", status: "warn", detail: "no WSS address", fix: "Tailscale Funnel ..." }
        ]);
        const ids = new Set(diagnostics.map((d) => d.id));
        expect(suggestions.every((s) => ids.has(s.id))).toBe(true);
    });
});
