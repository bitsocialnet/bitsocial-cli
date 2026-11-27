import type { ReachabilityCheck } from "./checks.js";
import { isPublicIp, localIpsFromInterfaces, type KuboAutonat } from "./discovery.js";
import { TAILSCALE_FUNNEL_DOC } from "./guidance.js";
import { BROWSER_DIAL_TIMEOUT_MS, dialWithLibp2p, formatSeconds, HandshakeTimeoutError, SLOW_HANDSHAKE_MS } from "./libp2p-dial.js";
import { dnsUnansweredMessage, familiesOf, resolveOverPublicDns, type PublicRecords } from "./public-dns.js";
import type { ResolvedDomain } from "./setup.js";
import type { PeriodicWssCheck, WssAddressCheck } from "./state.js";
import { formatFunnelIngress, isFunnelAddress, pingFunnelIngress, type FunnelIngressReport, type RunCommand } from "./tailscale.js";

// Browser addresses kubo announces that `setup` did not put there: AutoTLS, or a reverse proxy set up by hand.
export interface UnmanagedAddress {
    address: string;
    status: "ok" | "failed" | "unconfirmed" | "unverified";
    error?: string;
    // How long a handshake that worked took.
    handshakeMs?: number;
    // It worked, but took so much of the time a browser allows that some browsers will not make it.
    slow?: true;
    // It did not finish in the time a browser allows.
    timedOut?: true;
    // No public DNS resolver could be reached, so the name was resolved by this machine's own, which may not lead where it leads browsers.
    systemDns?: true;
}

export type DialAddress = (
    address: string,
    options: { signal?: AbortSignal; timeoutMs?: number; records?: PublicRecords }
) => Promise<{ peerId: string; handshakeMs?: number; dns?: { source: PublicRecords["source"] } }>;

export { SLOW_HANDSHAKE_MS };
const BROWSER_DIALABLE = /\/(tls\/ws|wss|tls\/sni\/[^/]+\/ws)$/;

const withoutPeerId = (address: string) => address.replace(/\/p2p\/[^/]+$/, "");

