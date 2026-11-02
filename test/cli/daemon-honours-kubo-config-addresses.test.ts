// Regression tests for issue #200: an operator who edits Addresses.API / Addresses.Gateway in the kubo
// config must get a daemon that talks to those ports. An explicit KUBO_RPC_URL / IPFS_GATEWAY_URL still
// wins, because it can legitimately name a kubo other than the one in this data path's repo.
//
// "Communities in data path" is printed whether or not pkc-js can reach kubo, so readiness and the
// printed options prove nothing about which kubo the daemon uses. Each test therefore creates a
// community through the daemon: pkc-js imports the started community's signer into kubo as an IPNS
// key named after the community address (`key/import`), so the key list of a kubo says whether the
// daemon talked to it.
import { spawn, type ChildProcess } from "child_process";
import dns from "node:dns";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { path as resolveKuboBinary } from "kubo";
import defaults from "../../src/common-utils/defaults.js";
import { ensureIpnsPubsubEnabled, ensureKuboRoutingConfigMatchesHttpRouters } from "../../src/ipfs/startIpfs.js";
import {
    ensureKuboNodeStopped,
    isAddressInUseError,
    killChildProcess,
    waitForCondition,
    waitForKuboReady,
    withKuboBindRetry
} from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";

dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

const READY_TIMEOUT_MS = 90_000;

const runCli = (args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", ...args], { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error(`Command timed out after ${timeoutMs}ms: bitsocial ${args.join(" ")}\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, timeoutMs);
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });

