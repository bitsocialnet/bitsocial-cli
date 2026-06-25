import { describe, it, expect } from "vitest";
import { file as tempFile } from "tempy";
import * as fs from "fs/promises";
import path from "path";
import { mergeCliDefaultsIntoIpfsConfig, ensureIpnsPubsubEnabled } from "../../src/ipfs/startIpfs.js";

const noopLog = () => {
    /* no-op for tests */
};

const writeConfigToTempFile = async (config: Record<string, any>) => {
    const filepath = tempFile({ name: "ipfs-config.json" });
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(config, null, 2), "utf-8");
    return filepath;
};

describe("mergeCliDefaultsIntoIpfsConfig", () => {
    it("overrides core defaults on freshly initialized config", async () => {
        const kuboDefaultSwarm = [
            "/ip4/0.0.0.0/tcp/4001",
            "/ip6/::/tcp/4001",
            "/ip4/0.0.0.0/udp/4001/webrtc-direct",
            "/ip4/0.0.0.0/udp/4001/quic-v1",
            "/ip4/0.0.0.0/udp/4001/quic-v1/webtransport",
            "/ip6/::/udp/4001/webrtc-direct",
            "/ip6/::/udp/4001/quic-v1",
            "/ip6/::/udp/4001/quic-v1/webtransport"
        ];
        const initialConfig = {
            Addresses: {
                Swarm: kuboDefaultSwarm,
                Gateway: "/ip4/0.0.0.0/tcp/8080"
            }
        };
        const configPath = await writeConfigToTempFile(initialConfig);

        await mergeCliDefaultsIntoIpfsConfig(noopLog, configPath, new URL("http://127.0.0.1:5001"), new URL("http://127.0.0.1:8080"));

        const mergedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
        expect(mergedConfig.Addresses.API).toBe("/ip4/127.0.0.1/tcp/5001");
        expect(mergedConfig.Addresses.Gateway).toBe("/ip4/127.0.0.1/tcp/8080");
        expect(mergedConfig.Addresses.Swarm).toEqual(kuboDefaultSwarm);
        expect(mergedConfig.AutoTLS.Enabled).toBe(true);
    });

    it("preserves user configured gateway settings while disabling subdomain redirects", async () => {
        const initialConfig = {
            Gateway: {
                NoFetch: true,
                PublicGateways: {
                    "example.com": {
                        Paths: ["/ipfs"],
                        UseSubdomains: true
                    }
                }
            }
        };
        const configPath = await writeConfigToTempFile(initialConfig);

        await mergeCliDefaultsIntoIpfsConfig(noopLog, configPath, new URL("http://10.0.0.2:4001"), new URL("http://10.0.0.2:8081"));

        const mergedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
        expect(mergedConfig.Gateway.NoFetch).toBe(true);

        const exampleGateway = mergedConfig.Gateway.PublicGateways["example.com"];
        expect(exampleGateway.Paths).toEqual(["/ipfs"]);
        expect(exampleGateway.UseSubdomains).toBe(false);
    });

    it("adds gateway entries for target hostnames and keeps existing metadata", async () => {
        const initialConfig = {
            Gateway: {
                PublicGateways: {
                    localhost: {
                        Paths: ["/ipns"],
                        InlineDNSLink: true,
                        UseSubdomains: true
                    }
                }
            }
        };
        const configPath = await writeConfigToTempFile(initialConfig);

        await mergeCliDefaultsIntoIpfsConfig(noopLog, configPath, new URL("http://192.168.1.5:5001"), new URL("http://custom.host:8080"));

        const mergedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
        const localhostGateway = mergedConfig.Gateway.PublicGateways["localhost"];
        expect(localhostGateway.Paths).toEqual(["/ipns"]);
        expect(localhostGateway.InlineDNSLink).toBe(true);
        expect(localhostGateway.UseSubdomains).toBe(false);

        expect(mergedConfig.Gateway.PublicGateways["custom.host"]).toMatchObject({ UseSubdomains: false });
        expect(mergedConfig.Gateway.PublicGateways["127.0.0.1"]).toMatchObject({ UseSubdomains: false });
    });
});

describe("ensureIpnsPubsubEnabled", () => {
    it("sets Ipns.UsePubsub on a config that has no Ipns section", async () => {
        const configPath = await writeConfigToTempFile({ Addresses: { Gateway: "/ip4/0.0.0.0/tcp/8080" } });

        await ensureIpnsPubsubEnabled(noopLog, configPath);

        const updated = JSON.parse(await fs.readFile(configPath, "utf-8"));
        expect(updated.Ipns.UsePubsub).toBe(true);
        // unrelated config is preserved
        expect(updated.Addresses.Gateway).toBe("/ip4/0.0.0.0/tcp/8080");
    });

    it("preserves existing Ipns settings while enabling UsePubsub", async () => {
        const configPath = await writeConfigToTempFile({ Ipns: { RepublishPeriod: "1h", UsePubsub: false } });

        await ensureIpnsPubsubEnabled(noopLog, configPath);

        const updated = JSON.parse(await fs.readFile(configPath, "utf-8"));
        expect(updated.Ipns.UsePubsub).toBe(true);
        expect(updated.Ipns.RepublishPeriod).toBe("1h");
    });

    it("is a no-op (no rewrite) when already enabled", async () => {
        const configPath = await writeConfigToTempFile({ Ipns: { UsePubsub: true } });
        const before = await fs.readFile(configPath, "utf-8");

        await ensureIpnsPubsubEnabled(noopLog, configPath);

        const after = await fs.readFile(configPath, "utf-8");
        expect(after).toBe(before);
    });
});
