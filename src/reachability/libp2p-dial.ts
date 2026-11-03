// A real handshake, not a TCP or TLS probe: it proves the address reaches this kubo and not merely
// something answering on that port, because libp2p checks the remote identity against the /p2p part.
// The WebSocket client validates TLS against the system's trust roots, as a browser would.
export async function dialWithLibp2p(address: string, { timeoutMs = 20_000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ peerId: string }> {
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
    try {
        // libp2p types Multiaddr from its own nested copy of the package; the runtime object is the same.
        const connection = await node.dial(parsed as unknown as Parameters<typeof node.dial>[0], { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
        return { peerId: connection.remotePeer.toString() };
    } finally {
        await node.stop();
    }
}
