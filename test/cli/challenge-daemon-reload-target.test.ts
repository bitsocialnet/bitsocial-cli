import { describe, it, expect } from "vitest";
import { challengeReloadUrlFromPkcRpcUrl } from "../../src/challenge-packages/challenge-utils.js";

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
