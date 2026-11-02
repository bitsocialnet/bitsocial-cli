// Regression test for issue #200: an operator who edits Addresses.API / Addresses.Gateway in the kubo
// config must get a daemon that talks to those ports. An explicit KUBO_RPC_URL / IPFS_GATEWAY_URL still
// wins, because it can legitimately name a kubo other than the one in this data path's repo.
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, killChildProcess, waitForCondition } from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";

describe("kubo endpoint precedence (issue #200)", () => {
    let daemon: ChildProcess | undefined;
    let kuboApiUrl: string | undefined;

    afterEach(async () => {
        await killChildProcess(daemon);
        if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
        daemon = undefined;
        kuboApiUrl = undefined;
    }, 60_000);

    const startDaemon = async (envOverrides: Record<string, string>) => {
        const dataPath = randomDirectory();
        const [configApiPort, configGatewayPort, rpcPort] = await Promise.all([
            allocateFreePort("0.0.0.0"),
            allocateFreePort("0.0.0.0"),
            allocateFreePort("127.0.0.1")
        ]);
        kuboApiUrl = `http://127.0.0.1:${configApiPort}/api/v0`;
        await preInitKuboWithEphemeralSwarm(
            path.join(dataPath, ".bitsocial-cli.ipfs"),
            new URL(kuboApiUrl),
            new URL(`http://127.0.0.1:${configGatewayPort}`)
        );
        const { KUBO_RPC_URL: _kubo, IPFS_GATEWAY_URL: _gateway, IPFS_PATH: _repo, ...inheritedEnv } = process.env;
        daemon = spawn(
            "node",
            ["./bin/run", "daemon", "--logPath", randomDirectory(), "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", `ws://localhost:${rpcPort}`],
            { stdio: ["pipe", "pipe", "pipe"], env: { ...inheritedEnv, ...envOverrides } }
        );
        let output = "";
        daemon.stdout!.on("data", (data: Buffer) => (output += data.toString()));
        daemon.stderr!.on("data", (data: Buffer) => (output += data.toString()));
        return { configApiPort, configGatewayPort, printedOptions: async () => {
            const ready = await waitForCondition(() => output.includes("Communities in data path"), 90_000, 250);
            expect(ready, `daemon never became ready:\n${output}`).toBe(true);
            return output.slice(output.indexOf("PKC options:"));
        } };
    };

    it("uses Addresses.API and Addresses.Gateway over the built-in defaults", { timeout: 120_000 }, async () => {
        const { configApiPort, configGatewayPort, printedOptions } = await startDaemon({});
        const options = await printedOptions();
        expect(options).toContain(`Kubo IPFS API listening on: http://127.0.0.1:${configApiPort}/api/v0`);
        expect(options).toContain(`Kubo IPFS Gateway listening on: http://127.0.0.1:${configGatewayPort}`);
        expect((await fetch(`${kuboApiUrl}/version`, { method: "POST" })).ok).toBe(true);
    });

    it("lets an explicit KUBO_RPC_URL and IPFS_GATEWAY_URL win over the kubo config", { timeout: 120_000 }, async () => {
        const [envApiPort, envGatewayPort] = await Promise.all([allocateFreePort("0.0.0.0"), allocateFreePort("0.0.0.0")]);
        const { printedOptions } = await startDaemon({
            KUBO_RPC_URL: `http://127.0.0.1:${envApiPort}/api/v0`,
            IPFS_GATEWAY_URL: `http://127.0.0.1:${envGatewayPort}`
        });
        const options = await printedOptions();
        expect(options).toContain(`Kubo IPFS API listening on: http://127.0.0.1:${envApiPort}/api/v0`);
        expect(options).toContain(`Kubo IPFS Gateway listening on: http://127.0.0.1:${envGatewayPort}`);
    });
});
