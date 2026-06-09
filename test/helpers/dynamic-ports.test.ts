// Regression tests for issue #87: the dynamic-port + bind-race-retry machinery that makes the
// daemon/kubo test suite collision-proof. Hardcoded kubo API ports fell inside macOS's ephemeral
// range, so under fileParallelism the kernel could hand one to another test file's outbound socket
// and kubo's bind would intermittently fail with "address already in use". These tests cover the
// allocator and the retry helper directly (no daemon spawn) so they're fast and deterministic.
import { describe, it, expect } from "vitest";
import net from "net";
import { allocateFreePort, allocateKuboEndpoints, isAddressInUseError, withKuboBindRetry, type KuboEndpoints } from "./daemon-helpers.js";

const isBindable = (port: number, host = "127.0.0.1") =>
    new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, host, () => server.close(() => resolve(true)));
    });

describe("dynamic port allocation helpers (issue #87)", () => {
    it("allocateFreePort returns a currently-bindable port", async () => {
        const port = await allocateFreePort();
        expect(port).toBeGreaterThan(0);
        expect(await isBindable(port)).toBe(true);
    });

    it("allocateKuboEndpoints returns three distinct ports and well-formed URLs", async () => {
        const e = await allocateKuboEndpoints();
        expect(new Set([e.rpcPort, e.kuboPort, e.gatewayPort]).size).toBe(3);
        expect(e.rpcWsUrl).toBe(`ws://localhost:${e.rpcPort}`);
        expect(e.kuboRpcUrl).toBe(`http://0.0.0.0:${e.kuboPort}/api/v0`);
        expect(e.kuboApiUrl).toBe(`http://localhost:${e.kuboPort}/api/v0`);
        expect(e.gatewayUrl).toBe(`http://0.0.0.0:${e.gatewayPort}`);
    });

    it("isAddressInUseError recognises the bind-race signatures (string and Error)", () => {
        expect(isAddressInUseError("listen tcp4 0.0.0.0:50599: bind: address already in use")).toBe(true);
        expect(isAddressInUseError(new Error("EADDRINUSE: address already in use 0.0.0.0:50599"))).toBe(true);
        expect(isAddressInUseError("some unrelated failure")).toBe(false);
    });

    it("withKuboBindRetry retries a bind race with fresh endpoints, then succeeds", async () => {
        const seen: KuboEndpoints[] = [];
        let attempts = 0;
        const { result, endpoints } = await withKuboBindRetry(async (e) => {
            attempts++;
            seen.push(e);
            if (attempts < 3) throw new Error(`listen tcp4 0.0.0.0:${e.kuboPort}: bind: address already in use`);
            return "started";
        });
        expect(attempts).toBe(3);
        expect(result).toBe("started");
        // Every attempt got a freshly allocated set — that's what dodges a recurring collision.
        expect(new Set(seen.map((s) => s.kuboPort)).size).toBe(3);
        expect(endpoints).toBe(seen[2]);
    });

    it("withKuboBindRetry does NOT retry a non-bind error and rethrows immediately", async () => {
        let attempts = 0;
        await expect(
            withKuboBindRetry(async () => {
                attempts++;
                throw new Error("kubo repo is corrupt");
            })
        ).rejects.toThrow("kubo repo is corrupt");
        expect(attempts).toBe(1);
    });

    it("withKuboBindRetry gives up after the retry budget and throws the last bind error", async () => {
        let attempts = 0;
        await expect(
            withKuboBindRetry(
                async (e) => {
                    attempts++;
                    throw new Error(`bind: address already in use (port ${e.kuboPort})`);
                },
                { retries: 2 }
            )
        ).rejects.toThrow(/address already in use/);
        expect(attempts).toBe(2);
    });

    it("withKuboBindRetry runs cleanup after each failed attempt", async () => {
        let cleanups = 0;
        const { result } = await withKuboBindRetry(
            async (e) => {
                if (cleanups < 1) throw new Error(`bind: address already in use ${e.kuboPort}`);
                return "ok";
            },
            {
                cleanup: () => {
                    cleanups++;
                }
            }
        );
        expect(result).toBe("ok");
        expect(cleanups).toBe(1);
    });
});
