import { randomBytes } from "crypto";
import http from "http";
import https from "https";

const WEBSOCKET_FAILED = "the WebSocket connection failed";

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
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
        // libp2p types Multiaddr from its own nested copy of the package; the runtime object is the same.
        const connection = await node.dial(parsed as unknown as Parameters<typeof node.dial>[0], { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        return { peerId: connection.remotePeer.toString() };
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timeout.aborted) throw new Error(`no handshake within ${Math.round(timeoutMs / 1000)} s`, { cause: error });
        if (error instanceof Error && !error.message.startsWith("[object ")) throw error;
        // Node's WebSocket rejects with an error event whose message is the same for every failure, so ask the server ourselves.
        const target = webSocketTarget(parsed.getComponents());
        throw new Error((target && (await probeWebSocket(target))) ?? WEBSOCKET_FAILED, { cause: error });
    } finally {
        await node.stop();
    }
}

interface WebSocketTarget {
    host: string;
    port: number;
    secure: boolean;
    servername?: string;
}

const webSocketTarget = (components: { name: string; value?: string }[]): WebSocketTarget | undefined => {
    const host = components.find((component) => ["ip4", "ip6", "dns", "dns4", "dns6", "dnsaddr"].includes(component.name))?.value;
    const port = Number(components.find((component) => component.name === "tcp")?.value);
    if (!host || !port) return undefined;
    const servername = components.find((component) => component.name === "sni")?.value;
    const secure = components.some((component) => component.name === "tls" || component.name === "wss");
    return { host, port, secure, ...(servername ? { servername } : {}) };
};

// What a WebSocket upgrade request to the same place runs into, or undefined if this attempt worked or found nothing more specific.
export function probeWebSocket({ host, port, secure, servername }: WebSocketTarget, timeoutMs = 5_000): Promise<string | undefined> {
    return new Promise((resolve) => {
        const request = (secure ? https : http).request({
            host,
            port,
            path: "/",
            agent: false,
            ...(secure && servername ? { servername } : {}),
            signal: AbortSignal.timeout(timeoutMs),
            headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64") }
        });
        request.on("upgrade", (_response, socket) => {
            socket.destroy();
            resolve(undefined);
        });
        request.on("response", (response) => {
            response.resume();
            resolve(`the server answered HTTP ${response.statusCode} instead of accepting a WebSocket`);
        });
        request.on("error", (error) => resolve(socketErrorReason(error as NodeJS.ErrnoException)));
        request.end();
    });
}

const NETWORK_ERRORS: Record<string, string> = {
    ECONNREFUSED: "connection refused",
    ECONNRESET: "the server closed the connection",
    EHOSTUNREACH: "host unreachable",
    ENETUNREACH: "network unreachable",
    ETIMEDOUT: "connection timed out",
    ENOTFOUND: "the name does not resolve",
    EAI_AGAIN: "the name could not be resolved right now"
};

const socketErrorReason = (error: NodeJS.ErrnoException): string | undefined => {
    if (error.name === "AbortError" || error.name === "TimeoutError") return undefined;
    const code = error.code ?? "";
    if (NETWORK_ERRORS[code]) return `${code}: ${NETWORK_ERRORS[code]}`;
    if (/wrong version number|packet length too long|unknown protocol/i.test(error.message)) return "the server did not answer with TLS";
    if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS_CERT/.test(code)) return `the TLS certificate is not trusted: ${error.message}`;
    return code ? `${code}: ${error.message}` : error.message || undefined;
};

// Text for whatever a dial rejected with, so a non-Error never prints as "[object ...]".
export function dialFailureReason(error: unknown): string {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null
              ? [(error as { message?: unknown }).message, (error as { error?: { message?: unknown } }).error?.message].find((text) => typeof text === "string" && text !== "")
              : typeof error === "string"
                ? error
                : undefined;
    return typeof message === "string" && message !== "" && !message.startsWith("[object ") ? message.replace(/\s+/g, " ") : WEBSOCKET_FAILED;
}
