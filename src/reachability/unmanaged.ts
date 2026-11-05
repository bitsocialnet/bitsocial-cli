import type { ReachabilityCheck } from "./checks.js";
import { isPublicIp, localIpsFromInterfaces } from "./discovery.js";
import { dialWithLibp2p } from "./libp2p-dial.js";
import { resolveDomainRecords, type ResolvedDomain } from "./setup.js";

// Browser addresses kubo announces that `setup` did not put there: AutoTLS, or a reverse proxy set up by hand.
export interface UnmanagedAddress {
    address: string;
    status: "ok" | "failed" | "unconfirmed" | "unverified";
    error?: string;
}

export type DialAddress = (address: string, options: { signal?: AbortSignal; timeoutMs?: number }) => Promise<{ peerId: string }>;

const DIAL_TIMEOUT_MS = 10_000;
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
    resolve?: (name: string) => Promise<ResolvedDomain>;
    signal?: AbortSignal;
    localIps?: string[];
}): Promise<UnmanagedAddress[]> {
    const { treatAsPublic = [], dial = dialWithLibp2p, resolve = resolveDomainRecords, signal, localIps = localIpsFromInterfaces() } = input;
    if (input.running === undefined) return uniqueBrowserAddresses(input.config ?? [], treatAsPublic).map(([address]) => ({ address, status: "unverified" }));
    return Promise.all(
        uniqueBrowserAddresses(input.running, treatAsPublic).map(async ([address, dialable]): Promise<UnmanagedAddress> => {
            let targets = [address.match(/^\/ip[46]\/([^/]+)\//)?.[1]].filter((ip) => ip !== undefined);
            try {
                const name = address.match(/^\/dns[46]?\/([^/]+)\//)?.[1];
                if (name) {
                    const records = await resolve(name);
                    targets = [...records.v4, ...records.v6];
                    if (targets.length > 0 && !targets.some((ip) => isPublicIp(ip) || treatAsPublic.includes(ip))) return { address, status: "failed", error: `${name} resolves only to private addresses` };
                }
                await dial(dialable, { timeoutMs: DIAL_TIMEOUT_MS, ...(signal ? { signal } : {}) });
                return { address, status: "ok" };
            } catch (error) {
                // A machine reaches its own IP directly, so that failure is real. Any other IP goes through a router, which may not send it back (no NAT hairpin).
                const status = targets.every((ip) => localIps.includes(ip)) ? "failed" : "unconfirmed";
                return { address, status, error: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ") };
            }
        })
    );
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

export function browserAddressCheck(addresses: UnmanagedAddress[]): ReachabilityCheck | undefined {
    if (addresses.length === 0) return undefined;
    const ok = ofStatus(addresses, "ok");
    const failed = ofStatus(addresses, "failed");
    const unconfirmed = ofStatus(addresses, "unconfirmed");
    const unverified = ofStatus(addresses, "unverified");
    const fix = "Check the server in front of kubo, or run: bitsocial reachability setup";
    if (unverified.length > 0) return { id: "browser-address", status: "unknown", detail: unverifiedMessage(unverified) };
    if (ok.length === 0 && unconfirmed.length === 0) return { id: "browser-address", status: "fail", detail: handshakeFailedMessage(failed), fix };
    const succeeded = ok.length > 0 ? [`A handshake from this machine succeeded through ${ok.map(({ address }) => address).join(", ")}`] : [];
    const problems = [...(failed.length > 0 ? [handshakeFailedMessage(failed)] : []), ...(unconfirmed.length > 0 ? [unconfirmedMessage(unconfirmed)] : [])];
    if (problems.length > 0) return { id: "browser-address", status: "warn", detail: [...succeeded, ...problems].join(". "), fix };
    return { id: "browser-address", status: "ok", detail: succeeded.join("") };
}

// The lines `status` opens with on a node that never ran setup, where this replaces "Browsers cannot reach this node" only if something is worth saying.
export function notConfiguredSummary(addresses: UnmanagedAddress[]): string[] {
    const ok = ofStatus(addresses, "ok");
    const failed = ofStatus(addresses, "failed");
    const unconfirmed = ofStatus(addresses, "unconfirmed");
    const unverified = ofStatus(addresses, "unverified");
    const failures = failed.length > 0 ? [handshakeFailedMessage(failed)] : [];
    if (ok.length === 0 && unconfirmed.length === 0 && unverified.length === 0) return ["Reachability is not configured. Browsers cannot reach this node. Run: bitsocial reachability setup", ...failures];
    return [
        "`bitsocial reachability setup` has not been run on this node.",
        ...ok.map(({ address }) => handshakeSucceededMessage(address)),
        ...failures,
        ...(unconfirmed.length > 0 ? [unconfirmedMessage(unconfirmed)] : []),
        ...(unverified.length > 0 ? [unverifiedMessage(unverified)] : [])
    ];
}
