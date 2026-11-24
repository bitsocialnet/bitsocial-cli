import dns from "dns";
import net from "net";
import type { ResolvedDomain } from "./setup.js";

// Where an announced name leads for a browser, which is not always where it leads for this machine. With Tailscale's
// MagicDNS a machine resolves its own ts.net name to its tailnet address, so a dial through the name lands on
// whatever listens on that machine's own port 443 and says nothing about the path browsers take (#281).

export interface PublicRecords extends ResolvedDomain {
    // "system" when no public resolver could be reached and this machine's own resolver was asked instead.
    source: "public" | "system";
}

export type ResolvePublicly = (name: string) => Promise<PublicRecords>;

// Asked in this order; the next one only when the one before does not answer. Only the name is sent to them.
export const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];

// Rejects with a `code` as Node's resolver does. Without `servers`, asks the resolvers this machine is configured with.
export type DnsQuery = (name: string, type: "A" | "AAAA", servers?: string[]) => Promise<string[]>;

const queryDns: DnsQuery = (name, type, servers) => {
    const resolver = new dns.promises.Resolver({ timeout: 2_000, tries: 2 });
    if (servers) resolver.setServers(servers);
    return type === "A" ? resolver.resolve4(name) : resolver.resolve6(name);
};

// The resolver answered, and the answer is that there is no such record.
const NO_RECORD = ["ENOTFOUND", "ENODATA"];

export async function resolveOverPublicDns(name: string, { query = queryDns, servers = PUBLIC_RESOLVERS }: { query?: DnsQuery; servers?: string[] } = {}): Promise<PublicRecords> {
    const ask = async (type: "A" | "AAAA", from?: string[]) => {
        try {
            return { records: await query(name, type, from), answered: true };
        } catch (error) {
            return { records: [] as string[], answered: NO_RECORD.includes((error as NodeJS.ErrnoException).code ?? "") };
        }
    };
    const [v4, v6] = await Promise.all([ask("A", servers), ask("AAAA", servers)]);
    if (v4.answered || v6.answered) return { v4: v4.records, v6: v6.records, source: "public" };
    // A network that blocks outside resolvers must not turn every check into a failure, so this machine's own
    // resolver is the fallback. Callers say so, because that answer may not be the one browsers get.
    const [systemV4, systemV6] = await Promise.all([ask("A"), ask("AAAA")]);
    return { v4: systemV4.records, v6: systemV6.records, source: "system" };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

// One entry per name. `released` resolves when the dial holding it is done, so the next one through that name can start.
const pins = new Map<string, { ips: string[]; lookups: number; released: Promise<void> }>();
let originalLookup: typeof dns.lookup | undefined;

function pinnedLookup(hostname: string, options: unknown, callback?: LookupCallback): void {
    const done = (typeof options === "function" ? options : callback) as LookupCallback;
    const settings: dns.LookupOptions = typeof options === "number" ? { family: options } : typeof options === "object" && options !== null ? options : {};
    const pin = pins.get(String(hostname).toLowerCase());
    if (pin === undefined) return void (originalLookup as (...args: unknown[]) => void)(hostname, options, callback);
    pin.lookups++;
    const pinned = pin.ips;
    const family = settings.family === "IPv4" ? 4 : settings.family === "IPv6" ? 6 : (settings.family ?? 0);
    const addresses = pinned.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })).filter((entry) => family === 0 || entry.family === family);
    process.nextTick(() => {
        if (addresses.length === 0) return done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", syscall: "getaddrinfo", hostname }));
        if (settings.all) return done(null, addresses);
        done(null, addresses[0]!.address, addresses[0]!.family);
    });
}

// Runs `work` with lookups of `name` answered from `ips`, for every socket this process opens meanwhile. Node's
// global WebSocket, which libp2p dials with, takes no resolver or connect options, so the process-wide `dns.lookup`
// is the only place to decide where its connection goes. TLS still checks the certificate against the name. Only
// lookups of pinned names are answered here, everything else goes to the real one, and the last pin to end removes this.
// `lookups` is how many were answered for the name meanwhile: 0 means the connection never asked, so it did not go
// where the pin says and the caller must not claim that it did.
export async function withPinnedLookup<T>(name: string, ips: string[], work: () => Promise<T>): Promise<{ result: T; lookups: number }> {
    const key = name.toLowerCase();
    // One dial per name at a time. A /dns4 and a /dns6 address can share a name and are checked together, but the
    // WebSocket only ever sees the name, so the pin is all that sends each of them to its own addresses.
    for (let held = pins.get(key); held; held = pins.get(key)) await held.released;
    if (pins.size === 0) {
        originalLookup = dns.lookup;
        dns.lookup = pinnedLookup as typeof dns.lookup;
    }
    let release!: () => void;
    const pin = { ips, lookups: 0, released: new Promise<void>((resolve) => (release = resolve)) };
    pins.set(key, pin);
    try {
        return { result: await work(), lookups: pin.lookups };
    } finally {
        pins.delete(key);
        if (pins.size === 0 && originalLookup) {
            dns.lookup = originalLookup;
            originalLookup = undefined;
        }
        release();
    }
}
