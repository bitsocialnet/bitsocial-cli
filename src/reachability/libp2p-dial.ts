import { resolveOverPublicDns, withPinnedLookup, type PublicRecords, type ResolvePublicly } from "./public-dns.js";

// How long a browser's libp2p waits on one address before it gives up on it (js-libp2p's per-address dial timeout).
// A handshake that needs longer than this from here is one no browser will ever finish.
export const BROWSER_DIAL_TIMEOUT_MS = 6_000;

// Half of what a browser allows. This machine is usually closer to the address than a browser is, so a handshake
// that needs this long from here leaves a phone on a mobile network little room. A judgment call, not a measurement.
export const SLOW_HANDSHAKE_MS = BROWSER_DIAL_TIMEOUT_MS / 2;

export const formatSeconds = (ms: number) => `${Number((ms / 1000).toFixed(1))} s`;

export class HandshakeTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`the handshake did not finish within ${formatSeconds(timeoutMs)}, which is when browsers give up on an address`);
        this.name = "HandshakeTimeoutError";
    }
}

// A real handshake, not a TCP or TLS probe: it proves the address reaches this kubo and not merely
// something answering on that port, because libp2p checks the remote identity against the /p2p part.
// The WebSocket client validates TLS against the system's trust roots, as a browser would.
// A /dns4, /dns6 or /dns name is resolved over public DNS first and the dial pinned to those addresses, so the
// handshake takes the path browsers take and not whatever this machine's own resolver makes of the name (#281).
// handshakeMs covers the dial alone: TCP, TLS, the WebSocket upgrade and the libp2p handshake, not loading libp2p or DNS.
export interface DialOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    // What the name resolves to, when the caller has already looked it up.
    records?: PublicRecords;
    resolveName?: ResolvePublicly;
}

export interface DialResult {
    peerId: string;
    handshakeMs: number;
    // Present for an address with a name: where the dial went, and whose resolver said so.
    dns?: { name: string; source: PublicRecords["source"]; ips: string[] };
}

export async function dialWithLibp2p(address: string, { timeoutMs = BROWSER_DIAL_TIMEOUT_MS, signal, records, resolveName = resolveOverPublicDns }: DialOptions = {}): Promise<DialResult> {
    // Imported here because libp2p is slow to load and only a node with an address to verify needs it.
    const [{ createLibp2p }, { webSockets }, { noise }, { yamux }, { identify }, { multiaddr }] = await Promise.all([
        import("libp2p"),
        import("@libp2p/websockets"),
        import("@libp2p/noise"),
        import("@libp2p/yamux"),
        import("@libp2p/identify"),
        import("@multiformats/multiaddr")
    ]);
    const parsed = multiaddr(address);
    if (!parsed.getComponents().some((component) => component.name === "p2p"))
        throw new Error(`Cannot verify ${address} without knowing whose node to expect: it has no /p2p/<peer id> part`);

    const [, nameProtocol, name] = address.match(/^\/(dns[46]?)\/([^/]+)\//) ?? [];
    let pinned: DialResult["dns"];
    if (name && nameProtocol) {
        const resolved = records ?? (await resolveName(name));
        const ips = nameProtocol === "dns4" ? resolved.v4 : nameProtocol === "dns6" ? resolved.v6 : [...resolved.v4, ...resolved.v6];
        if (ips.length === 0) {
            const record = nameProtocol === "dns4" ? "A record" : nameProtocol === "dns6" ? "AAAA record" : "A or AAAA record";
            throw new Error(resolved.source === "public" ? `${name} has no ${record} in public DNS, so browsers cannot resolve it` : `${name} has no ${record}`);
        }
        pinned = { name, source: resolved.source, ips };
    }

    const node = await createLibp2p({
        addresses: { listen: [] },
        transports: [webSockets()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: { identify: identify() },
        // The default gater refuses private addresses, and verifying them is the operator's call.
        connectionGater: { denyDialMultiaddr: () => false }
    });
    // Both start once the dial does: withPinnedLookup may first wait for another dial through the same name, and
    // that wait is neither part of the handshake nor of the time a browser allows it.
    let timeout: AbortSignal | undefined;
    let handshakeMs = 0;
    try {
        const dial = async () => {
            timeout = AbortSignal.timeout(timeoutMs);
            const startedAt = performance.now();
            // libp2p types Multiaddr from its own nested copy of the package; the runtime object is the same.
            const connection = await node.dial(parsed as unknown as Parameters<typeof node.dial>[0], { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            handshakeMs = Math.round(performance.now() - startedAt);
            return connection;
        };
        const { result: connection, lookups } = pinned ? await withPinnedLookup(pinned.name, pinned.ips, dial) : { result: await dial(), lookups: 0 };
        // A connection that never asked the pin resolved the name by itself, with this machine's resolver.
        const dns = pinned && lookups === 0 ? { name: pinned.name, source: "system" as const, ips: [] } : pinned;
        return { peerId: connection.remotePeer.toString(), handshakeMs, ...(dns ? { dns } : {}) };
    } catch (error) {
        // libp2p reports an aborted dial in several shapes, so the clock decides. A caller's own abort is not a timeout.
        if (timeout?.aborted && !signal?.aborted) throw new HandshakeTimeoutError(timeoutMs);
        // A WebSocket that fails to open rejects with an ErrorEvent, which prints as "[object ErrorEvent]".
        if (error instanceof Error) throw error;
        const { message, error: cause } = (error ?? {}) as { message?: unknown; error?: { message?: unknown } };
        throw new Error([message, cause?.message].find((text) => typeof text === "string" && text !== "") as string | undefined ?? `the connection failed (${String(error)})`);
    } finally {
        await node.stop();
    }
}
