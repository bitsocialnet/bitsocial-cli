// Issue #200: the daemon read its kubo config from <dataPath>/.ipfs-bitsocial-cli while kubo itself
// ran at <dataPath>/.bitsocial-cli.ipfs (or $IPFS_PATH), so the read always came back empty and the
// daemon silently fell back to env vars and defaults.
import fs from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import {
    ipfsGatewayUrlFromKuboConfig,
    kuboRpcUrlFromKuboConfig,
    loadKuboConfigFile,
    parseMultiAddrIpfsGatewayToUrl,
    parseMultiAddrKuboRpcToUrl,
    resolveKuboRepoPath
} from "../../src/util.js";

describe("kubo repo path resolution", () => {
    let previousIpfsPath: string | undefined;

    beforeEach(() => {
        previousIpfsPath = process.env["IPFS_PATH"];
        delete process.env["IPFS_PATH"];
    });

    afterEach(() => {
        if (previousIpfsPath === undefined) delete process.env["IPFS_PATH"];
        else process.env["IPFS_PATH"] = previousIpfsPath;
    });

    const writeConfig = async (repoPath: string, config: unknown) => {
        await fs.mkdir(repoPath, { recursive: true });
        await fs.writeFile(path.join(repoPath, "config"), JSON.stringify(config));
    };

    it("defaults to <dataPath>/.bitsocial-cli.ipfs", () => {
        expect(resolveKuboRepoPath("some-data-path")).toBe(path.join("some-data-path", ".bitsocial-cli.ipfs"));
    });

    it("prefers $IPFS_PATH", () => {
        process.env["IPFS_PATH"] = "custom-repo";
        expect(resolveKuboRepoPath("some-data-path")).toBe("custom-repo");
    });

    it("loadKuboConfigFile reads the repo kubo actually runs from", async () => {
        const dataPath = randomDirectory();
        await writeConfig(path.join(dataPath, ".bitsocial-cli.ipfs"), { Identity: { PeerID: "default-repo" } });
        expect((await loadKuboConfigFile(dataPath))?.Identity.PeerID).toBe("default-repo");
    });

    it("loadKuboConfigFile honours $IPFS_PATH", async () => {
        const dataPath = randomDirectory();
        const customRepo = randomDirectory();
        await writeConfig(path.join(dataPath, ".bitsocial-cli.ipfs"), { Identity: { PeerID: "default-repo" } });
        await writeConfig(customRepo, { Identity: { PeerID: "custom-repo" } });
        process.env["IPFS_PATH"] = customRepo;
        expect((await loadKuboConfigFile(dataPath))?.Identity.PeerID).toBe("custom-repo");
    });

    it("loadKuboConfigFile returns undefined before kubo has been initialised", async () => {
        expect(await loadKuboConfigFile(randomDirectory())).toBeUndefined();
    });
});

// These parsers were unreachable while the config read always failed, so #200 is what puts them in
// production. Every shape kubo accepts must either parse or fall back, never crash the daemon.
describe("kubo endpoints from the kubo config", () => {
    it("parses IPv6 multiaddrs into valid URLs", async () => {
        expect((await parseMultiAddrKuboRpcToUrl("/ip6/::1/tcp/5001")).toString()).toBe("http://[::1]:5001/api/v0");
        expect((await parseMultiAddrIpfsGatewayToUrl("/ip6/::1/tcp/8080")).toString()).toBe("http://[::1]:8080/");
    });

    it("reads a single-string Addresses.API and Addresses.Gateway", async () => {
        const config = { Addresses: { API: "/ip4/127.0.0.1/tcp/5001", Gateway: "/ip4/127.0.0.1/tcp/8080" } };
        expect((await kuboRpcUrlFromKuboConfig(config))?.toString()).toBe("http://127.0.0.1:5001/api/v0");
        expect((await ipfsGatewayUrlFromKuboConfig(config))?.toString()).toBe("http://127.0.0.1:8080/");
    });

    it("takes the first usable TCP entry of an array, since kubo also accepts a list", async () => {
        const config = { Addresses: { API: ["/unix/tmp/kubo.sock", "/ip4/127.0.0.1/tcp/5001", "/ip4/127.0.0.1/tcp/5002"] } };
        expect((await kuboRpcUrlFromKuboConfig(config))?.toString()).toBe("http://127.0.0.1:5001/api/v0");
    });

    it.each([
        ["no config", undefined],
        ["no Addresses", {}],
        ["empty string", { Addresses: { API: "", Gateway: "" } }],
        ["empty array", { Addresses: { API: [], Gateway: [] } }],
        ["unix socket only", { Addresses: { API: "/unix/tmp/kubo.sock", Gateway: "/unix/tmp/gw.sock" } }]
    ])("returns undefined so the caller falls back to defaults: %s", async (_label, config) => {
        expect(await kuboRpcUrlFromKuboConfig(config)).toBeUndefined();
        expect(await ipfsGatewayUrlFromKuboConfig(config)).toBeUndefined();
    });
});
