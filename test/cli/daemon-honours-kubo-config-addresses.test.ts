// Regression test for issue #200: an operator who edits Addresses.API / Addresses.Gateway in the kubo
// config must get a daemon that talks to those ports. The env defaults deliberately point elsewhere:
// a daemon that ignores the kubo config dials the env port, where nothing is listening.
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, killChildProcess, waitForCondition } from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";

describe("daemon honours the addresses in the kubo config (issue #200)", () => {
    let daemon: ChildProcess | undefined;
    let kuboApiUrl: string | undefined;

    afterAll(async () => {
        await killChildProcess(daemon);
        if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
    }, 60_000);

    it("connects to a non-default Addresses.API instead of the env default", { timeout: 120_000 }, async () => {
        const dataPath = randomDirectory();
        const [configApiPort, configGatewayPort, envApiPort, envGatewayPort, rpcPort] = await Promise.all([
            allocateFreePort("0.0.0.0"),
            allocateFreePort("0.0.0.0"),
            allocateFreePort("0.0.0.0"),
            allocateFreePort("0.0.0.0"),
            allocateFreePort("127.0.0.1")
        ]);
        kuboApiUrl = `http://127.0.0.1:${configApiPort}/api/v0`;
        await preInitKuboWithEphemeralSwarm(
            path.join(dataPath, ".bitsocial-cli.ipfs"),
            new URL(`http://127.0.0.1:${configApiPort}/api/v0`),
            new URL(`http://127.0.0.1:${configGatewayPort}`)
        );

        daemon = spawn(
            "node",
            ["./bin/run", "daemon", "--logPath", randomDirectory(), "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", `ws://localhost:${rpcPort}`],
            {
                stdio: ["pipe", "pipe", "pipe"],
                env: {
                    ...process.env,
                    IPFS_PATH: "",
                    KUBO_RPC_URL: `http://127.0.0.1:${envApiPort}/api/v0`,
                    IPFS_GATEWAY_URL: `http://127.0.0.1:${envGatewayPort}`
                }
            }
        );
        let output = "";
        daemon.stdout!.on("data", (data: Buffer) => (output += data.toString()));
        daemon.stderr!.on("data", (data: Buffer) => (output += data.toString()));

        const ready = await waitForCondition(() => output.includes("Communities in data path"), 90_000, 250);
        expect(ready, `daemon never became ready:\n${output}`).toBe(true);

        const printedOptions = output.slice(output.indexOf("PKC options:"));
        expect(printedOptions).toContain(`127.0.0.1:${configApiPort}/api/v0`);
        expect(printedOptions).not.toContain(`127.0.0.1:${envApiPort}/api/v0`);
        const version = await fetch(`${kuboApiUrl}/version`, { method: "POST" });
        expect(version.ok).toBe(true);
    });
});
