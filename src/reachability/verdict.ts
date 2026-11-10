import type { ReachabilityCheck } from "./checks.js";
import type { KuboAutonat } from "./discovery.js";
import { autonatEvidence, type UnmanagedAddress } from "./unmanaged.js";

// The answer `reachability status` opens with: can desktop nodes (kubo/helia) and browsers connect to this node?
// The checks below it say why; this says what that means, so a failing check about WSS does not read as "useless".
export interface ConnectivityLine {
    status: ReachabilityCheck["status"];
    detail: string;
}

export interface Connectivity {
    desktop: ConnectivityLine;
    browsers: ConnectivityLine;
    // Set when one line says it all, and then printed instead of the two above.
    summary?: string;
}

export interface ConnectivityInput {
    kuboRunning: boolean;
    // Whether kubo announces any public address, from the public-address-announced check.
    publicAddressAnnounced: boolean;
    // What running kubo announces, which shows whether it holds a relay reservation.
    announced: string[];
    autonat: KuboAutonat | undefined;
    // Handshakes from this machine with each WSS address kubo announces.
    wss: UnmanagedAddress[];
    // What setup did about WSS, which decides the advice. Absent when setup never ran or set up no WSS: then setup adds it.
    // "enabled": setup serves WSS, so rerunning it is the wrong advice; the requirements below say what is wrong.
    // "disabled": after `reachability disable` Caddy is off on purpose, and `wss` holds only addresses setup does not
    // manage, such as AutoTLS, which disable turns back on.
    setupWss?: "enabled" | "disabled";
}

export const NOBODY_CAN_CONNECT = "Nobody can connect: this node announces no public address, so it seeds nothing for anyone.";
export const KUBO_NOT_RUNNING = "Cannot tell who can connect: kubo is not running. Run: bitsocial daemon";

const isRelayed = (address: string) => address.includes("/p2p-circuit");

const list = (addresses: string[]) => {
    const shown = addresses.slice(0, 3).join(", ");
    return addresses.length > 3 ? `${shown} and ${addresses.length - 3} more` : shown;
};

