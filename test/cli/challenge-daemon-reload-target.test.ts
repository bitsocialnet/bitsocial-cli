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

    it("returns undefined for unusable urls", () => {
        expect(challengeReloadUrlFromPkcRpcUrl("not a url")).toBeUndefined();
        expect(challengeReloadUrlFromPkcRpcUrl("ws://localhost")).toBeUndefined(); // no port
    });
});

describe("reloadChallengesInDaemon", () => {
    it("returns false when nothing is listening", async () => {
        // Port 1 is privileged and unbound — connection is refused immediately
        expect(await reloadChallengesInDaemon("ws://127.0.0.1:1", 5000)).toBe(false);
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
            expect(await reloadChallengesInDaemon(`ws://127.0.0.1:${port}`, 300)).toBe(false);
            expect(Date.now() - startedAt).toBeLessThan(5000);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("reports a successful reload", async () => {
        const server = createServer((req, res) => {
            if (req.method === "POST" && req.url === "/api/challenges/reload") {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ ok: true, challenges: [] }));
                return;
            }
            res.writeHead(404).end();
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;

        try {
            expect(await reloadChallengesInDaemon(`ws://127.0.0.1:${port}`)).toBe(true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
