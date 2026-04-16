import { Flags, Command } from "@oclif/core";
import { ChildProcessWithoutNullStreams } from "child_process";

import defaults from "../../common-utils/defaults.js";
import { startKuboNode } from "../../ipfs/startIpfs.js";
import path from "path";
import tcpPortUsed from "tcp-port-used";
import {
    getLanIpV4Address,
    getPKCLogger,
    setupDebugLogger,
    loadKuboConfigFile,
    parseMultiAddrKuboRpcToUrl,
    parseMultiAddrIpfsGatewayToUrl
} from "../../util.js";
import type { PKCLogger } from "../../util.js";
import { startDaemonServer } from "../../webui/daemon-server.js";
import { loadChallengesIntoPKC } from "../../challenge-packages/challenge-utils.js";
import { migrateDataDirectory } from "../../common-utils/data-migration.js";
import { createBsoResolvers } from "../../common-utils/resolvers.js";
import fs from "fs";
import fsPromise from "fs/promises";

/** Replace wildcard bind addresses with loopback for connectivity checks (macOS rejects connect to 0.0.0.0 with EINVAL) */
function toConnectableHostname(hostname: string): string {
    if (process.platform === "darwin") {
        if (hostname === "0.0.0.0") return "127.0.0.1";
        if (hostname === "::") return "::1";
    }
    return hostname;
}
import { EOL } from "node:os";
import { formatWithOptions } from "node:util";
import { createRequire } from "node:module";
//@ts-expect-error
import type { InputPKCOptions } from "@pkcprotocol/pkc-js/dist/node/types.js";
//@ts-expect-error
import DataObjectParser from "dataobject-parser";

import * as remeda from "remeda";

const defaultPkcOptions: InputPKCOptions = {
    dataPath: defaults.PKC_DATA_PATH,
    httpRoutersOptions: defaults.HTTP_TRACKERS
};

export default class Daemon extends Command {
    static override description = `Run a network-connected Bitsocial node. Once the daemon is running you can create and start your communities and receive publications from users. The daemon will also serve web ui on http that can be accessed through a browser on any machine. Within the web ui users are able to browse, create and manage their communities fully P2P.
    Options can be passed to the RPC's instance through flag --pkcOptions.optionName. For a list of pkc options (https://github.com/pkcprotocol/pkc-js?tab=readme-ov-file#pkcoptions)
    If you need to modify ipfs config, you should head to {bitsocial-data-path}/.ipfs-bitsocial-cli/config and modify the config file
    `;

    static override flags = {
        pkcRpcUrl: Flags.url({
            description: "Specify PKC RPC URL to listen on",
            required: true,
            default: defaults.PKC_RPC_URL
        }),

        logPath: Flags.directory({
            description: "Specify a directory which will be used to store logs",
            required: true,
            default: defaults.PKC_LOG_PATH
        }),

        chainProviderUrls: Flags.string({
            description:
                'Ethereum RPC URL(s) for .bso/.eth name resolution. Can be specified multiple times. Defaults to viem public transport and https://ethrpc.xyz',
            multiple: true,
            default: ["viem", "https://ethrpc.xyz"]
        })
    };

    static override examples = [
        "bitsocial daemon",
        "bitsocial daemon --pkcRpcUrl ws://localhost:53812",
        "bitsocial daemon --pkcOptions.dataPath /tmp/bitsocial-datapath/",
        "bitsocial daemon --pkcOptions.kuboRpcClientsOptions[0] https://remoteipfsnode.com",
        "bitsocial daemon --chainProviderUrls https://mainnet.infura.io/v3/YOUR_KEY",
        "bitsocial daemon --chainProviderUrls viem --chainProviderUrls https://mainnet.infura.io/v3/YOUR_KEY"
    ];

    private _setupLogger(Logger: PKCLogger) {
        setupDebugLogger(Logger, { enableDefaultNamespace: true });
        console.log("To view logs, run: bitsocial logs");
        console.log("For custom debug logging, restart the daemon with DEBUG env, e.g.: DEBUG='bitsocial*,pkc*' bitsocial daemon");
    }

