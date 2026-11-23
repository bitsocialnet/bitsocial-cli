// The defaults bitsocial-cli gives a new kubo repo (server profile, its API and gateway addresses, AutoTLS) hung
// on whether `ipfs init` succeeded in the same run. A first start that stopped after the init left kubo's stock
// config on disk, and every later start took that for the operator's own config and kept it.
import fs from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directory as randomDirectory } from "tempy";
import { initKuboRepoIfNeeded } from "../../src/ipfs/startIpfs.js";
import { ensureKuboRepo, resolveNodePaths } from "../../src/reachability/cli-support.js";
import { ipfsGatewayUrlFromKuboConfig, loadKuboConfigFile, resolveKuboRpcUrl } from "../../src/util.js";

const kubo = vi.hoisted(() => ({ binaryOverride: undefined as string | undefined }));
vi.mock("kubo", async (importOriginal) => {
    const real = await importOriginal<typeof import("kubo")>();
    return { ...real, path: () => kubo.binaryOverride ?? real.path() };
});

const log = Object.assign(() => {}, { trace: () => {}, error: () => {} });
const apiUrl = new URL("http://127.0.0.1:50999/api/v0");
const gatewayUrl = new URL("http://127.0.0.1:50998");

// Runs the real kubo for `ipfs init`, then fails the next step the way a crash or Ctrl+C there would end the run
const writeKuboThatStopsAfterInit = async () => {
    const realKubo = (await vi.importActual<typeof import("kubo")>("kubo")).path();
    const wrapper = path.join(randomDirectory(), "ipfs");
    await fs.writeFile(
        wrapper,
        `#!/bin/sh\nif [ "$1" = "config" ]; then echo "stopped after ipfs init" >&2; exit 1; fi\nexec '${realKubo}' "$@"\n`,
        { mode: 0o755 }
    );
    return wrapper;
};

// The endpoints a start with no flags or env passes to initKuboRepoIfNeeded: the daemon and `reachability` read the
// repo's Addresses.API / Addresses.Gateway back first and fall back to the defaults only without them.
const endpointsTheNextStartPicks = async (dataPath: string) => ({
    api: await resolveKuboRpcUrl(dataPath, undefined, apiUrl),
    gateway: (await ipfsGatewayUrlFromKuboConfig(await loadKuboConfigFile(dataPath))) ?? gatewayUrl
});

const readConfig = async (dataPath: string) => JSON.parse(await fs.readFile(path.join(dataPath, ".bitsocial-cli.ipfs", "config"), "utf-8"));

describe.skipIf(process.platform === "win32")("kubo first-init defaults", () => {
    let previousIpfsPath: string | undefined;

    beforeEach(() => {
        previousIpfsPath = process.env["IPFS_PATH"];
        delete process.env["IPFS_PATH"];
    });

    afterEach(() => {
        kubo.binaryOverride = undefined;
        if (previousIpfsPath === undefined) delete process.env["IPFS_PATH"];
        else process.env["IPFS_PATH"] = previousIpfsPath;
    });

    it("are applied on the next start when the first one stopped right after `ipfs init`", { timeout: 60_000 }, async () => {
        const dataPath = randomDirectory();
        kubo.binaryOverride = await writeKuboThatStopsAfterInit();
        await expect(initKuboRepoIfNeeded(log, dataPath, apiUrl, gatewayUrl)).rejects.toThrow();
        expect((await readConfig(dataPath)).Addresses.API, "precondition: kubo's stock config is on disk").toBe("/ip4/127.0.0.1/tcp/5001");

        kubo.binaryOverride = undefined;
        // Kubo's stock 5001/8080 are nobody's choice, so the next start must not read them back and keep them
        const next = await endpointsTheNextStartPicks(dataPath);
        expect(next.api.toString()).toBe(apiUrl.toString());
        expect(next.gateway.toString()).toBe(gatewayUrl.toString());
        await initKuboRepoIfNeeded(log, dataPath, next.api, next.gateway);

        const config = await readConfig(dataPath);
        expect(config.Addresses.API).toBe("/ip4/127.0.0.1/tcp/50999");
        expect(config.Addresses.Gateway).toBe("/ip4/127.0.0.1/tcp/50998");
        expect(config.AutoTLS.Enabled).toBe(true);
        expect(config.Swarm.DisableNatPortMap, "server profile").toBe(true);
    });

    // `reachability setup` and `enable` can be the next command run on the repo, before any daemon start
    it("are applied by reachability's repo check when it runs first", { timeout: 60_000 }, async () => {
        const dataPath = randomDirectory();
        kubo.binaryOverride = await writeKuboThatStopsAfterInit();
        await expect(initKuboRepoIfNeeded(log, dataPath, apiUrl, gatewayUrl)).rejects.toThrow();
        kubo.binaryOverride = undefined;

        const paths = await resolveNodePaths(dataPath);
        await ensureKuboRepo(paths.dataPath, paths.kuboRpcUrl);

        const config = await readConfig(dataPath);
        expect(config.Addresses.API).not.toBe("/ip4/127.0.0.1/tcp/5001");
        expect(config.Addresses.API).toBe(`/ip4/${paths.kuboRpcUrl.hostname}/tcp/${paths.kuboRpcUrl.port}`);
        expect(config.Swarm.DisableNatPortMap, "server profile").toBe(true);
        expect(await fs.readdir(path.join(dataPath, ".bitsocial-cli.ipfs"))).not.toContain(".bitsocial-cli-init-pending");
    });

    it("are not applied again once a start has finished them", { timeout: 60_000 }, async () => {
        const dataPath = randomDirectory();
        await initKuboRepoIfNeeded(log, dataPath, apiUrl, gatewayUrl);
        const configPath = path.join(dataPath, ".bitsocial-cli.ipfs", "config");
        const config = await readConfig(dataPath);
        config.Addresses.API = "/ip4/127.0.0.1/tcp/41234";
        await fs.writeFile(configPath, JSON.stringify(config, null, 4));

        await initKuboRepoIfNeeded(log, dataPath, apiUrl, gatewayUrl);

        expect((await readConfig(dataPath)).Addresses.API).toBe("/ip4/127.0.0.1/tcp/41234");
        expect(await fs.readdir(path.join(dataPath, ".bitsocial-cli.ipfs"))).not.toContain(".bitsocial-cli-init-pending");
    });
});
