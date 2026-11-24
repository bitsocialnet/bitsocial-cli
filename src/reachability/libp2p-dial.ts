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
// handshakeMs covers the dial alone: TCP, TLS, the WebSocket upgrade and the libp2p handshake, not loading libp2p.
export async function dialWithLibp2p(address: string, { timeoutMs = BROWSER_DIAL_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ peerId: string; handshakeMs: number }> {
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

    const node = await createLibp2p({
        addresses: { listen: [] },
        transports: [webSockets()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: { identify: identify() },
        // The default gater refuses private addresses, and verifying them is the operator's call.
        connectionGater: { denyDialMultiaddr: () => false }
    });
    const timeout = AbortSignal.timeout(timeoutMs);
    const startedAt = performance.now();
    try {
        // libp2p types Multiaddr from its own nested copy of the package; the runtime object is the same.
        const connection = await node.dial(parsed as unknown as Parameters<typeof node.dial>[0], { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        return { peerId: connection.remotePeer.toString(), handshakeMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
        // libp2p reports an aborted dial in several shapes, so the clock decides. A caller's own abort is not a timeout.
        if (timeout.aborted && !signal?.aborted) throw new HandshakeTimeoutError(timeoutMs);
        // A WebSocket that fails to open rejects with an ErrorEvent, which prints as "[object ErrorEvent]".
        if (error instanceof Error) throw error;
        const { message, error: cause } = (error ?? {}) as { message?: unknown; error?: { message?: unknown } };
        throw new Error([message, cause?.message].find((text) => typeof text === "string" && text !== "") as string | undefined ?? `the connection failed (${String(error)})`);
    } finally {
        await node.stop();
    }
}
