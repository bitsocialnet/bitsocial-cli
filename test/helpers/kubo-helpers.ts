import * as fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { path as resolveKuboBinary } from "kubo";
import { mergeCliDefaultsIntoIpfsConfig } from "../../src/ipfs/startIpfs.js";

const execFileAsync = promisify(execFile);

const EPHEMERAL_SWARM_ADDRESSES = [
    "/ip4/0.0.0.0/tcp/0",
    "/ip6/::/tcp/0",
    "/ip4/0.0.0.0/udp/0/quic-v1",
    "/ip4/0.0.0.0/udp/0/quic-v1/webtransport",
    "/ip6/::/udp/0/quic-v1",
    "/ip6/::/udp/0/quic-v1/webtransport"
];

// Pre-init a kubo repo so each parallel test daemon gets its own kernel-assigned
// swarm port instead of fighting over the default 4001. Mirrors what
// startKuboNode does on a fresh config (init + server profile + merge defaults),
// then overrides Swarm to ephemeral addresses. When the bitsocial daemon later
// runs `ipfs init` against this dir it'll bail with "configuration file already
// exists", skip mergeCliDefaultsIntoIpfsConfig, and spawn kubo with our Swarm.
//
// Idempotent: if a config already exists (e.g. a retry reusing a seeded dataPath
// after a port-bind race), skip `ipfs init`/profile apply but re-apply the API,
// Gateway and Swarm addresses so the freshly allocated ports take effect. This lets
// startPkcDaemonWithDynamicPorts retry with new ports without `ipfs init` throwing
// "ipfs configuration file already exists!".
export const preInitKuboWithEphemeralSwarm = async (ipfsDataPath: string, apiUrl: URL, gatewayUrl: URL) => {
    await fs.mkdir(ipfsDataPath, { recursive: true });
    const kuboBinaryPath = await resolveKuboBinary();
    const env = { ...process.env, IPFS_PATH: ipfsDataPath };
    const configPath = path.join(ipfsDataPath, "config");

    const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);

    if (!configExists) {
        await execFileAsync(kuboBinaryPath, ["init"], { env });
        await execFileAsync(kuboBinaryPath, ["config", "profile", "apply", "server"], { env });
    }

    // Always (re-)apply API/Gateway addresses for the requested ports, then pin Swarm ephemeral.
    await mergeCliDefaultsIntoIpfsConfig(() => {}, configPath, apiUrl, gatewayUrl);

    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    config.Addresses = { ...(config.Addresses ?? {}), Swarm: EPHEMERAL_SWARM_ADDRESSES };
    await fs.writeFile(configPath, JSON.stringify(config, null, 4));
};
