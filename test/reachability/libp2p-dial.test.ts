// Issue #241: a failed WebSocket dial reported "[object ErrorEvent]", because Node's WebSocket rejects with an
// event that carries no reason. Each case below must name what actually went wrong.
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { dialWithLibp2p } from "../../src/reachability/libp2p-dial.js";

const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const listen = async <T extends net.Server>(server: T): Promise<number> => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const sockets = new Set<net.Socket>();
    server.on("connection", (socket: net.Socket) => sockets.add(socket));
    cleanups.push(() => {
        for (const socket of sockets) socket.destroy();
        return new Promise((resolve) => server.close(resolve));
    });
    return (server.address() as AddressInfo).port;
};

const closedPort = async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    return port;
};

const failure = async (address: string, timeoutMs?: number): Promise<Error> => {
    const error = await dialWithLibp2p(address, timeoutMs ? { timeoutMs } : {}).then(
        () => undefined,
        (error: unknown) => error
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/\[object /);
    return error as Error;
};

describe("dialWithLibp2p failure reasons", { timeout: 30_000 }, () => {
    it("says the connection was refused when nothing listens on the port", async () => {
        const error = await failure(`/ip4/127.0.0.1/tcp/${await closedPort()}/tls/ws/p2p/${peerId}`);
        expect(error.message).toMatch(/ECONNREFUSED: connection refused/);
    });

    it("says the server did not answer with TLS when a plain HTTP server is behind a /tls/ws address", async () => {
        const port = await listen(http.createServer((_request, response) => response.end("hello")));
        const error = await failure(`/ip4/127.0.0.1/tcp/${port}/tls/ws/p2p/${peerId}`);
        expect(error.message).toMatch(/did not answer with TLS/);
    });

    it("says the certificate is not trusted", async () => {
        const port = await listen(
            https.createServer(
                { cert: fs.readFileSync("test/fixtures/pebble/listener-cert.pem"), key: fs.readFileSync("test/fixtures/pebble/listener-key.pem") },
                (_request, response) => response.end("hello")
            )
        );
        const error = await failure(`/ip4/127.0.0.1/tcp/${port}/tls/ws/p2p/${peerId}`);
        expect(error.message).toMatch(/TLS certificate is not trusted/);
    });

    it("names the HTTP status when the server answers without upgrading to a WebSocket", async () => {
        const port = await listen(
            http.createServer((_request, response) => {
                response.statusCode = 404;
                response.end("not here");
            })
        );
        const error = await failure(`/ip4/127.0.0.1/tcp/${port}/ws/p2p/${peerId}`);
        expect(error.message).toMatch(/HTTP 404/);
    });

    it("says no handshake finished in time when the server never answers", async () => {
        const port = await listen(net.createServer(() => {}));
        const error = await failure(`/ip4/127.0.0.1/tcp/${port}/tls/ws/p2p/${peerId}`, 2_000);
        expect(error.message).toMatch(/no handshake within 2 s/);
    });

    it("says it reached a different node when the peer id does not match", async () => {
        const [{ createLibp2p }, { webSockets }, { noise }, { yamux }] = await Promise.all([
            import("libp2p"),
            import("@libp2p/websockets"),
            import("@libp2p/noise"),
            import("@libp2p/yamux")
        ]);
        const listener = await createLibp2p({
            addresses: { listen: ["/ip4/127.0.0.1/tcp/0/ws"] },
            transports: [webSockets()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()]
        });
        cleanups.push(() => listener.stop());
        const address = listener.getMultiaddrs()[0]!.toString().replace(/\/p2p\/[^/]+$/, "");
        const error = await failure(`${address}/p2p/${peerId}`);
        expect(error.message).toMatch(/peer/i);
    });
});