    private async _getNewLogfileByEvacuatingOldLogsIfNeeded(logPath: string) {
        try {
            await fsPromise.mkdir(logPath, { recursive: true });
        } catch (e) {
            //@ts-expect-error
            if (e.code !== "EEXIST") throw e;
        }
        const logFiles = (await fsPromise.readdir(logPath, { withFileTypes: true })).filter((file) =>
            file.name.startsWith("bitsocial_cli_daemon")
        );
        const logfilesCapacity = 5; // we only store 5 log files
        let deletedLogFile: string | undefined;
        if (logFiles.length >= logfilesCapacity) {
            // we need to pick the oldest log to delete
            const logFileToDelete = logFiles.map((logFile) => logFile.name).sort()[0]; // TODO need to test this, not sure if it works
            deletedLogFile = logFileToDelete;
            await fsPromise.rm(path.join(logPath, logFileToDelete));
        }

        return { logFilePath: path.join(logPath, `bitsocial_cli_daemon_${new Date().toISOString().replace(/:/g, "-")}.log`), deletedLogFile, logfilesCapacity };
    }

    private async _pipeDebugLogsToLogFile(
        logPath: string,
        Logger: PKCLogger
    ): Promise<{ logFilePath: string; stdoutWrite: typeof process.stdout.write }> {
        const { logFilePath, deletedLogFile, logfilesCapacity } = await this._getNewLogfileByEvacuatingOldLogsIfNeeded(logPath);

        const logFile = fs.createWriteStream(logFilePath, { flags: "a" });
        const stdoutWrite = process.stdout.write.bind(process.stdout);
        const stderrWrite = process.stderr.write.bind(process.stderr);

        const isLogFileOverLimit = () => logFile.bytesWritten > 20000000; // 20mb

        const writeTimestampedLine = (text: string) => {
            if (isLogFileOverLimit()) return;
            if (!text || text.trim().length === 0) return;
            const timestamp = `[${new Date().toISOString()}] `;
            const lines = text.split("\n");
            const timestamped = lines.map((line, i) => (i === 0 ? timestamp + line : line)).join("\n");
            logFile.write(timestamped);
        };

        // Redirect debug library output directly to the log file
        // instead of stderr, so only real errors appear in the terminal
        const require = createRequire(import.meta.url);
        const debugModule = require("debug");
        // Force colors on and suppress the debug library's own date prefix
        // so that only writeTimestampedLine adds timestamps
        debugModule.inspectOpts.colors = true;
        debugModule.inspectOpts.hideDate = true;
        debugModule.log = (...args: any[]) => {
            writeTimestampedLine(formatWithOptions({ depth: Logger.inspectOpts?.depth || 10, colors: true }, ...args).trimStart() + EOL);
        };

        const asString = (data: string | Uint8Array) => (typeof data === "string" ? data : Buffer.from(data).toString());

        process.stdout.write = (...args) => {
            //@ts-expect-error
            const res = stdoutWrite(...args);
            writeTimestampedLine(asString(args[0]));
            return res;
        };

        process.stderr.write = (...args) => {
            // Only write stderr to the log file, not to the terminal.
            // Debug output goes to stderr; we want it in logs only.
            // Real errors are caught by uncaughtException/unhandledRejection handlers
            // which use console.error -> stderr.write -> this override -> log file.
            writeTimestampedLine(asString(args[0]).trimStart());
            return true;
        };

        const log = Logger("bitsocial-cli:daemon");
        log(`Will store stderr + stdout log to ${logFilePath}`);

        if (deletedLogFile) {
            log(`Will remove log (${deletedLogFile}) because we reached capacity (${logfilesCapacity})`);
        }

        // Write real errors to both the terminal and the log file
        const writeErrorToTerminal = (err: unknown) => {
            const msg = err instanceof Error ? err.stack || err.message : String(err);
            stderrWrite(msg + EOL);
        };
        process.on("uncaughtException", (err) => {
            writeErrorToTerminal(err);
            console.error(err);
        });
        process.on("unhandledRejection", (err) => {
            writeErrorToTerminal(err);
            console.error(err);
        });

        process.on("exit", () => logFile.close());

        return { logFilePath, stdoutWrite };
    }

