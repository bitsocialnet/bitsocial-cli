// Regression tests for issue #87: the dynamic-port + bind-race-retry machinery that makes the
// daemon/kubo test suite collision-proof. Hardcoded kubo API ports fell inside macOS's ephemeral
// range, so under fileParallelism the kernel could hand one to another test file's outbound socket
// and kubo's bind would intermittently fail with "address already in use". These tests cover the
// allocator and the retry helper directly (no daemon spawn) so they're fast and deterministic.
import { describe, it, expect } from "vitest";
import net from "net";
import {
    allocateFreePort,
    allocateKuboEndpoints,
    isAddressInUseError,
    waitForPortFree,
    withKuboBindRetry,
    type KuboEndpoints
} from "./daemon-helpers.js";

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

    // Issue #128: the same lost bind race also reaches us through the CLI's own pre-bind guards,
    // which phrase it as "... port <host>:<port> ... is already in use" and never say "address
    // already in use". Missing these meant startPkcDaemonWithDynamicPorts rethrew instead of
    // retrying, so the race surfaced as a hard suite failure (daemon.test.ts's beforeAll).
    it("isAddressInUseError recognises the CLI's own pre-bind guard wordings (issue #128)", () => {
        // src/ipfs/startIpfs.ts:215 — one guard, three labels
        expect(
            isAddressInUseError(
                "Cannot start IPFS daemon because the IPFS Gateway port 0.0.0.0:37685 (configured as /ip4/0.0.0.0/tcp/37685) is already in use."
            )
        ).toBe(true);
        expect(
            isAddressInUseError(
                "Cannot start IPFS daemon because the IPFS Swarm port 0.0.0.0:41003 (configured as /ip4/0.0.0.0/tcp/41003) is already in use."
            )
        ).toBe(true);
        // src/cli/commands/daemon.ts:416
        expect(
            isAddressInUseError(
                new Error(
                    "Cannot start IPFS daemon because the IPFS API port 0.0.0.0:34811 (configured as http://0.0.0.0:34811/api/v0) is already in use."
                )
            )
        ).toBe(true);
        // src/cli/commands/daemon.ts:320
        expect(
            isAddressInUseError("PKC RPC port is already in use at ws://localhost:41234/ (another bitsocial daemon is likely running).")
        ).toBe(true);
        // Still not a catch-all: an unrelated failure that merely mentions a port must not retry.
        expect(isAddressInUseError("kubo repo is corrupt (port 41234 was fine)")).toBe(false);
        expect(isAddressInUseError("could not reach the gateway port 0.0.0.0:37685")).toBe(false);
    });

    // The second, avoidable failure from issue #128: when beforeAll dies before assigning its port,
    // afterAll called waitForPortFree(undefined) and net.Socket raised a TypeError about "options"
    // or "port" — a teardown crash reported next to the real startup error. Name the cause instead.
    it("waitForPortFree rejects with a cause-naming error when handed no port (issue #128)", async () => {
        await expect(waitForPortFree(undefined as unknown as number, "localhost", 100)).rejects.toThrow(/waitForPortFree/i);
        await expect(waitForPortFree(undefined as unknown as number, "localhost", 100)).rejects.toThrow(/beforeAll/i);
        await expect(waitForPortFree(Number.NaN, "localhost", 100)).rejects.toThrow(/waitForPortFree/i);
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
