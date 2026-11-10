// Issue #200: the daemon read its kubo config from <dataPath>/.ipfs-bitsocial-cli while kubo itself
// ran at <dataPath>/.bitsocial-cli.ipfs (or $IPFS_PATH), so the read always came back empty and the
// daemon silently fell back to env vars and defaults.
import fs from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import {
    ipfsGatewayUrlFromKuboConfig,
    kuboApiRouteUrl,
    kuboRpcUrlFromKuboConfig,
    loadKuboConfigFile,
    parseMultiAddrIpfsGatewayToUrl,
    parseMultiAddrKuboRpcToUrl,
    resolveKuboRepoPath,
    resolveKuboRpcUrl,
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

    // A first start that stopped right after `ipfs init` leaves kubo's stock config and this marker. Its 5001/8080
    // are nobody's choice, so reading them back would keep kubo there and point the daemon at whatever else holds them.
    it("loadKuboConfigFile returns undefined while the first init's defaults are still pending", async () => {
        const dataPath = randomDirectory();
        const repoPath = path.join(dataPath, ".bitsocial-cli.ipfs");
        await writeConfig(repoPath, { Addresses: { API: "/ip4/127.0.0.1/tcp/5001", Gateway: "/ip4/127.0.0.1/tcp/8080" } });
        await fs.writeFile(path.join(repoPath, ".bitsocial-cli-init-pending"), "");
        expect(await loadKuboConfigFile(dataPath)).toBeUndefined();
        const fallback = new URL("http://127.0.0.1:50019/api/v0");
        expect((await resolveKuboRpcUrl(dataPath, undefined, fallback)).toString()).toBe(fallback.toString());

        await fs.rm(path.join(repoPath, ".bitsocial-cli-init-pending"));
        expect((await resolveKuboRpcUrl(dataPath, undefined, fallback)).toString()).toBe("http://127.0.0.1:5001/api/v0");
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

describe("kuboApiRouteUrl", () => {
    it("keeps the /api/v0 prefix, which new URL(route, base) drops without a trailing slash", () => {
        expect(kuboApiRouteUrl(new URL("http://127.0.0.1:5001/api/v0"), "version").toString()).toBe("http://127.0.0.1:5001/api/v0/version");
        expect(kuboApiRouteUrl(new URL("http://127.0.0.1:5001/api/v0/"), "version").toString()).toBe("http://127.0.0.1:5001/api/v0/version");
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
    const describeApi = (configured: unknown, chosen: string) =>
        describeKuboEndpointMismatch({
            envVar: "KUBO_RPC_URL",
            configField: "Addresses.API",
            configPath,
            configured,
            chosen: new URL(chosen)
        });
    const chosen = "http://127.0.0.1:5001/api/v0";

    it("says nothing before kubo has a config, or when the API is disabled or a unix socket", async () => {
        expect(await describeApi(undefined, chosen)).toBeUndefined();
        expect(await describeApi("", chosen)).toBeUndefined();
        expect(await describeApi([], chosen)).toBeUndefined();
        expect(await describeApi("/unix/tmp/kubo-api.sock", chosen)).toBeUndefined();
    });

    it("says nothing when the env override reaches the configured listener", async () => {
        expect(await describeApi("/ip4/127.0.0.1/tcp/5001", chosen)).toBeUndefined();
        expect(await describeApi("/ip6/::1/tcp/5001", "http://[::1]:5001/api/v0")).toBeUndefined();
    });

    it("treats a wildcard bind as reachable on any host with that port", async () => {
        for (const bind of ["/ip4/0.0.0.0/tcp/5001", "/ip6/::/tcp/5001"]) {
            expect(await describeApi(bind, chosen)).toBeUndefined();
            expect(await describeApi(bind, "http://[::1]:5001/api/v0")).toBeUndefined();
            expect(await describeApi(bind, "http://192.168.1.10:5001/api/v0")).toBeUndefined();
            // What the Docker image's ENV writes on first init, and then keeps dialling.
            expect(await describeApi(bind, "http://0.0.0.0:5001/api/v0")).toBeUndefined();
        }
        expect(await describeApi("/ip4/0.0.0.0/tcp/5001", "http://192.168.1.10:5002/api/v0")).toContain(
            "KUBO_RPC_URL is http://192.168.1.10:5002/api/v0"
        );
    });

    it("accepts localhost for a loopback listener, and a localhost bind for a loopback literal", async () => {
        expect(await describeApi("/ip4/127.0.0.1/tcp/5001", "http://localhost:5001/api/v0")).toBeUndefined();
        expect(await describeApi("/ip6/::1/tcp/5001", "http://localhost:5001/api/v0")).toBeUndefined();
        expect(await describeApi("/dns4/localhost/tcp/5001", chosen)).toBeUndefined();
    });

    it("checks every entry when Addresses.API is a list, since kubo listens on all of them", async () => {
        const list = ["/ip4/127.0.0.1/tcp/5001", "/ip4/127.0.0.1/tcp/5002"];
        expect(await describeApi(list, "http://127.0.0.1:5002/api/v0")).toBeUndefined();
        expect(await describeApi(list, "http://127.0.0.1:5003/api/v0")).toContain(
            'Addresses.API in /data/.bitsocial-cli.ipfs/config is ["/ip4/127.0.0.1/tcp/5001","/ip4/127.0.0.1/tcp/5002"].'
        );
    });

    it("says nothing for a DNS name it cannot judge offline", async () => {
        expect(await describeApi("/ip4/127.0.0.1/tcp/5001", "http://host.docker.internal:5001/api/v0")).toBeUndefined();
    });

    it("names the env var, the config field and the configured value when the ports differ", async () => {
        const message = await describeApi("/ip4/127.0.0.1/tcp/5001", "http://127.0.0.1:5002/api/v0");
        expect(message).toBe(
            "KUBO_RPC_URL is http://127.0.0.1:5002/api/v0 but Addresses.API in /data/.bitsocial-cli.ipfs/config is /ip4/127.0.0.1/tcp/5001. " +
                "The daemon starts kubo from that config and dials KUBO_RPC_URL, so it will not reach kubo. " +
                "Unset KUBO_RPC_URL to follow the config, or edit Addresses.API to match."
        );
    });

    it("warns when only the host differs", async () => {
        expect(await describeApi("/ip4/127.0.0.1/tcp/5001", "http://192.168.1.10:5001/api/v0")).toContain(
            "KUBO_RPC_URL is http://192.168.1.10:5001/api/v0"
        );
    });

    it("warns when the env override uses https, since kubo serves plain http", async () => {
        expect(await describeApi("/ip4/127.0.0.1/tcp/5001", "https://localhost:5001/api/v0")).toContain(
            "KUBO_RPC_URL is https://localhost:5001/api/v0"
        );
    });

    it("still warns when the IP families of two loopback literals differ", async () => {
        // A kubo bound on /ip4/127.0.0.1 refuses a dial to [::1].
        expect(await describeApi("/ip4/127.0.0.1/tcp/5001", "http://[::1]:5001/api/v0")).toContain(
            "KUBO_RPC_URL is http://[::1]:5001/api/v0"
        );
    });

    it("treats a URL without a port as the scheme default", async () => {
        expect(
            await describeKuboEndpointMismatch({
                envVar: "IPFS_GATEWAY_URL",
                configField: "Addresses.Gateway",
                configPath,
                configured: "/ip4/127.0.0.1/tcp/80",
                chosen: new URL("http://127.0.0.1/")
            })
        ).toBeUndefined();
    });
});