    async run() {
        process.env["DEBUG_COLORS"] = "1";
        process.env["DEBUG_HIDE_DATE"] = "1";
        const { flags } = await this.parse(Daemon);
        const Logger = await getPKCLogger();
        this._setupLogger(Logger);
        const { logFilePath, stdoutWrite } = await this._pipeDebugLogsToLogFile(flags.logPath, Logger);
        const log = Logger("bitsocial-cli:daemon");

        try {
        // Log debug info after pipe is set up so it goes to the log file, not terminal
        const envDebug: string | undefined = process.env["_PKC_DEBUG"] || process.env["DEBUG"];
        const debugNamespace = envDebug === "0" || envDebug === "" ? undefined : envDebug;
        if (debugNamespace) {
            const debugDepth = process.env["DEBUG_DEPTH"] ? parseInt(process.env["DEBUG_DEPTH"]) : 10;
            log("Debug logs is on with namespace", `"${debugNamespace}"`);
            log("Debug depth is set to", debugDepth);
        }

        log(`flags: `, flags);

        const pkcRpcUrl = new URL(flags.pkcRpcUrl);

        const pkcOptionsFlagNames = Object.keys(flags).filter((flag) => flag.startsWith("pkcOptions"));
        const pkcOptionsFromFlag: InputPKCOptions | undefined =
            pkcOptionsFlagNames.length > 0
                ? DataObjectParser.transpose(remeda.pick(flags, pkcOptionsFlagNames))["_data"]?.["pkcOptions"]
                : undefined;

        if (pkcOptionsFromFlag?.pkcRpcClientsOptions && pkcRpcUrl.toString() !== defaults.PKC_RPC_URL.toString()) {
            this.error(
                "Can't provide pkcOptions.pkcRpcClientsOptions and --pkcRpcUrl simultaneously. You have to choose between connecting to an RPC or starting up a new RPC"
            );
        }

        if (pkcOptionsFromFlag?.kuboRpcClientsOptions && pkcOptionsFromFlag.kuboRpcClientsOptions.length !== 1)
            this.error("Can't provide pkcOptions.kuboRpcClientsOptions as an array with more than 1 element, or as a non array");

        if (pkcOptionsFromFlag?.ipfsGatewayUrls && pkcOptionsFromFlag.ipfsGatewayUrls.length !== 1)
            this.error("Can't provide pkcOptions.ipfsGatewayUrls as an array with more than 1 element, or as a non array");

        const ipfsConfig = await loadKuboConfigFile(pkcOptionsFromFlag?.dataPath || defaultPkcOptions.dataPath!);
        const kuboRpcEndpoint = pkcOptionsFromFlag?.kuboRpcClientsOptions
            ? new URL(pkcOptionsFromFlag.kuboRpcClientsOptions[0]!.toString())
            : ipfsConfig?.["Addresses"]?.["API"]
              ? await parseMultiAddrKuboRpcToUrl(ipfsConfig?.["Addresses"]?.["API"])
              : defaults.KUBO_RPC_URL;
        const ipfsGatewayEndpoint = pkcOptionsFromFlag?.ipfsGatewayUrls
            ? new URL(pkcOptionsFromFlag.ipfsGatewayUrls[0])
            : ipfsConfig?.["Addresses"]?.["Gateway"]
              ? await parseMultiAddrIpfsGatewayToUrl(ipfsConfig?.["Addresses"]?.["Gateway"])
              : defaults.IPFS_GATEWAY_URL;

        defaultPkcOptions.kuboRpcClientsOptions = [kuboRpcEndpoint.toString()];
        const mergedPkcOptions = { ...defaultPkcOptions, ...pkcOptionsFromFlag };
        log("Merged pkc options that will be used for this node", mergedPkcOptions);

        // Migrate data directory before creating PKC instance
        migrateDataDirectory(mergedPkcOptions.dataPath!);

        // Create BSO name resolvers for .bso/.eth domain resolution
        const bsoResolvers = createBsoResolvers(flags.chainProviderUrls, mergedPkcOptions.dataPath);
        mergedPkcOptions.nameResolvers = [...(mergedPkcOptions.nameResolvers || []), ...bsoResolvers];

        let mainProcessExited = false;
        let pendingKuboStart: Promise<ChildProcessWithoutNullStreams> | undefined;
        // Kubo Node may fail randomly, we need to set a listener so when it exits because of an error we restart it
        let kuboProcess: ChildProcessWithoutNullStreams | undefined;
        const keepKuboUp = async () => {
            if (mainProcessExited) return;
            const kuboApiPort = Number(kuboRpcEndpoint.port);
            if (kuboProcess || pendingKuboStart || usingDifferentProcessRpc) return; // already started, no need to intervene
            const connectHostname = toConnectableHostname(kuboRpcEndpoint.hostname);
            const isKuboApiPortTaken = await tcpPortUsed.check(kuboApiPort, connectHostname);
            if (isKuboApiPortTaken) {
                const connectableEndpoint = new URL(kuboRpcEndpoint.toString());
                connectableEndpoint.hostname = connectHostname;
                const versionUrl = new URL("version", connectableEndpoint);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 2000);
                let isHealthyKubo = false;
                try {
                    const response = await fetch(versionUrl, { method: "POST", signal: controller.signal });
                    isHealthyKubo = response.ok;
                } catch {
                    /* ignore */
                } finally {
                    clearTimeout(timer);
                }
                if (isHealthyKubo) {
                    log.trace(
                        `Kubo API already running on port (${kuboApiPort}) by another program. bitsocial-cli will use the running ipfs daemon instead of starting a new one`
                    );
                    return;
                }
                throw new Error(
                    `Cannot start IPFS daemon because the IPFS API port ${
                        kuboRpcEndpoint.hostname
                    }:${kuboApiPort} (configured as ${kuboRpcEndpoint.toString()}) is already in use.`
                );
            }
            const startPromise = startKuboNode(kuboRpcEndpoint, ipfsGatewayEndpoint, mergedPkcOptions.dataPath!, (process) => {
                kuboProcess = process;
            });
            pendingKuboStart = startPromise;
            let startedProcess: ChildProcessWithoutNullStreams | undefined;
            try {
                startedProcess = await startPromise;
            } catch (error) {
                pendingKuboStart = undefined;
                if (!mainProcessExited) kuboProcess = undefined;
                throw error;
            }
            pendingKuboStart = undefined;
            if (mainProcessExited) {
                if (startedProcess?.pid && !startedProcess.killed) {
                    // Race condition: Kubo finished starting after mainProcessExited.
                    // Use SIGKILL + process group kill for immediate termination.
                    const pid = startedProcess.pid;
                    if (process.platform !== "win32") {
                        try {
                            process.kill(-pid, "SIGKILL");
                        } catch {
                            /* best effort */
                        }
                    }
                    try {
                        process.kill(pid, "SIGKILL");
                    } catch {
                        /* best effort */
                    }
                }
                kuboProcess = undefined;
                return;
            }
            kuboProcess = startedProcess;
            log(`Started kubo ipfs process with pid (${kuboProcess.pid})`);
            console.log(`Kubo IPFS API listening on: ${kuboRpcEndpoint}`);
            console.log(`Kubo IPFS Gateway listening on: ${ipfsGatewayEndpoint}`);
            const currentProcess = startedProcess;
            const onKuboExit = async () => {
                // Restart Kubo process because it failed
                if (!mainProcessExited) {
                    log(`Kubo node with pid (${currentProcess?.pid}) exited. Will attempt to restart it`);
                    kuboProcess = undefined;
                    await keepKuboUp();
                } else {
                    currentProcess.removeAllListeners();
                }
            };
            currentProcess.once("exit", onKuboExit);
        };

        let startedOwnRpc = false;
        let usingDifferentProcessRpc = false;
        let daemonServer: Awaited<ReturnType<typeof startDaemonServer>> | undefined;
        const createOrConnectRpc = async () => {
            if (mainProcessExited) return;
            if (startedOwnRpc) return;
            const isRpcPortTaken = await tcpPortUsed.check(Number(pkcRpcUrl.port), pkcRpcUrl.hostname);
            if (isRpcPortTaken && usingDifferentProcessRpc) return;
            if (isRpcPortTaken) {
                log(
                    `PKC RPC is already running (${pkcRpcUrl}) by another program. bitsocial-cli will use the running RPC server, and if shuts down, bitsocial-cli will start a new RPC instance`
                );
                console.log("Using the already started RPC server at:", pkcRpcUrl);
                console.log("bitsocial-cli daemon will monitor the PKC RPC and kubo ipfs API to make sure they're always up");
                const PKC = await import("@pkcprotocol/pkc-js");
                const pkc = await PKC.default({ pkcRpcClientsOptions: [pkcRpcUrl.toString()] });
                await new Promise((resolve) => pkc.once("communitieschange", resolve));
                pkc.on("error", (error) => console.error("Error from pkc instance", error));
                console.log(`Communities in data path: `, pkc.communities);
                usingDifferentProcessRpc = true;
                return;
            }

            // Load installed challenge packages before starting the RPC server
            const loadedChallenges = await loadChallengesIntoPKC(mergedPkcOptions.dataPath);
            if (loadedChallenges.length > 0) console.log(`Loaded challenge packages: ${loadedChallenges.join(", ")}`);

            daemonServer = await startDaemonServer(pkcRpcUrl, ipfsGatewayEndpoint, mergedPkcOptions);

            usingDifferentProcessRpc = false;
            startedOwnRpc = true;
            console.log(`pkc rpc: listening on ${pkcRpcUrl} (local connections only)`);
            console.log(`pkc rpc: listening on ${pkcRpcUrl}${daemonServer.rpcAuthKey} (secret auth key for remote connections)`);

            console.log(`Bitsocial data path: ${path.resolve(mergedPkcOptions.dataPath!)}`);
            console.log(`Communities in data path: `, daemonServer.listedSub);

            const localIpAddress = "localhost";
            const remoteIpAddress = getLanIpV4Address() || localIpAddress;
            const rpcPort = pkcRpcUrl.port;
            const webuiDescriptions: Record<string, string> = {
                plebones: "A bare bones UI client",
                seedit: "Similar to old reddit UI",
                "5chan": "Imageboard-style UI"
            };
            for (const webui of daemonServer.webuis) {
                const desc = webuiDescriptions[webui.name] ? ` - ${webuiDescriptions[webui.name]}` : "";
                console.log(`WebUI (${webui.name}${desc}): http://${localIpAddress}:${rpcPort}${webui.endpointRemote}`);
                if (remoteIpAddress !== localIpAddress)
                    console.log(`WebUI (${webui.name}${desc}): http://${remoteIpAddress}:${rpcPort}${webui.endpointRemote}`);
            }
        };

        const isRpcPortTaken = await tcpPortUsed.check(Number(pkcRpcUrl.port), pkcRpcUrl.hostname);

        if (!pkcOptionsFromFlag?.kuboRpcClientsOptions && !isRpcPortTaken && !usingDifferentProcessRpc) await keepKuboUp();
        await createOrConnectRpc();

        let keepKuboUpInterval: NodeJS.Timeout | undefined;
        const { asyncExitHook } = await import("exit-hook");
        const killKuboProcessGroup = (pid: number, signal: NodeJS.Signals) => {
            // Kill the entire process group (negative PID) on non-Windows.
            // Kubo is spawned with detached: true, so it has its own process group.
            if (process.platform !== "win32") {
                try {
                    process.kill(-pid, signal);
                } catch {
                    /* best effort */
                }
            }
            try {
                process.kill(pid, signal);
            } catch {
                /* best effort */
            }
        };

        const killKuboProcess = async () => {
            if (pendingKuboStart) {
                try {
                    await pendingKuboStart;
                } catch {
                    /* ignore */
                }
            }
            if (kuboProcess?.pid && !kuboProcess.killed) {
                const pid = kuboProcess.pid;
                log("Attempting to kill kubo process with pid", pid);
                try {
                    killKuboProcessGroup(pid, "SIGINT");
                    const exited = await new Promise<boolean>((resolve) => {
                        const timeout = setTimeout(() => resolve(false), 5000);
                        kuboProcess?.once("exit", () => {
                            clearTimeout(timeout);
                            resolve(true);
                        });
                    });
                    if (!exited) {
                        log("Kubo process did not exit after SIGINT, escalating to SIGKILL");
                        killKuboProcessGroup(pid, "SIGKILL");
                    }
                    log("Kubo process killed with pid", pid);
                } catch (e) {
                    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ESRCH")
                        log("Kubo process already killed");
                    else log.error("Error killing kubo process", e);
                } finally {
                    kuboProcess?.removeAllListeners();
                    kuboProcess = undefined;
                }
            }
        };

        asyncExitHook(
            async () => {
                if (keepKuboUpInterval) clearInterval(keepKuboUpInterval);
                if (mainProcessExited) return; // we already exited
                console.log(
                    "\nShutting down Bitsocial daemon, it may take a few seconds to shut down all communities and the IPFS node..."
                );
                log("Received signal to exit, shutting down both kubo and pkc rpc. Please wait, it may take a few seconds");

                mainProcessExited = true;

                // Start killing Kubo immediately, in parallel with daemon server destroy.
                // This way Kubo receives SIGINT right away, even if daemonServer.destroy() hangs.
                const kuboKillPromise = killKuboProcess();

                if (daemonServer)
                    try {
                        await daemonServer.destroy();
                        log("Daemon server shut down");
                    } catch (e) {
                        log.error("Error shutting down daemon server", e);
                    }

                await kuboKillPromise;
            },
            { wait: 120000 } // could take two minutes to shut down
        );

        // Emergency cleanup: if the process force-exits (e.g. double Ctrl+C),
        // synchronously SIGKILL kubo's process group. This is a no-op if
        // killKuboProcess() already ran (it sets kuboProcess = undefined).
        process.on("exit", () => {
            if (kuboProcess?.pid) {
                killKuboProcessGroup(kuboProcess.pid, "SIGKILL");
            }
        });

        keepKuboUpInterval = setInterval(async () => {
            if (mainProcessExited) return;
            const isRpcPortTaken = await tcpPortUsed.check(Number(pkcRpcUrl.port), pkcRpcUrl.hostname);
            if (!pkcOptionsFromFlag?.kuboRpcClientsOptions && !isRpcPortTaken && !usingDifferentProcessRpc) await keepKuboUp();
            else if (pkcOptionsFromFlag?.kuboRpcClientsOptions && !usingDifferentProcessRpc) await keepKuboUp();
            await createOrConnectRpc();
        }, 5000);

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            stdoutWrite(`\nDaemon failed to start: ${errorMsg}\n\n`);

            // Show last 10 lines from log for context
            try {
                const logContent = fs.readFileSync(logFilePath, "utf-8");
                const lines = logContent.trimEnd().split("\n");
                const lastLines = lines.slice(-10).join("\n");
                stdoutWrite(`Last log lines:\n${lastLines}\n\n`);
            } catch {
                /* log file might not exist yet */
            }

            stdoutWrite(`Full log: ${logFilePath}\n`);
            stdoutWrite(`Or run: bitsocial logs\n`);
            throw err;
        }
    }
}
