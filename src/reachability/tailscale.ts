import { execFile } from "child_process";
import type { ReachabilityCheck } from "./checks.js";
import { TAILSCALE_FUNNEL_DOC } from "./guidance.js";

// Funnel traffic goes browser -> one of Tailscale's public ingress servers -> this node, and the second hop runs
// over the tailnet. `tailscale ping` measures that hop. Everything here is best effort: bitsocial-cli does not run
// Tailscale, and the JSON fields and the ingress servers' labels are Tailscale's own and not a documented interface,
// so anything unexpected ends in a skipped report with a note, never in an error.

// Rejects when the command cannot be started (code "ENOENT") or exits non-zero, with whatever it printed on the error.
export type RunCommand = (file: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal }) => Promise<{ stdout: string }>;

export interface FunnelIngressHop {
    // The ingress server's address inside the tailnet.
    address: string;
    // The DERP region Tailscale lists for it, e.g. "par".
    relay?: string;
    // The median of the pongs.
    latencyMs?: number;
    // How the pong travelled: "DERP(par)" when relayed, an ip:port when direct.
    via?: string;
    error?: string;
}

export interface FunnelIngressReport {
    status: "ok" | "warn" | "skipped";
    // Why it was skipped.
    note?: string;
    hops: FunnelIngressHop[];
}

// A healthy hop is relayed through DERP too, at about 90 ms, and the one degraded node seen took about 1.9 s. With
// only those two measurements, the line sits well clear of both. Being relayed is deliberately not a warning.
export const SLOW_INGRESS_MS = 500;
// Only an ingress server that carried this node's traffic lately answers a ping; an idle one times out in every mode.
const RECENT_HANDSHAKE_MS = 5 * 60_000;
const MAX_HOPS = 3;
const PINGS_PER_HOP = 3;
const MACOS_APP_BINARY = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export const isFunnelAddress = (address: string) => /^\/dns[46]?\/[^/]+\.ts\.net\//i.test(address);

const runTailscale: RunCommand = (file, args, { timeoutMs, signal }) =>
    new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true, ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
            if (error) reject(Object.assign(error, { stdout, stderr }));
            else resolve({ stdout });
        });
    });

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function activeFunnelIngressPeers(status: unknown, now: number): { address: string; relay?: string }[] {
    if (!isRecord(status) || !isRecord(status["Peer"])) return [];
    const active: { address: string; relay?: string; handshakeAt: number }[] = [];
    for (const peer of Object.values(status["Peer"])) {
        if (!isRecord(peer) || peer["HostName"] !== "funnel-ingress-node" || peer["InEngine"] !== true) continue;
        if (!Array.isArray(peer["Tags"]) || !peer["Tags"].includes("tag:ingress")) continue;
        const address = Array.isArray(peer["TailscaleIPs"]) ? peer["TailscaleIPs"].find((ip) => typeof ip === "string") : undefined;
        const handshakeAt = typeof peer["LastHandshake"] === "string" ? Date.parse(peer["LastHandshake"]) : NaN;
        if (address === undefined || Number.isNaN(handshakeAt) || now - handshakeAt > RECENT_HANDSHAKE_MS) continue;
        active.push({ address, handshakeAt, ...(typeof peer["Relay"] === "string" && peer["Relay"] ? { relay: peer["Relay"] } : {}) });
    }
    return active.sort((a, b) => b.handshakeAt - a.handshakeAt).map(({ handshakeAt, ...peer }) => (void handshakeAt, peer));
}

const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, "µs": 0.001, "μs": 0.001, us: 0.001, ns: 0.000001 };

// A Go duration, as in "91ms", "1.912s" or "1m2.5s".
const goDurationMs = (text: string): number | undefined => {
    const parts = [...text.matchAll(/([\d.]+)(h|ms|µs|μs|us|ns|m|s)/g)];
    if (parts.length === 0 || parts.map(([part]) => part).join("") !== text) return undefined;
    return Number(parts.reduce((total, [, value, unit]) => total + Number(value) * UNIT_MS[unit!]!, 0).toFixed(3));
};

export function parseTailscalePing(output: string): { latencyMs: number; via: string }[] {
    const pongs: { latencyMs: number; via: string }[] = [];
    for (const [, via, duration] of output.matchAll(/^pong from .* via (\S+) in (\S+)\s*$/gm)) {
        const latencyMs = goDurationMs(duration!);
        if (latencyMs !== undefined) pongs.push({ latencyMs, via: via! });
    }
    return pongs;
}