export function isBrowserAddress(address: string, treatAsPublic: string[] = []): boolean {
    const bare = withoutPeerId(address);
    // A relay's address describes the relay, and a * is a listener's pattern that nothing can dial.
    if (address.includes("/p2p-circuit") || bare.includes("*") || !BROWSER_DIALABLE.test(bare)) return false;
    const ip = bare.match(/^\/ip[46]\/([^/]+)\//)?.[1];
    return ip === undefined || isPublicIp(ip) || treatAsPublic.includes(ip);
}

const uniqueBrowserAddresses = (addresses: string[], treatAsPublic: string[]) => {
    const byAddress = new Map<string, string>();
    for (const address of addresses) if (isBrowserAddress(address, treatAsPublic) && !byAddress.has(withoutPeerId(address))) byAddress.set(withoutPeerId(address), address);
    return [...byAddress];
};

// What running kubo announces, or, while it is down, what its config would announce. That can't be dialed, so it stays unverified.
export async function verifyUnmanagedAddresses(input: {
    running: string[] | undefined;
    config: string[] | undefined;
    treatAsPublic?: string[];
    dial?: DialAddress;
    // Over public DNS unless a test says otherwise. Records without a source count as public ones.
    resolve?: (name: string) => Promise<ResolvedDomain & Partial<Pick<PublicRecords, "source" | "unanswered">>>;
    signal?: AbortSignal;
    localIps?: string[];
}): Promise<UnmanagedAddress[]> {
    const { treatAsPublic = [], dial = dialWithLibp2p, resolve = resolveOverPublicDns, signal, localIps = localIpsFromInterfaces() } = input;
    if (input.running === undefined) return uniqueBrowserAddresses(input.config ?? [], treatAsPublic).map(([address]) => ({ address, status: "unverified" }));
    return Promise.all(
        uniqueBrowserAddresses(input.running, treatAsPublic).map(async ([address, dialable]): Promise<UnmanagedAddress> => {
            let targets = [address.match(/^\/ip[46]\/([^/]+)\//)?.[1]].filter((ip) => ip !== undefined);
            let records: PublicRecords | undefined;
            const systemDns = () => (records?.source === "system" ? { systemDns: true as const } : {});
            try {
                const [, protocol, name] = address.match(/^\/(dns[46]?)\/([^/]+)\//) ?? [];
                if (name) {
                    const resolved = await resolve(name);
                    records = { v4: resolved.v4, v6: resolved.v6, source: resolved.source ?? "public", ...(resolved.unanswered ? { unanswered: resolved.unanswered } : {}) };
                    // Only the family the address is dialed over, as the dial picks: a /dns4 address never goes to an IPv6 record.
                    const families = familiesOf(protocol!);
                    targets = families.flatMap((family) => records![family]);
                    // A DNS outage here says nothing about what browsers can resolve, so it is no failure, Funnel or not.
                    if (targets.length === 0 && families.some((family) => resolved.unanswered?.includes(family)))
                        return { address, status: "unconfirmed", error: dnsUnansweredMessage(name), ...systemDns() };
                    // Not dialed either way. Public DNS saying so is what browsers get, so that is a failure. This machine's own
                    // resolver saying so, as MagicDNS does for its own ts.net name, or with a family unanswered, proves nothing about them.
                    if (targets.length > 0 && !targets.some((ip) => isPublicIp(ip) || treatAsPublic.includes(ip)))
                        return { address, status: records.source === "system" ? "unconfirmed" : "failed", error: `${name} resolves only to private addresses`, ...systemDns() };
                }
                // The dial goes to the addresses found here, so it takes the same path whatever this machine's own resolver says.
                const { handshakeMs, dns: dialed } = await dial(dialable, { timeoutMs: BROWSER_DIAL_TIMEOUT_MS, ...(signal ? { signal } : {}), ...(records ? { records } : {}) });
                return {
                    address,
                    status: "ok",
                    ...(handshakeMs !== undefined ? { handshakeMs } : {}),
                    ...(handshakeMs !== undefined && handshakeMs >= SLOW_HANDSHAKE_MS ? { slow: true as const } : {}),
                    // The dial says so itself when the connection did not go where the records pointed.
                    ...(dialed?.source === "system" ? { systemDns: true as const } : systemDns())
                };
            } catch (error) {
                // A machine reaches its own IP directly, so that failure is real. Any other IP goes through a router, which may not send it back (no NAT hairpin).
                // A Funnel name leads to Tailscale's servers and never back through this machine's router, so its failure is real too.
                const status = isFunnelAddress(address) || targets.every((ip) => localIps.includes(ip)) ? "failed" : "unconfirmed";
                return {
                    address,
                    status,
                    error: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " "),
                    ...(error instanceof HandshakeTimeoutError ? { timedOut: true as const } : {}),
                    ...systemDns()
                };
            }
        })
    );
}

export interface WssCheck {
    addresses: UnmanagedAddress[];
    // Present when a ts.net address was dialed.
    funnelIngress?: FunnelIngressReport;
}

// The whole check of the WSS addresses kubo announces, shared by `status` and the daemon: a handshake with each,
// held to a browser's time limit, and for a Tailscale Funnel address the latency of the hop from Tailscale's ingress
// servers to this node. The ping comes second on purpose, because only an ingress server that just carried traffic answers.
export async function checkWssAddresses(input: Parameters<typeof verifyUnmanagedAddresses>[0] & { runTailscale?: RunCommand; now?: () => number; platform?: string }): Promise<WssCheck> {
    const { runTailscale, now, platform, ...verify } = input;
    const addresses = await verifyUnmanagedAddresses(verify);
    const dialedFunnel = addresses.some(({ address, status }) => isFunnelAddress(address) && status !== "unverified");
    if (!dialedFunnel || input.signal?.aborted) return { addresses };
    const funnelIngress = await pingFunnelIngress({
        ...(runTailscale ? { run: runTailscale } : {}),
        ...(now ? { now } : {}),
        ...(platform ? { platform } : {}),
        ...(input.signal ? { signal: input.signal } : {})
    });
    return { addresses, funnelIngress };
}

export const BROWSER_LIMIT = formatSeconds(BROWSER_DIAL_TIMEOUT_MS);
const SYSTEM_DNS_CAVEAT =
    "The name was resolved by this machine's own resolver, because no public DNS resolver could be reached or the connection did not use their answer, so it may not lead where it leads browsers";
export const slowHandshakeMessage = ({ address, handshakeMs }: UnmanagedAddress) =>
    `the handshake through ${address} took ${formatSeconds(handshakeMs!)}, and browsers give up on an address after ${BROWSER_LIMIT}`;

// How long each handshake took. Failures other than running out of time are reported by browser-address and the verdict.
export function wssHandshakeCheck(addresses: UnmanagedAddress[]): ReachabilityCheck | undefined {
    const id = "wss-handshake";
    const timed = addresses.filter(({ handshakeMs }) => handshakeMs !== undefined);
    // Only where the failure is real: behind a router without NAT hairpin, a machine's dial to its own public address
    // times out too, and that says nothing about how long browsers wait.
    const timedOut = addresses.filter((address) => address.timedOut && address.status === "failed");
    if (timed.length === 0 && timedOut.length === 0) return undefined;
    const slow = timed.filter((address) => address.slow);
    const detail = [
        ...timed.map(({ address, handshakeMs }) => `The WSS handshake through ${address} took ${formatSeconds(handshakeMs!)}`),
        ...timedOut.map(({ address, error }) => `Through ${address}, ${error}`),
        ...(slow.length > 0 ? [`Browsers give up on an address after ${BROWSER_LIMIT}, and are usually further from it than this machine, so some will fail to connect`] : []),
        ...([...timed, ...timedOut].some((address) => address.systemDns) ? [SYSTEM_DNS_CAVEAT] : [])
    ].join(". ");
    const troubled = [...slow, ...timedOut];
    if (troubled.length === 0) return { id, status: "ok", detail };
    const fix = troubled.some(({ address }) => isFunnelAddress(address))
        ? `The Funnel path to this node is slow, which this node cannot repair. See "A Funnel path can degrade" in ${TAILSCALE_FUNNEL_DOC}`
        : "Check the server in front of kubo and the network path to it: the handshake is too slow for browsers";
    return { id, status: timedOut.length > 0 ? "fail" : "warn", detail, fix };
}

// One result of the daemon's periodic check, as it is stored and logged. Milliseconds, because these lines are the
// record of how often and how badly a path degrades.
export function summarizeWssResult(result: UnmanagedAddress): Pick<WssAddressCheck, "status" | "handshakeMs" | "error"> {
    const status = result.status === "ok" ? (result.slow ? "slow" : "ok") : result.status === "failed" ? "failed" : "unconfirmed";
    return { status, ...(result.handshakeMs !== undefined ? { handshakeMs: result.handshakeMs } : {}), ...(result.error !== undefined ? { error: result.error } : {}) };
}

export function describeWssCheck(check: Pick<WssAddressCheck, "status" | "handshakeMs" | "error">): string {
    const took = check.handshakeMs === undefined ? "" : ` in ${check.handshakeMs} ms`;
    if (check.status === "ok") return `completed a handshake${took}`;
    if (check.status === "slow") return `slow handshake${took}`;
    if (check.status === "failed") return `failed: ${check.error ?? "unknown reason"}`;
    return `could not be tested from this machine: ${check.error ?? "unknown reason"}`;
}

// What `status` prints for the daemon's last periodic check. A problem the address has recovered from is kept on its line.
export function formatPeriodicWssCheck(check: PeriodicWssCheck): string[] {
    const lines = [`Last periodic WSS check: ${check.at}`];
    for (const [address, result] of Object.entries(check.addresses)) {
        const recovered = result.status === "ok" || result.status === "unconfirmed";
        const past = recovered && result.lastProblemAt ? `; last problem ${result.lastProblemAt}${result.lastProblem ? ` (${result.lastProblem})` : ""}` : "";
        lines.push(`  ${address}: ${describeWssCheck(result)}${past}`);
    }
    if (check.funnelIngress) lines.push(`  Funnel ingress: ${formatFunnelIngress(check.funnelIngress)}`);
    return lines;
}

// Says what was tested, not "browsers can reach it": a machine dialing its own address never crosses a provider's firewall.
export const handshakeSucceededMessage = (address: string) =>
    `kubo announces ${address} and a handshake from this machine succeeded. \`bitsocial reachability\` does not manage it.`;
export const handshakeFailedMessage = (failed: UnmanagedAddress[]) =>
    `Announced addresses that failed a handshake: ${failed.map(({ address, error }) => `${address} (${error})`).join(", ")}`;
export const unconfirmedMessage = (unconfirmed: UnmanagedAddress[]) =>
    `Could not connect from this machine to ${unconfirmed.map(({ address, error }) => `${address} (${error})`).join(", ")}. Browsers may still be able to, as a router often will not connect a machine to its own public address`;
export const unverifiedMessage = (unverified: UnmanagedAddress[]) =>
    `kubo's config announces ${unverified.map(({ address }) => address).join(", ")}, which cannot be verified while the daemon is not running.`;

const ofStatus = (addresses: UnmanagedAddress[], status: UnmanagedAddress["status"]) => addresses.filter((address) => address.status === status);

// What AutoNAT says about the transports a WSS handshake does not cover. Since go-libp2p 0.47 a WebTransport address
// inherits QUIC's result on the same port, so "reached" proves inbound UDP, not a browser handshake.
export interface AutonatEvidence {
    webTransportReached: string[];
    webTransportUntested: string[];
    // Any address at all, which desktop kubo and helia can dial.
    reached: string[];
}

const isWebTransport = (address: string) => /\/udp\/\d+\/quic-v1\/webtransport/.test(address) && !address.includes("/p2p-circuit");

export function autonatEvidence(autonat: KuboAutonat | undefined): AutonatEvidence {
    const reached = autonat?.reachable ?? [];
    const webTransportReached = reached.filter(isWebTransport);
    return {
        reached,
        webTransportReached,
        webTransportUntested: webTransportReached.length > 0 ? [] : (autonat?.unknown ?? []).filter(isWebTransport)
    };
}

const NO_EVIDENCE: AutonatEvidence = { webTransportReached: [], webTransportUntested: [], reached: [] };
const ADD_WSS = "Run `bitsocial reachability setup` to add WSS";

const udpPorts = (addresses: string[]) =>
    [...new Set(addresses.map((address) => address.match(/\/udp\/(\d+)\//)?.[1]).filter((port) => port !== undefined))].join(" and ");

export const webTransportReachedMessage = (addresses: string[]) =>
    `AutoNAT reached kubo over QUIC on UDP ${udpPorts(addresses)}, so browsers that support WebTransport should be able to connect unless their network blocks UDP`;
export const webTransportUntestedMessage = (addresses: string[]) =>
    `AutoNAT has not tested kubo's WebTransport addresses yet (${addresses.join(", ")}), so whether browsers can connect over WebTransport is not known yet`;
export const desktopOnlyMessage = (reached: string[]) =>
    `Desktop nodes can reach this node (AutoNAT reached ${reached.join(", ")}) and it seeds for them, but browsers cannot connect directly`;

export function browserAddressCheck(addresses: UnmanagedAddress[], evidence: AutonatEvidence = NO_EVIDENCE): ReachabilityCheck | undefined {
    const id = "browser-address";
    const ok = ofStatus(addresses, "ok");
    const failed = ofStatus(addresses, "failed");
    const unconfirmed = ofStatus(addresses, "unconfirmed");
    const unverified = ofStatus(addresses, "unverified");
    const fix = "Check the server in front of kubo, or run: bitsocial reachability setup";
    const webTransport = evidence.webTransportReached.length > 0 ? webTransportReachedMessage(evidence.webTransportReached) : undefined;
    if (unverified.length > 0) return { id, status: "unknown", detail: unverifiedMessage(unverified) };
    if (ok.length === 0 && unconfirmed.length === 0) {
        const failures = failed.length > 0 ? [handshakeFailedMessage(failed)] : [];
        // Without WSS, WebTransport is all a browser has: a reached address makes this a warning, not a failure.
        if (webTransport) return { id, status: "warn", detail: [webTransport, ...failures].join(". "), fix: failed.length > 0 ? fix : ADD_WSS };
        if (evidence.webTransportUntested.length > 0)
            return { id, status: failed.length > 0 ? "warn" : "unknown", detail: [webTransportUntestedMessage(evidence.webTransportUntested), ...failures].join(". "), ...(failed.length > 0 ? { fix } : {}) };
        if (failed.length === 0) return undefined;
        if (evidence.reached.length > 0) return { id, status: "warn", detail: [desktopOnlyMessage(evidence.reached), ...failures].join(". "), fix };
        return { id, status: "fail", detail: handshakeFailedMessage(failed), fix };
    }
    const succeeded = ok.length > 0 ? [`A handshake from this machine succeeded through ${ok.map(({ address }) => address).join(", ")}`] : [];
    const problems = [...(failed.length > 0 ? [handshakeFailedMessage(failed)] : []), ...(unconfirmed.length > 0 ? [unconfirmedMessage(unconfirmed)] : [])];
    if (problems.length > 0) return { id, status: "warn", detail: [...succeeded, ...problems, ...(webTransport ? [webTransport] : [])].join(". "), fix };
    return { id, status: "ok", detail: succeeded.join("") };
}