const udpPorts = (addresses: string[]) => [...new Set(addresses.map((address) => address.match(/\/udp\/(\d+)\//)?.[1]).filter((port) => port !== undefined))].join(" and ");

function desktopLine(input: ConnectivityInput): ConnectivityLine {
    const reached = input.autonat?.reachable ?? [];
    const direct = reached.filter((address) => !isRelayed(address));
    if (direct.length > 0) return { status: "ok", detail: `can connect (AutoNAT reached ${list(direct)})` };
    const relayed = [...new Set([...reached, ...input.announced].filter(isRelayed))];
    if (relayed.length > 0) return { status: "warn", detail: `can connect only through a relay, so this node does not seed for them directly (${list(relayed)})` };
    if (input.autonat === undefined) return { status: "unknown", detail: "not known: kubo gave no AutoNAT results" };
    if (input.autonat.unknown.length > 0) return { status: "unknown", detail: `not known yet: AutoNAT has not finished testing ${list(input.autonat.unknown)}` };
    if (input.autonat.unreachable.length > 0) return { status: "fail", detail: `cannot connect (AutoNAT could not reach ${list(input.autonat.unreachable)})` };
    return { status: "unknown", detail: "not known yet: AutoNAT has not tested any address" };
}

const failedHandshakes = (failed: UnmanagedAddress[]) => `the WSS handshake with ${failed.map(({ address, error }) => `${address} (${error})`).join(", ")} failed`;

function browsersLine(input: ConnectivityInput, desktop: ConnectivityLine): ConnectivityLine {
    const evidence = autonatEvidence(input.autonat);
    const wss = input.wss;
    const ok = wss.filter(({ status }) => status === "ok");
    const unconfirmed = wss.filter(({ status }) => status === "unconfirmed");
    const failed = wss.filter(({ status }) => status === "failed");
    const failures = failed.length > 0 ? `; ${failedHandshakes(failed)}` : "";

    if (ok.length > 0)
        return {
            status: "ok",
            detail: `should be able to connect over WSS (a handshake from this machine succeeded through ${list(ok.map(({ address }) => address))}; whether a firewall lets other networks in was not tested)${failures}`
        };

    const SEE_REQUIREMENTS = "the WSS that setup configured is not working, see the requirements below";
    // How to get WSS: turn it back on, fix what setup configured, or add it.
    const getWss =
        input.setupWss === "disabled" ? "WSS is off because reachability is disabled. Run: bitsocial reachability enable" : input.setupWss === "enabled" ? SEE_REQUIREMENTS : "run setup to add WSS";
    if (evidence.webTransportReached.length > 0) {
        const webTransport = "those that support WebTransport should be able to connect, unless their network blocks UDP";
        const reachedOn = ` (AutoNAT reached kubo over UDP ${udpPorts(evidence.webTransportReached)})`;
        if (unconfirmed.length > 0)
            return { status: "warn", detail: `${webTransport}; whether WSS through ${list(unconfirmed.map(({ address }) => address))} works could not be tested from this machine${failures}${reachedOn}` };
        const why = failed.length > 0 ? `${failedHandshakes(failed)}${input.setupWss === "enabled" ? `; ${SEE_REQUIREMENTS}` : ""}` : getWss;
        return { status: "warn", detail: `${webTransport}; ${why}${reachedOn}` };
    }
    if (unconfirmed.length > 0)
        return {
            status: "unknown",
            detail: `may be able to connect over WSS through ${list(unconfirmed.map(({ address }) => address))}; this machine could not test it from inside its own network${failures}`
        };
    // Not knowing yet comes first, even on a disabled node, whose kubo may still serve WebTransport.
    const disabledNote = input.setupWss === "disabled" ? "; setup's WSS is off because reachability is disabled" : "";
    if (input.autonat === undefined) return { status: "unknown", detail: `not known: kubo gave no AutoNAT results, so WebTransport is untested${failures}${disabledNote}` };
    if (evidence.webTransportUntested.length > 0 || desktop.status === "unknown")
        return { status: "unknown", detail: `not known yet: AutoNAT has not tested WebTransport yet${failures}${disabledNote}` };
    if (input.setupWss === "disabled")
        return { status: desktop.status === "fail" ? "fail" : "warn", detail: `cannot connect directly: reachability is disabled${failures}. Run: bitsocial reachability enable` };
    const fix = input.setupWss === "enabled" ? `${failures}; ${SEE_REQUIREMENTS}` : failed.length > 0 ? failures : "; run: bitsocial reachability setup";
    return { status: desktop.status === "ok" || desktop.status === "warn" ? "warn" : "fail", detail: `cannot connect directly${fix}` };
}

export function connectivityVerdict(input: ConnectivityInput): Connectivity {
    if (!input.kuboRunning) {
        const unknown = { status: "unknown" as const, detail: "not known: kubo is not running" };
        return { desktop: unknown, browsers: unknown, summary: KUBO_NOT_RUNNING };
    }
    // AutoNAT is the network's own answer, so it outranks what this node's announcements suggest.
    const reachedAnything = (input.autonat?.reachable.length ?? 0) > 0;
    if (!input.publicAddressAnnounced && !reachedAnything) {
        const nobody = { status: "fail" as const, detail: "cannot connect: this node announces no public address" };
        return { desktop: nobody, browsers: nobody, summary: NOBODY_CAN_CONNECT };
    }
    const desktop = desktopLine(input);
    return { desktop, browsers: browsersLine(input, desktop) };
}

export function formatConnectivity(connectivity: Connectivity): string[] {
    if (connectivity.summary) return [connectivity.summary];
    return [`Desktop nodes (kubo/helia): ${connectivity.desktop.detail}`, `Browsers: ${connectivity.browsers.detail}`];
}