const skipped = (note: string): FunnelIngressReport => ({ status: "skipped", note, hops: [] });

const BACKEND_NOTES: Record<string, string> = {
    NeedsLogin: "Tailscale is logged out",
    NeedsMachineAuth: "this machine is waiting to be approved in the tailnet",
    Stopped: "Tailscale is stopped",
    Starting: "Tailscale is still starting"
};

export async function pingFunnelIngress(input: { run?: RunCommand; now?: () => number; platform?: string; signal?: AbortSignal } = {}): Promise<FunnelIngressReport> {
    const { run = runTailscale, now = Date.now, platform = process.platform, signal } = input;
    const options = (timeoutMs: number) => ({ timeoutMs, ...(signal ? { signal } : {}) });
    // The macOS app only puts `tailscale` on the PATH when asked to, and its own binary takes the same arguments.
    const commands = platform === "darwin" ? ["tailscale", MACOS_APP_BINARY] : ["tailscale"];
    let command: string | undefined;
    let stdout: string | undefined;
    for (const candidate of commands) {
        try {
            ({ stdout } = await run(candidate, ["status", "--json"], options(10_000)));
            command = candidate;
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            return skipped("Tailscale is not running, or its status could not be read");
        }
    }
    if (command === undefined || stdout === undefined) return skipped("the tailscale command was not found on this machine");

    let status: unknown;
    try {
        status = JSON.parse(stdout);
    } catch {
        return skipped("the output of `tailscale status --json` could not be read");
    }
    const backendState = isRecord(status) ? status["BackendState"] : undefined;
    if (typeof backendState === "string" && backendState !== "Running") return skipped(BACKEND_NOTES[backendState] ?? "Tailscale is not running");

    const peers = activeFunnelIngressPeers(status, now()).slice(0, MAX_HOPS);
    if (peers.length === 0) return skipped("no Funnel ingress server has carried this node's traffic in the last 5 minutes");

    const hops = await Promise.all(
        peers.map(async (peer): Promise<FunnelIngressHop> => {
            // Without --until-direct=false tailscale keeps pinging for a direct path and exits non-zero when it finds
            // none, which is the normal case for an ingress server.
            const args = ["ping", "--c", String(PINGS_PER_HOP), "--until-direct=false", "--timeout", "5s", peer.address];
            // Pongs can arrive before a non-zero exit, so what was printed counts either way.
            const output = await run(command, args, options(30_000)).then(
                ({ stdout: printed }) => printed,
                (error) => (typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "")
            );
            const pongs = parseTailscalePing(output).sort((a, b) => a.latencyMs - b.latencyMs);
            const median = pongs[Math.floor(pongs.length / 2)];
            return median ? { ...peer, latencyMs: median.latencyMs, via: median.via } : { ...peer, error: "no reply" };
        })
    );
    const slow = hops.some((hop) => hop.latencyMs === undefined || hop.latencyMs >= SLOW_INGRESS_MS);
    return { status: slow ? "warn" : "ok", hops };
}

const formatHop = (hop: FunnelIngressHop) =>
    hop.latencyMs === undefined ? `${hop.address} did not answer` : `${Math.round(hop.latencyMs)} ms via ${hop.via}`;

export function funnelIngressCheck(report: FunnelIngressReport): ReachabilityCheck {
    const id = "funnel-ingress";
    if (report.status === "skipped") return { id, status: "unknown", detail: `The hop from Tailscale's Funnel ingress to this node was not measured: ${report.note}` };
    const hops = report.hops.map(formatHop).join(", ");
    if (report.status === "ok") return { id, status: "ok", detail: `Tailscale's Funnel ingress reaches this node in ${hops}` };
    return {
        id,
        status: "warn",
        detail: `The hop from Tailscale's Funnel ingress to this node is slow: ${hops}. A healthy one answers in about 90 ms, relayed or not, and browsers give up on an address after 6 s`,
        fix: `The Funnel path to this node is degraded, which this node cannot repair. Compare with the WSS handshake time above, and see "A Funnel path can degrade" in ${TAILSCALE_FUNNEL_DOC}`
    };
}
