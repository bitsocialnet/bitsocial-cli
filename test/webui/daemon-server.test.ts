import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import net from "net";
import { directory as randomDirectory } from "tempy";
import { startDaemonServer } from "../../dist/webui/daemon-server.js";

// Intercept the PKCWsServer constructor so the plumbing tests below can assert the exact
// options startDaemonServer passes to it, without booting a real pkc instance.
// The bind-contract test is unaffected: it rejects before the RPC server is created.
const { pkcWsServerFake } = vi.hoisted(() => ({ pkcWsServerFake: vi.fn() }));
vi.mock("@pkcprotocol/pkc-js/rpc", () => ({ default: { PKCWsServer: pkcWsServerFake } }));

// Regression test for issue #42:
// startDaemonServer used to call webuiExpressApp.listen(port) fire-and-forget — no
// await on 'listening', no 'error' handler. If bind failed, the promise still resolved
// and the bind error showed up later as an uncaughtException, crashing the daemon
// AFTER the test helper had already accepted "Communities in data path" as readiness.
// The contract we want: if the port can't be bound, startDaemonServer must reject.
describe("startDaemonServer bind contract", () => {
    it("rejects when the RPC port is already taken (regression for issue #42)", async () => {
        // The blocker must bind the *same way* the daemon does — no host argument —
        // so it lands on whatever default Node picks for this platform. On macOS and
        // Windows that default is the IPv6 wildcard `::` with IPV6_V6ONLY=true, which
        // does NOT conflict with a 0.0.0.0 bind. Binding the blocker to 127.0.0.1 or
        // 0.0.0.0 would let the daemon's listen succeed there and never hit EADDRINUSE.
        const blocker = net.createServer();
        const port = await new Promise<number>((resolve, reject) => {
            blocker.once("listening", () => {
                const addr = blocker.address();
                if (addr && typeof addr === "object") resolve(addr.port);
                else reject(new Error(`unexpected address ${JSON.stringify(addr)}`));
            });
            blocker.once("error", reject);
            blocker.listen(0);
        });

        // Swallow any stray uncaughtException emitted by an unguarded server.listen()
        // so the test process survives long enough to assert the actual behavior.
        const stray: Error[] = [];
        const uncaughtHandler = (err: Error) => stray.push(err);
        process.on("uncaughtException", uncaughtHandler);

        try {
            await expect(
                startDaemonServer(
                    new URL(`ws://127.0.0.1:${port}`),
                    new URL("http://127.0.0.1:6754"),
                    { dataPath: randomDirectory() }
                )
            ).rejects.toThrow(/EADDRINUSE|address already in use/i);
            // And no stray uncaughtException either — the bind error must come back
            // through the promise, not the process.
            expect(stray).toEqual([]);
        } finally {
            process.off("uncaughtException", uncaughtHandler);
            await new Promise<void>((resolve) => blocker.close(() => resolve()));
        }
    });
});

