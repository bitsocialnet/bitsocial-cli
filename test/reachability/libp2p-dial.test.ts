// Issue #282: the dial gives up when a browser would, and says how long the handshake took.
import net, { type AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLibp2p, type Libp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { noise } from "@libp2p/noise";
import { yamux } from "@libp2p/yamux";
import { identify } from "@libp2p/identify";
import { BROWSER_DIAL_TIMEOUT_MS, dialWithLibp2p, HandshakeTimeoutError } from "../../src/reachability/libp2p-dial.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";

describe("dialWithLibp2p", () => {
    let listener: Libp2p;
    let port: number;

    beforeAll(async () => {
        listener = await createLibp2p({
            addresses: { listen: ["/ip4/127.0.0.1/tcp/0/ws"] },
            transports: [webSockets()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            services: { identify: identify() }
        });
        port = Number(listener.getMultiaddrs()[0]!.toString().match(/\/tcp\/(\d+)\//)![1]);
    });

    afterAll(() => listener.stop());

    it("gives up after 6 seconds unless told otherwise, as a browser does with one address", () => {
        expect(BROWSER_DIAL_TIMEOUT_MS).toBe(6_000);
    });

    it("reports how long the handshake took", async () => {
        const result = await dialWithLibp2p(`/ip4/127.0.0.1/tcp/${port}/ws/p2p/${listener.peerId.toString()}`);
        expect(result.peerId).toBe(listener.peerId.toString());
        expect(result.handshakeMs).toBeGreaterThan(0);
        expect(result.handshakeMs).toBeLessThan(BROWSER_DIAL_TIMEOUT_MS);
    });

    it("fails a handshake that outlasts the limit, and says the limit is the browsers'", async () => {
        // Accepts the connection and never answers, like a path that is too slow to finish TLS in time.
        const silent = net.createServer(() => {});
        await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
        try {
            const startedAt = Date.now();
            const error = await dialWithLibp2p(`/ip4/127.0.0.1/tcp/${(silent.address() as AddressInfo).port}/ws/p2p/${peerId}`, { timeoutMs: 300 }).catch((caught) => caught);
            expect(error).toBeInstanceOf(HandshakeTimeoutError);
            expect((error as Error).message).toMatch(/did not finish within 0\.3 s/);
            expect((error as Error).message).toMatch(/browsers give up/);
            expect(Date.now() - startedAt).toBeLessThan(3_000);
        } finally {
            silent.close();
        }
    });

    it("keeps the real reason when the dial fails before the limit", async () => {
        const closed = net.createServer();
        await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
        const closedPort = (closed.address() as AddressInfo).port;
        await new Promise((resolve) => closed.close(resolve));
        const error = await dialWithLibp2p(`/ip4/127.0.0.1/tcp/${closedPort}/ws/p2p/${peerId}`).catch((caught) => caught);
        // The WebSocket's ErrorEvent is not an Error and would print as "[object ErrorEvent]".
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(HandshakeTimeoutError);
        expect((error as Error).message).not.toMatch(/^\[object|^$/);
    });
});
