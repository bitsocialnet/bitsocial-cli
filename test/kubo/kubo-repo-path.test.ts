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
    resolveKuboRepoPath,
    toConnectableHostname,
    describeKuboEndpointMismatch
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

    // A wildcard bind address says where kubo listens, not what a client can dial: macOS refuses
    // connect() to 0.0.0.0 (commit 4652547). These URLs go to pkc-js and the GC scheduler as they
    // are, so they must already be on loopback.
    it.each([
        ["/ip4/0.0.0.0/tcp/5001", "http://127.0.0.1:5001/api/v0"],
        ["/ip6/::/tcp/5001", "http://[::1]:5001/api/v0"]
    ])("maps the wildcard bind %s to a loopback RPC URL", async (multiAddr, expected) => {
        expect((await parseMultiAddrKuboRpcToUrl(multiAddr)).toString()).toBe(expected);
    });

    it.each([
        ["/ip4/0.0.0.0/tcp/8080", "http://127.0.0.1:8080/"],
        ["/ip6/::/tcp/8080", "http://[::1]:8080/"]
    ])("maps the wildcard bind %s to a loopback gateway URL", async (multiAddr, expected) => {
        expect((await parseMultiAddrIpfsGatewayToUrl(multiAddr)).toString()).toBe(expected);
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

// A URL keeps IPv6 hosts in brackets, but sockets need them bare.
describe("toConnectableHostname", () => {
    it.each([
        ["0.0.0.0", "127.0.0.1"],
        ["127.0.0.1", "127.0.0.1"],
        ["localhost", "localhost"],
        ["::", "::1"],
        ["[::]", "::1"],
        ["[::1]", "::1"],
        ["::1", "::1"],
        ["[2001:db8::7]", "2001:db8::7"]
    ])("%s connects via %s", (hostname, expected) => {
        expect(toConnectableHostname(hostname)).toBe(expected);
    });

    it("gives a hostname a socket can connect to from an IPv6 kubo config", async () => {
        const url = await kuboRpcUrlFromKuboConfig({ Addresses: { API: "/ip6/::1/tcp/5001" } });
        expect(toConnectableHostname(url!.hostname)).toBe("::1");
    });
});

// For a locally managed kubo the daemon never rewrites Addresses.* of an existing repo, so an env
// override that differs from the config leaves kubo on one port and the daemon dialling another.
describe("describeKuboEndpointMismatch", () => {
    const configPath = "/data/.bitsocial-cli.ipfs/config";
    const describeApi = (configured: URL | undefined, chosen: URL) =>
        describeKuboEndpointMismatch({ envVar: "KUBO_RPC_URL", configField: "Addresses.API", configPath, configured, chosen });

    it("says nothing before kubo has a config", () => {
        expect(describeApi(undefined, new URL("http://127.0.0.1:5001/api/v0"))).toBeUndefined();
    });

    it("says nothing when the env override reaches the configured listener", () => {
        expect(describeApi(new URL("http://127.0.0.1:5001/api/v0"), new URL("http://127.0.0.1:5001/api/v0"))).toBeUndefined();
        // Bound on the wildcard, reached over loopback.
        expect(describeApi(new URL("http://0.0.0.0:5001/api/v0"), new URL("http://127.0.0.1:5001/api/v0"))).toBeUndefined();
        expect(describeApi(new URL("http://[::]:5001/api/v0"), new URL("http://[::1]:5001/api/v0"))).toBeUndefined();
    });

    it("accepts localhost for a loopback or wildcard listener", () => {
        expect(describeApi(new URL("http://127.0.0.1:5001/api/v0"), new URL("http://localhost:5001/api/v0"))).toBeUndefined();
        expect(describeApi(new URL("http://[::1]:5001/api/v0"), new URL("http://localhost:5001/api/v0"))).toBeUndefined();
        expect(describeApi(new URL("http://0.0.0.0:5001/api/v0"), new URL("http://localhost:5001/api/v0"))).toBeUndefined();
        expect(describeApi(new URL("http://localhost:5001/api/v0"), new URL("http://127.0.0.1:5001/api/v0"))).toBeUndefined();
    });

    it("still warns when the IP families of two loopback literals differ", () => {
        // A kubo bound on /ip4/127.0.0.1 refuses a dial to [::1].
        expect(describeApi(new URL("http://127.0.0.1:5001/api/v0"), new URL("http://[::1]:5001/api/v0"))).toContain(
            "KUBO_RPC_URL is http://[::1]:5001/api/v0"
        );
    });

    it("names the env var, the config field and both URLs when the ports differ", () => {
        const message = describeApi(new URL("http://127.0.0.1:5001/api/v0"), new URL("http://127.0.0.1:5002/api/v0"));
        expect(message).toBe(
            "KUBO_RPC_URL is http://127.0.0.1:5002/api/v0 but Addresses.API in /data/.bitsocial-cli.ipfs/config is http://127.0.0.1:5001/api/v0. " +
                "The daemon starts kubo from that config and dials KUBO_RPC_URL, so it will not reach kubo. " +
                "Unset KUBO_RPC_URL to follow the config, or edit Addresses.API to match."
        );
    });

    it("warns when only the host differs", () => {
        expect(describeApi(new URL("http://127.0.0.1:5001/api/v0"), new URL("http://192.168.1.10:5001/api/v0"))).toContain(
            "KUBO_RPC_URL is http://192.168.1.10:5001/api/v0"
        );
    });

    it("treats a URL without a port as the scheme default", () => {
        expect(
            describeKuboEndpointMismatch({
                envVar: "IPFS_GATEWAY_URL",
                configField: "Addresses.Gateway",
                configPath,
                configured: new URL("http://127.0.0.1:80/"),
                chosen: new URL("http://127.0.0.1/")
            })
        ).toBeUndefined();
    });
});
