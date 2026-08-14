import { describe, it, expect } from "vitest";
import path from "path";
import defaults from "../../src/common-utils/defaults.js";
import { challengeReloadUrlFromPkcRpcUrl, dataPathFromDaemonArgv } from "../../src/challenge-packages/challenge-utils.js";

// `challenge install` / `challenge remove` used to POST the reload endpoint at a hardcoded
// localhost:9138, so a daemon started with --pkcRpcUrl never picked up an install without a
// restart. Reload targets are now derived from the state files running daemons write.

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

describe("dataPathFromDaemonArgv", () => {
    it("reads a space-separated flag", () => {
        expect(dataPathFromDaemonArgv(["--pkcOptions.dataPath", "/tmp/data", "--pkcRpcUrl", "ws://localhost:1234"])).toBe("/tmp/data");
    });

    it("reads an =-separated flag", () => {
        expect(dataPathFromDaemonArgv(["--pkcOptions.dataPath=/tmp/data"])).toBe("/tmp/data");
    });

    it("falls back to the default data path when the flag is absent", () => {
        expect(dataPathFromDaemonArgv(["--pkcRpcUrl", "ws://localhost:1234"])).toBe(defaults.PKC_DATA_PATH);
    });

    it("does not treat a following flag as the value", () => {
        expect(dataPathFromDaemonArgv(["--pkcOptions.dataPath", "--pkcRpcUrl"])).toBe(defaults.PKC_DATA_PATH);
    });

    it("resolves to the same path a matching install would compare against", () => {
        const dataPath = "/tmp/some/data/";
        expect(path.resolve(dataPathFromDaemonArgv(["--pkcOptions.dataPath", dataPath]))).toBe(path.resolve(dataPath));
    });
});
