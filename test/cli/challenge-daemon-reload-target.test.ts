import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { challengeReloadUrlFromPkcRpcUrl, reloadChallengesInDaemon } from "../../src/challenge-packages/challenge-utils.js";

// `challenge install` / `challenge remove` used to POST the reload endpoint at a hardcoded
// localhost:9138, so a daemon started with --pkcRpcUrl never picked up an install without a
// restart. The reload target is now derived from the command's own --pkcRpcUrl flag.

describe("challengeReloadUrlFromPkcRpcUrl", () => {
    it("derives the reload endpoint from the daemon's RPC url", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("ws://localhost:9138")).toBe("http://localhost:9138/api/challenges/reload");
    });

    it("keeps a non-default port", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("ws://localhost:54321/")).toBe("http://localhost:54321/api/challenges/reload");
    });

    it("dials a wildcard bind as loopback so the local-only endpoint accepts the request", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("ws://0.0.0.0:9138")).toBe("http://127.0.0.1:9138/api/challenges/reload");
        expect(challengeReloadUrlFromPkcRpcUrl("ws://[::]:9138")).toBe("http://127.0.0.1:9138/api/challenges/reload");
    });

    it("brackets IPv6 hosts", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("ws://[::1]:9138")).toBe("http://[::1]:9138/api/challenges/reload");
    });

    // A remote daemon is reached through its auth-key path; the bare /api/... route is local-only (403 otherwise)
    it("keeps the auth key path of a remote RPC url", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("ws://example.com:9138/secretkey")).toBe("http://example.com:9138/secretkey/api/challenges/reload");
        expect(challengeReloadUrlFromPkcRpcUrl("ws://example.com:9138/secretkey/")).toBe("http://example.com:9138/secretkey/api/challenges/reload");
    });

    it("maps wss to https", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("wss://example.com:9443/secretkey")).toBe("https://example.com:9443/secretkey/api/challenges/reload");
    });

    it("returns undefined for unusable urls", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("not a url")).toBeUndefined();
        expect(challengeReloadUrlFromPkcRpcUrl("ws://localhost")).toBeUndefined(); // no port
    });
});

describe("reloadChallengesInDaemon", () => {
    it("reports nothing listening as unreachable", async () => {
        // Port 1 is privileged and unbound — connection is refused immediately
        expect(await reloadChallengesInDaemon("ws://127.0.0.1:1", 5000)).toEqual({ status: "unreachable" });
    });

    it("gives up on a daemon that accepts the request but never answers", async () => {
        // Without a bounded request this waits for undici's 300s default, hanging the CLI
        const server = createServer(() => {
            /* accept the request, never respond */
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;

        try {
            const startedAt = Date.now();
            expect(await reloadChallengesInDaemon(`ws://127.0.0.1:${port}`, 300)).toEqual({ status: "unreachable" });
            expect(Date.now() - startedAt).toBeLessThan(5000);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    const withReloadEndpoint = async (status: number, body: unknown, run: (pkcRpcUrl: string) => Promise<void>) => {
        const server = createServer((req, res) => {
            if (req.method === "POST" && req.url === "/api/challenges/reload") {
                res.writeHead(status, { "content-type": "application/json" });
                res.end(JSON.stringify(body));
                return;
            }
            res.writeHead(404).end();
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;

        try {
            await run(`ws://127.0.0.1:${port}`);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    };

    // The list is what tells `install` whether the daemon serves the version it just installed: an answer alone does not
    it("reports a successful reload with the challenges the daemon loaded", async () => {
        await withReloadEndpoint(200, { ok: true, challenges: ["a-challenge@1.0.0", "b-challenge"] }, async (pkcRpcUrl) => {
            expect(await reloadChallengesInDaemon(pkcRpcUrl)).toEqual({ status: "reloaded", loaded: ["a-challenge@1.0.0", "b-challenge"] });
        });
    });

    it("reports a daemon that answered but did not reload, with its error", async () => {
        await withReloadEndpoint(500, { ok: false, error: "Error: boom" }, async (pkcRpcUrl) => {
            expect(await reloadChallengesInDaemon(pkcRpcUrl)).toEqual({ status: "failed", error: "Error: boom" });
        });
    });

    it("reports an answer without the loaded list as a failed reload", async () => {
        await withReloadEndpoint(403, "This endpoint does not exist for remote connections", async (pkcRpcUrl) => {
            expect(await reloadChallengesInDaemon(pkcRpcUrl)).toEqual({ status: "failed", error: "HTTP 403" });
        });
    });
});
