import fs from "fs/promises";
import path from "path";
import { directory as randomDirectory } from "tempy";
import { describe, expect, it } from "vitest";
import { DECLINE_RECORDED_MESSAGE, disableReachability, PURGE_DECLINE_MESSAGE, purgeReachability } from "../../src/reachability/lifecycle.js";
import { isReachabilityDeclined, writeReachabilityConfig, type ReachabilityConfig } from "../../src/reachability/state.js";

// A disabled config, so disable has no kubo to change and no Caddy to stop.
const disabledConfig = (): ReachabilityConfig => ({
    version: 1,
    enabled: false,
    mode: "ip",
    wsPort: 4002,
    announce: [],
    publicIps: [],
    staging: false,
    acmeDirectory: "https://acme-staging-v02.api.letsencrypt.org/directory",
    caddyAdminPort: 1
});

const prepare = async () => {
    const dataPath = randomDirectory();
    const kuboRepoPath = path.join(dataPath, "repo");
    await fs.mkdir(kuboRepoPath, { recursive: true });
    const kuboConfig = JSON.stringify({ Addresses: { Swarm: [], AppendAnnounce: [] }, Swarm: {} });
    await fs.writeFile(path.join(kuboRepoPath, "config"), kuboConfig);
    const logs: string[] = [];
    const options = { dataPath, kuboRepoPath, kuboRpcUrl: new URL("http://127.0.0.1:1/api/v0"), log: (message: string) => logs.push(message), caddyStopGraceMs: 0 };
    const kuboUnchanged = async () => expect(await fs.readFile(path.join(kuboRepoPath, "config"), "utf-8")).toBe(kuboConfig);
    return { dataPath, options, logs, kuboUnchanged };
};

describe("declining reachability (#225)", () => {
    it("disable records the decline on a node that was never set up, and leaves kubo alone", async () => {
        const { dataPath, options, logs, kuboUnchanged } = await prepare();
        await disableReachability(options);
        expect(await isReachabilityDeclined(dataPath)).toBe(true);
        expect(logs).toEqual([DECLINE_RECORDED_MESSAGE]);
        expect(DECLINE_RECORDED_MESSAGE).toContain("bitsocial reachability setup");
        await kuboUnchanged();
    });

    it("says so when the node already declined", async () => {
        const { options, logs } = await prepare();
        await disableReachability(options);
        await disableReachability(options);
        expect(logs.at(-1)).toBe("Reachability is already declined.");
    });

    it("records no decline when a config exists, which is already a decision", async () => {
        const { dataPath, options } = await prepare();
        await writeReachabilityConfig(dataPath, disabledConfig());
        await disableReachability(options);
        expect(await isReachabilityDeclined(dataPath)).toBe(false);
    });

    it("keeps the decline through --purge", async () => {
        const { dataPath, options } = await prepare();
        await disableReachability(options);
        await purgeReachability(options);
        expect(await isReachabilityDeclined(dataPath)).toBe(true);
    });

    it("records a decline when --purge removes a config, so the daemon does not start reminding", async () => {
        const { dataPath, options, logs } = await prepare();
        await writeReachabilityConfig(dataPath, disabledConfig());
        await purgeReachability(options);
        expect(await fs.readdir(dataPath)).not.toContain("reachability");
        expect(await isReachabilityDeclined(dataPath)).toBe(true);
        expect(logs).toContain(PURGE_DECLINE_MESSAGE);
    });
});