// `community create` starts the community and prints its address last.
const createCommunityThroughDaemon = async (rpcWsUrl: string): Promise<string> => {
    const result = await runCli(["community", "create", "--description", "issue 200 regression", "--pkcRpcUrl", rpcWsUrl], 90_000);
    expect(result.exitCode, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
    const address = result.stdout.trim().split("\n").pop() ?? "";
    expect(address, `community create printed no address:\n${result.stdout}`).not.toBe("");
    return address;
};

const kuboKeyNames = async (kuboApiUrl: string): Promise<string[]> => {
    const response = await fetch(`${kuboApiUrl}/key/list`, { method: "POST" });
    expect(response.ok, `${kuboApiUrl}/key/list returned HTTP ${response.status}`).toBe(true);
    const body = (await response.json()) as { Keys: { Name: string }[] };
    return body.Keys.map((key) => key.Name);
};

const isKuboListening = async (kuboApiUrl: string): Promise<boolean> => {
    try {
        return (await fetch(`${kuboApiUrl}/version`, { method: "POST" })).ok;
    } catch {
        return false;
    }
};

type DaemonHandle = {
    dataPath: string;
    rpcWsUrl: string;
    configApiPort: number;
    configGatewayPort: number;
    // Client-side URL of the kubo described by the repo's config, reachable whatever host it binds.
    configKuboApiUrl: string;
    output: () => string;
    waitForReady: () => Promise<string>;
};

describe("kubo endpoint precedence (issue #200)", () => {
    let daemon: ChildProcess | undefined;
    let standaloneKubo: ChildProcess | undefined;
    const kuboApiUrlsToStop: string[] = [];

    afterEach(async () => {
        await killChildProcess(daemon);
        await killChildProcess(standaloneKubo);
        for (const url of kuboApiUrlsToStop.splice(0)) await ensureKuboNodeStopped(url);
        daemon = undefined;
        standaloneKubo = undefined;
    }, 60_000);

    // A kubo the daemon did not start, standing in for an operator-run kubo named by KUBO_RPC_URL.
    // Its Routing and Ipns config are pre-seeded the way the daemon seeds its own kubo, so pkc-js
    // finds nothing to change on connect and does not shut it down (issue #143).
    const startStandaloneKubo = async (apiUrl: URL, gatewayUrl: URL): Promise<ChildProcess> => {
        const repoPath = randomDirectory();
        await preInitKuboWithEphemeralSwarm(repoPath, apiUrl, gatewayUrl);
        const configPath = path.join(repoPath, "config");
        const silent = Object.assign(() => {}, { error: () => {}, trace: () => {} });
        await ensureIpnsPubsubEnabled(silent, configPath);
        await ensureKuboRoutingConfigMatchesHttpRouters(silent, configPath, defaults.HTTP_TRACKERS);
        const child = spawn(await resolveKuboBinary(), ["daemon"], {
            env: { ...process.env, IPFS_PATH: repoPath },
            stdio: ["ignore", "pipe", "pipe"]
        });
        let output = "";
        child.stdout!.on("data", (data: Buffer) => (output += data.toString()));
        child.stderr!.on("data", (data: Buffer) => (output += data.toString()));
        const clientUrl = `http://127.0.0.1:${apiUrl.port}/api/v0`;
        kuboApiUrlsToStop.push(clientUrl);
        const ready = await waitForKuboReady(clientUrl, 60_000);
        if (!ready) {
            await killChildProcess(child);
            // Let withKuboBindRetry pick new ports if kubo lost the bind race.
            throw new Error(isAddressInUseError(output) ? output : `standalone kubo never became ready:\n${output}`);
        }
        return child;
    };

    // Pre-inits the repo under dataPath with Addresses.API / Addresses.Gateway on `bindHost`, then
    // starts the daemon with no KUBO_RPC_URL / IPFS_GATEWAY_URL / IPFS_PATH from the outer
    // environment, plus `env` on top.
    const startDaemon = async ({ bindHost = "127.0.0.1", env = {} }: { bindHost?: string; env?: Record<string, string> } = {}) => {
        const { result } = await withKuboBindRetry(
            async (endpoints): Promise<DaemonHandle> => {
                const dataPath = randomDirectory();
                const configApiPort = endpoints.kuboPort;
                const configGatewayPort = endpoints.gatewayPort;
                await preInitKuboWithEphemeralSwarm(
                    path.join(dataPath, ".bitsocial-cli.ipfs"),
                    new URL(`http://${bindHost}:${configApiPort}/api/v0`),
                    new URL(`http://${bindHost}:${configGatewayPort}`)
                );
                const configKuboApiUrl = `http://127.0.0.1:${configApiPort}/api/v0`;
                kuboApiUrlsToStop.push(configKuboApiUrl);
                const { KUBO_RPC_URL: _kubo, IPFS_GATEWAY_URL: _gateway, IPFS_PATH: _repo, ...inheritedEnv } = process.env;
                const child = spawn(
                    "node",
                    [
                        "./bin/run",
                        "daemon",
                        "--logPath",
                        randomDirectory(),
                        "--pkcOptions.dataPath",
                        dataPath,
                        "--pkcRpcUrl",
                        endpoints.rpcWsUrl
                    ],
                    { stdio: ["pipe", "pipe", "pipe"], env: { ...inheritedEnv, ...env } }
                );
                daemon = child;
                let output = "";
                child.stdout!.on("data", (data: Buffer) => (output += data.toString()));
                child.stderr!.on("data", (data: Buffer) => (output += data.toString()));
                const waitForReady = async () => {
                    const ready = await waitForCondition(
                        () => output.includes("Communities in data path") || child.exitCode !== null,
                        READY_TIMEOUT_MS,
                        250
                    );
                    if (child.exitCode !== null) throw new Error(`daemon exited with code ${child.exitCode}:\n${output}`);
                    expect(ready, `daemon never became ready:\n${output}`).toBe(true);
                    return output.slice(output.indexOf("PKC options:"));
                };
                return {
                    dataPath,
                    rpcWsUrl: endpoints.rpcWsUrl,
                    configApiPort,
                    configGatewayPort,
                    configKuboApiUrl,
                    output: () => output,
                    waitForReady
                };
            },
            { cleanup: async () => killChildProcess(daemon) }
        );
        return result;
    };

    it("uses Addresses.API and Addresses.Gateway over the built-in defaults", { timeout: 180_000 }, async () => {
        const handle = await startDaemon();
        const options = await handle.waitForReady();
        expect(options).toContain(`Kubo IPFS API listening on: ${handle.configKuboApiUrl}`);
        expect(options).toContain(`Kubo IPFS Gateway listening on: http://127.0.0.1:${handle.configGatewayPort}`);

        const address = await createCommunityThroughDaemon(handle.rpcWsUrl);
        expect(await kuboKeyNames(handle.configKuboApiUrl), "the community key did not land in the kubo from the config").toContain(
            address
        );
    });

    it("lets an explicit KUBO_RPC_URL and IPFS_GATEWAY_URL win over the kubo config", { timeout: 180_000 }, async () => {
        const { result: envKubo, endpoints: envEndpoints } = await withKuboBindRetry((endpoints) =>
            startStandaloneKubo(new URL(endpoints.kuboRpcUrl), new URL(endpoints.gatewayUrl))
        );
        standaloneKubo = envKubo;
        const envKuboApiUrl = `http://127.0.0.1:${envEndpoints.kuboPort}/api/v0`;

        const handle = await startDaemon({
            env: { KUBO_RPC_URL: envKuboApiUrl, IPFS_GATEWAY_URL: `http://127.0.0.1:${envEndpoints.gatewayPort}` }
        });
        const options = await handle.waitForReady();
        expect(options).toContain(envKuboApiUrl);
        expect(options).not.toContain(handle.configKuboApiUrl);

        const address = await createCommunityThroughDaemon(handle.rpcWsUrl);
        expect(await kuboKeyNames(envKuboApiUrl), "the community key did not land in the kubo named by KUBO_RPC_URL").toContain(address);
        // The daemon adopted the running kubo instead of starting the one described by the config.
        expect(await isKuboListening(handle.configKuboApiUrl), "the daemon started the kubo from the config anyway").toBe(false);
    });

    // Linux connects to 0.0.0.0 as loopback, so a wildcard URL handed to pkc-js works there by
    // accident. macOS refuses it (commit 4652547), which is why the daemon's own checks go through
    // toConnectableHostname. pkc-js and the GC scheduler must get a dialable URL too.
    it.skipIf(process.platform !== "darwin")(
        "connects pkc-js to a kubo whose config binds the wildcard address (macOS)",
        { timeout: 180_000 },
        async () => {
            const handle = await startDaemon({ bindHost: "0.0.0.0" });
            await handle.waitForReady();

            const address = await createCommunityThroughDaemon(handle.rpcWsUrl);
            expect(await kuboKeyNames(handle.configKuboApiUrl), "the community key did not land in kubo").toContain(address);
        }
    );
});
