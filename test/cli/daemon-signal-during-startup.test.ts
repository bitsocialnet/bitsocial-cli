// Ctrl+C while the daemon is still starting its RPC server. The shutdown found no server yet and skipped destroying
// it, while startup carried on: it announced "pkc rpc: listening" after "Shutting down", or, when the server start
// failed meanwhile, reported "Daemon failed to start" and exited 1 halfway through the shutdown, SIGKILLing kubo.
// Hooks hold startDaemonServer once the server is up (optionally failing it afterwards) and hold kubo's teardown, so
// the signal lands inside that window and the shutdown is still running when the server start settles.
import { spawn, type ChildProcess } from "child_process";
import fsPromise from "fs/promises";
import path from "path";
import tcpPortUsed from "tcp-port-used";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { ensureKuboNodeStopped, waitForCondition, withKuboBindRetry } from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";

const SERVER_READY_DELAY_MS = 3000;
const KUBO_SHUTDOWN_DELAY_MS = 12000;

const readDaemonLog = async (logPath: string) => {
    let combined = "";
    for (const file of await fsPromise.readdir(logPath)) combined += await fsPromise.readFile(path.join(logPath, file), "utf-8");
    return combined;
};

describe.skipIf(process.platform === "win32")("Ctrl+C while the daemon's RPC server is starting", () => {
    for (const scenario of [
        { serverStart: "succeeds", env: {} },
        { serverStart: "fails", env: { PKC_CLI_TEST_DAEMON_SERVER_FAIL_AFTER_DELAY: "1" } }
    ]) {
        it(`shuts down with the signal's exit code when the server start ${scenario.serverStart}`, { timeout: 150_000 }, async () => {
            const dataPath = randomDirectory();
            const logPath = randomDirectory();
            let output = "";
            let daemon: ChildProcess | undefined;
            let kuboApiUrl: string | undefined;
            try {
                const started = await withKuboBindRetry(
                    async (e) => {
                        await preInitKuboWithEphemeralSwarm(
                            path.join(dataPath, ".bitsocial-cli.ipfs"),
                            new URL(e.kuboRpcUrl),
                            new URL(e.gatewayUrl)
                        );
                        output = "";
                        const proc = spawn(
                            "node",
                            ["./bin/run", "daemon", "--logPath", logPath, "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl],
                            {
                                stdio: ["ignore", "pipe", "pipe"],
                                env: {
                                    ...process.env,
                                    KUBO_RPC_URL: e.kuboRpcUrl,
                                    IPFS_GATEWAY_URL: e.gatewayUrl,
                                    PKC_CLI_TEST_DAEMON_SERVER_READY_DELAY_MS: String(SERVER_READY_DELAY_MS),
                                    PKC_CLI_TEST_KUBO_SHUTDOWN_DELAY_MS: String(KUBO_SHUTDOWN_DELAY_MS),
                                    ...scenario.env
                                }
                            }
                        );
                        daemon = proc;
                        proc.stdout!.on("data", (data: Buffer) => (output += data.toString()));
                        proc.stderr!.on("data", (data: Buffer) => (output += data.toString()));
                        const hasExited = () => proc.exitCode !== null || proc.signalCode !== null;
                        // The RPC port accepts connections as soon as startDaemonServer has bound it, well before it returns
                        await waitForCondition(async () => hasExited() || (await tcpPortUsed.check(e.rpcPort, "127.0.0.1")), 60_000, 50);
                        // On a lost port race the message carries "address already in use" from the output, and the start is retried
                        if (hasExited()) throw new Error(`daemon exited before its RPC server came up:\n${output}`);
                        if (!(await tcpPortUsed.check(e.rpcPort, "127.0.0.1"))) throw new Error(`RPC server never came up:\n${output}`);
                        return proc;
                    },
                    {
                        cleanup: async (e) => {
                            daemon?.kill("SIGKILL");
                            await ensureKuboNodeStopped(e.kuboApiUrl);
                        }
                    }
                );
                daemon = started.result;
                kuboApiUrl = started.endpoints.kuboApiUrl;
                expect(output).not.toContain("pkc rpc: listening");

                daemon.kill("SIGINT");
                const exited = await waitForCondition(() => daemon!.exitCode !== null || daemon!.signalCode !== null, 90_000, 100);
                expect(exited, output).toBe(true);

                expect(output).toContain("Shutting down Bitsocial daemon");
                expect(output).not.toContain("pkc rpc: listening");
                expect(output).not.toContain("Daemon failed to start");
                // exit-hook exits with 128 + SIGINT once the whole shutdown has run
                expect(daemon.exitCode, output).toBe(130);
                if (scenario.serverStart === "succeeds") expect(await readDaemonLog(logPath)).toContain("Daemon server shut down");

                const kuboStopped = await waitForCondition(
                    async () => {
                        try {
                            return !(await fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" })).ok;
                        } catch {
                            return true;
                        }
                    },
                    20_000,
                    500
                );
                expect(kuboStopped).toBe(true);
            } finally {
                if (daemon && daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
                if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
            }
        });
    }
});