// Regression coverage for the `daemon --allowPrivateKeyExport` plumbing added with
// `community export` (PR #65): the flag must reach the pkc-js RPC server verbatim,
// otherwise --no-allowPrivateKeyExport silently stops protecting the private key.
describe("startDaemonServer → PKCWsServer plumbing", () => {
    beforeEach(() => {
        pkcWsServerFake.mockReset();
        pkcWsServerFake.mockResolvedValue({
            pkc: { communities: [] },
            destroy: vi.fn(async () => {})
        });
    });

    const startOnRandomPort = (rpcServerOptions?: { allowPrivateKeyExport?: boolean }) =>
        startDaemonServer(
            new URL("ws://127.0.0.1:0"), // port 0 → ephemeral port, no collisions
            new URL("http://127.0.0.1:6754"),
            { dataPath: randomDirectory() },
            rpcServerOptions
        );

    it("passes allowPrivateKeyExport: false through to PKCWsServer", async () => {
        const daemonServer = await startOnRandomPort({ allowPrivateKeyExport: false });
        try {
            expect(pkcWsServerFake).toHaveBeenCalledTimes(1);
            expect(pkcWsServerFake.mock.calls[0][0].allowPrivateKeyExport).toBe(false);
        } finally {
            await daemonServer.destroy();
        }
    });

    it("passes allowPrivateKeyExport: true through to PKCWsServer", async () => {
        const daemonServer = await startOnRandomPort({ allowPrivateKeyExport: true });
        try {
            expect(pkcWsServerFake).toHaveBeenCalledTimes(1);
            expect(pkcWsServerFake.mock.calls[0][0].allowPrivateKeyExport).toBe(true);
        } finally {
            await daemonServer.destroy();
        }
    });

    it("leaves allowPrivateKeyExport undefined (pkc-js default) when no rpcServerOptions are given", async () => {
        const daemonServer = await startOnRandomPort();
        try {
            expect(pkcWsServerFake).toHaveBeenCalledTimes(1);
            expect(pkcWsServerFake.mock.calls[0][0].allowPrivateKeyExport).toBeUndefined();
        } finally {
            await daemonServer.destroy();
        }
    });

    it("does not 404 GET /exports/<exportId> — the PKCWsServer request listener owns it", async () => {
        // Regression: express's catch-all 404 raced pkc-js's async /exports handler on the shared
        // http.Server and clobbered the download — a live `community export` failed with HTTP 404
        // even though the export itself succeeded on the daemon.
        const exportId = "11111111-2222-3333-4444-555555555555";
        let boundPort: number | undefined;
        pkcWsServerFake.mockImplementation(async (options: { server: import("http").Server }) => {
            boundPort = (options.server.address() as import("net").AddressInfo).port;
            // Mimic pkc-js: attach a request listener that streams export downloads and stays
            // silent for every other path on a caller-supplied server. The delay mirrors the
            // async fs work the real handler does before writing headers — that latency is what
            // loses the race against express's synchronous catch-all 404.
            options.server.on("request", (req, res) => {
                if (req.url === `/exports/${exportId}` && req.method === "GET") {
                    setTimeout(() => {
                        if (res.writableEnded) return; // someone else (express's 404) already answered
                        res.statusCode = 200;
                        res.end("fake snapshot");
                    }, 20);
                }
            });
            return { pkc: { communities: [] }, destroy: vi.fn(async () => {}) };
        });

        const daemonServer = await startOnRandomPort();
        try {
            // The export download must reach pkc-js's listener, not express's 404
            const download = await fetch(`http://127.0.0.1:${boundPort}/exports/${exportId}`);
            expect(download.status).toBe(200);
            expect(await download.text()).toBe("fake snapshot");

            // Paths under /exports/ that pkc-js ignores must still get express's 404
            // instead of hanging with no response
            const nonDownload = await fetch(`http://127.0.0.1:${boundPort}/exports/not-a-uuid`, {
                signal: AbortSignal.timeout(5000)
            });
            expect(nonDownload.status).toBe(404);
        } finally {
            await daemonServer.destroy();
        }
    });
});

// pkc-js 0.0.136 rejects RPC connections from a page whose Origin is not a loopback host unless the
// URL carries the auth key. The local /<webui> route serves its page without the key whenever the
// socket is local, so a browser on the daemon host that opened http://<LAN IP>:9138/seedit got a
// page whose RPC connection pkc-js refuses. That route must send such a request to localhost instead.
describe("local webui route Host handling", () => {
    let boundPort: number;
    let daemonServer: Awaited<ReturnType<typeof startDaemonServer>>;

    beforeEach(async () => {
        pkcWsServerFake.mockReset();
        pkcWsServerFake.mockImplementation(async (options: { server: import("http").Server }) => {
            boundPort = (options.server.address() as import("net").AddressInfo).port;
            return { pkc: { communities: [] }, destroy: vi.fn(async () => {}) };
        });
        daemonServer = await startDaemonServer(new URL("ws://127.0.0.1:0"), new URL("http://127.0.0.1:6754"), {
            dataPath: randomDirectory()
        });
    });

    afterEach(async () => {
        await daemonServer.destroy();
    });

    // "/seedit/" because express.static first 301s "/seedit" to it. fetch() does not let us set Host, so send a raw request over loopback with a chosen Host header
    const getWithHost = (urlPath: string, host: string) =>
        new Promise<{ status: number; location?: string }>((resolve, reject) => {
            const req = http.request({ host: "127.0.0.1", port: boundPort, path: urlPath, headers: { host } }, (res) => {
                res.resume();
                resolve({ status: res.statusCode!, location: res.headers.location });
            });
            req.on("error", reject);
            req.end();
        });

    it.each(["192.168.1.5", "my-host.lan", "[fe80::1]"])("redirects a local request with Host %s to localhost", async (hostname) => {
        const { status, location } = await getWithHost("/seedit/", `${hostname}:${boundPort}`);
        expect(status).toBe(302);
        expect(location).toBe(`http://localhost:${boundPort}/seedit`);
    });

    it.each(["localhost", "127.0.0.1", "[::1]", "app.localhost"])("serves the page for a local request with Host %s", async (hostname) => {
        const { status } = await getWithHost("/seedit/", `${hostname}:${boundPort}`);
        expect(status).toBe(200);
    });
});
