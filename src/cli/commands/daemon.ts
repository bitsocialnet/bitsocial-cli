import { Flags, Command } from "@oclif/core";
import { ChildProcessWithoutNullStreams } from "child_process";

import defaults from "../../common-utils/defaults.js";
import { startKuboNode } from "../../ipfs/startIpfs.js";
import path from "path";
import tcpPortUsed from "tcp-port-used";
import {
    getLanIpV4Address,
    PKCLogger,
    setupDebugLogger,
    loadKuboConfigFile,
    parseMultiAddrKuboRpcToUrl,
    parseMultiAddrIpfsGatewayToUrl
} from "../../util.js";
import type { PKCLoggerType } from "../../util.js";
import { startDaemonServer } from "../../webui/daemon-server.js";
import { printBanner } from "../ascii-banner.js";
import { loadChallengesIntoPKC, formatChallengeNameVersion } from "../../challenge-packages/challenge-utils.js";
import { migrateDataDirectory } from "../../common-utils/data-migration.js";
import { createBsoResolvers, DEFAULT_PROVIDERS } from "../../common-utils/resolvers.js";
import { pruneStaleStates, writeDaemonState, deleteDaemonState, detectSelfSupervisor, DAEMON_SHUTDOWN_TIMEOUT_MS } from "../../common-utils/daemon-state.js";
import { createDaemonFileLogger, type DaemonFileLogger } from "../../common-utils/daemon-file-logger.js";
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

export interface KeepKuboUpTickDeps {
    pkcRpcUrl: URL;
    tcpPortUsedCheck: (port: number, host: string) => Promise<boolean>;
    pkcOptionsFromFlag: { kuboRpcClientsOptions?: unknown } | undefined;
    hasKuboProcess: boolean;
    hasPendingKuboStart: boolean;
    keepKuboUp: () => Promise<void>;
    createOrConnectRpc: () => Promise<void>;
    onError: (message: string) => void;
}

/**
 * Runs one tick of the keepKuboUp interval. Exported so it can be unit-tested.
 *
 * Both `tcpPortUsedCheck` and the downstream `keepKuboUp`/`createOrConnectRpc` calls
 * are wrapped in try/catch — a transient ETIMEDOUT from the port check (or any other
 * error from this tick) must not propagate to the setInterval callback, which would
 * become an unhandledRejection (issue #37 bug 3).
 */
export async function runKeepKuboUpTick(deps: KeepKuboUpTickDeps): Promise<void> {
    let isRpcPortTaken = false;
    try {
        isRpcPortTaken = await deps.tcpPortUsedCheck(Number(deps.pkcRpcUrl.port), toConnectableHostname(deps.pkcRpcUrl.hostname));
        if (!deps.pkcOptionsFromFlag?.kuboRpcClientsOptions && !isRpcPortTaken) await deps.keepKuboUp();
        else if (deps.pkcOptionsFromFlag?.kuboRpcClientsOptions) await deps.keepKuboUp();
        // Retry if kubo died and onKuboExit's restart attempt failed (e.g. transient port conflict)
        else if (!deps.hasKuboProcess && !deps.hasPendingKuboStart) await deps.keepKuboUp();
    } catch (error) {
        deps.onError(`keepKuboUp tick error (will retry): ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        await deps.createOrConnectRpc();
    } catch (error) {
        deps.onError(`createOrConnectRpc tick error (will retry): ${error instanceof Error ? error.message : String(error)}`);
    }
}

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
            description: "RPC URL(s) for .bso name resolution. Can be specified multiple times.",
            multiple: true,
            default: DEFAULT_PROVIDERS
        }),

        allowPrivateKeyExport: Flags.boolean({
            description:
                "Allow RPC clients to request community exports that include the community signer's private key (`bitsocial community export --includePrivateKey`). Disable with --no-allowPrivateKeyExport when exposing the RPC to untrusted clients",
            allowNo: true,
            default: true
        })
    };

    static override examples = [
        "bitsocial daemon",
        "bitsocial daemon --pkcRpcUrl ws://localhost:53812",
        "bitsocial daemon --pkcOptions.dataPath /tmp/bitsocial-datapath/",
        "bitsocial daemon --pkcOptions.kuboRpcClientsOptions[0] https://remoteipfsnode.com",
        "bitsocial daemon --chainProviderUrls https://mainnet.infura.io/v3/YOUR_KEY",
        "bitsocial daemon --no-allowPrivateKeyExport",
    ];

    private _setupLogger(Logger: PKCLoggerType) {
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

        return {
            logFilePath: path.join(logPath, `bitsocial_cli_daemon_${new Date().toISOString().replace(/:/g, "-")}.log`),
            deletedLogFile,
            logfilesCapacity
        };
    }

    private async _pipeDebugLogsToLogFile(
        logPath: string,
        Logger: PKCLoggerType
    ): Promise<{ logFilePath: string; stdoutWrite: typeof process.stdout.write; fileLogger: DaemonFileLogger }> {
        const { logFilePath, deletedLogFile, logfilesCapacity } = await this._getNewLogfileByEvacuatingOldLogsIfNeeded(logPath);

        const fileLogger = createDaemonFileLogger({ logFilePath });
        const stdoutWrite = process.stdout.write.bind(process.stdout);
        const stderrWrite = process.stderr.write.bind(process.stderr);

        // Redirect debug library output directly to the log file
        // instead of stderr, so only real errors appear in the terminal
        const require = createRequire(import.meta.url);
        const debugModule = require("debug");
        // Force colors on and suppress the debug library's own date prefix
        // so that only writeTimestampedLine adds timestamps
        debugModule.inspectOpts.colors = true;
        debugModule.inspectOpts.hideDate = true;
        debugModule.log = (...args: any[]) => {
            const text = formatWithOptions({ depth: Logger.inspectOpts?.depth || 10, colors: true }, ...args).trimStart() + EOL;
            const wrote = fileLogger.writeTimestampedLine(text, "stderr");
            // If the file logger could not accept the write (closed / pending buffer full),
            // fall back to original stderr so debug output is never silently lost
            if (!wrote) stderrWrite(text);
        };

        const asString = (data: string | Uint8Array) => (typeof data === "string" ? data : Buffer.from(data).toString());

        process.stdout.write = (...args) => {
            //@ts-expect-error
            const res = stdoutWrite(...args);
            fileLogger.writeTimestampedLine(asString(args[0]), "stdout");
            return res;
        };

        process.stderr.write = (...args) => {
            // Debug output goes to stderr; route it to the log file.
            // If the file logger is unavailable (closed, errored), fall back to original stderr
            // so output is never silently swallowed.
            const text = asString(args[0]);
            const wrote = fileLogger.writeTimestampedLine(text.trimStart(), "stderr");
            if (!wrote) {
                //@ts-expect-error
                return stderrWrite(...args);
            }
            return true;
        };

        const log = Logger("bitsocial-cli:daemon");
        log(`Will store stderr + stdout log to ${logFilePath}`);

        if (deletedLogFile) {
            log(`Will remove log (${deletedLogFile}) because we reached capacity (${logfilesCapacity})`);
        }

        // Write real errors to both the terminal and the log file
        const writeErrorToTerminal = (label: string, err: unknown) => {
            const msg = err instanceof Error ? err.stack || err.message : String(err);
            stderrWrite(`[${label}] ${msg}${EOL}`);
        };
        process.on("uncaughtException", (err) => {
            writeErrorToTerminal("uncaughtException", err);
            console.error("[uncaughtException]", err);
        });
        process.on("unhandledRejection", (err) => {
            writeErrorToTerminal("unhandledRejection", err);
            console.error("[unhandledRejection]", err);
        });

        process.on("exit", () => {
            // close() returns a promise but exit handlers must be synchronous.
            // Best-effort: trigger the close; the underlying writeStream flushes on process exit.
            fileLogger.close().catch(() => {});
        });

        return { logFilePath, stdoutWrite, fileLogger };
    }

    async run() {
        // Daemon output is often viewed through Docker/systemd logs where stdout is not a TTY.
        printBanner({ forceColor: true });
        // Non-blocking update check — fire-and-forget, won't delay startup
        import("../../update/npm-registry.js")
            .then(({ fetchLatestVersion }) =>
                fetchLatestVersion().then(async (latest: string) => {
                    const { compareVersions } = await import("../../update/semver.js");
                    if (compareVersions(latest, this.config.version) > 0) {
                        this.log(
                            `Update available: v${latest} (current: v${this.config.version}). Run 'bitsocial update install' to upgrade.`
                        );
                    }
                })
            )
            .catch(() => {}); // silently ignore errors (offline, npm unavailable, etc.)

        process.env["DEBUG_COLORS"] = "1";
        process.env["DEBUG_HIDE_DATE"] = "1";
        const { flags } = await this.parse(Daemon);
        this._setupLogger(PKCLogger as PKCLoggerType);
        const { logFilePath, stdoutWrite } = await this._pipeDebugLogsToLogFile(flags.logPath, PKCLogger as PKCLoggerType);
        const log = PKCLogger("bitsocial-cli:daemon");

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

            const rpcConnectHostname = toConnectableHostname(pkcRpcUrl.hostname);
            const isRpcPortAlreadyTaken = await tcpPortUsed.check(Number(pkcRpcUrl.port), rpcConnectHostname);
            if (isRpcPortAlreadyTaken) {
                this.error(
                    `PKC RPC port is already in use at ${pkcRpcUrl} (another bitsocial daemon is likely running). ` +
                        `To talk to the running daemon, use other bitsocial commands with --pkcRpcUrl ${pkcRpcUrl} ` +
                        `(e.g. 'bitsocial community list --pkcRpcUrl ${pkcRpcUrl}'). ` +
                        `To run a second daemon, restart with a different port, e.g. --pkcRpcUrl ws://${pkcRpcUrl.hostname}:${Number(pkcRpcUrl.port) + 1}.`
                );
            }

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
            const { nameResolvers: _nr, ...printablePkcOptions } = mergedPkcOptions;
            console.log("PKC options:", JSON.stringify(printablePkcOptions, null, 2));

            // Migrate data directory before creating PKC instance
            migrateDataDirectory(mergedPkcOptions.dataPath!);

            // Prune stale daemon state files (dead PIDs from crashed daemons)
            await pruneStaleStates();

            // Persist this daemon's PID and startup args so `bitsocial update install --restart-daemons` can stop and restart it.
            // Also record the supervisor (e.g. systemd) so the updater restarts via the supervisor instead of spawning a
            // detached daemon that would compete with it for the RPC port (issue #82).
            const daemonArgv = process.argv.slice(process.argv.indexOf("daemon") + 1);
            const supervisor = await detectSelfSupervisor();
            await writeDaemonState({
                pid: process.pid,
                startedAt: new Date().toISOString(),
                argv: daemonArgv,
                pkcRpcUrl: pkcRpcUrl.toString(),
                ...(supervisor ? { supervisor } : {})
            });

            // Create BSO name resolvers for .bso/.eth domain resolution
            const bsoResolvers = createBsoResolvers(flags.chainProviderUrls);
            mergedPkcOptions.nameResolvers = [...(mergedPkcOptions.nameResolvers || []), ...bsoResolvers];


            let mainProcessExited = false;
            let pendingKuboStart: Promise<ChildProcessWithoutNullStreams> | undefined;
            // Kubo Node may fail randomly, we need to set a listener so when it exits because of an error we restart it
            let kuboProcess: ChildProcessWithoutNullStreams | undefined;
            // Every kubo we've spawned that hasn't exited yet. Exit cleanup kills all of these,
            // so a kubo that slipped out of kuboProcess tracking still dies with the daemon (issue #70)
            const liveKuboPids = new Set<number>();
            const keepKuboUpOnce = async () => {
                if (mainProcessExited) return;
                const kuboApiPort = Number(kuboRpcEndpoint.port);
                if (kuboProcess || pendingKuboStart) return; // already started, no need to intervene
                const connectHostname = toConnectableHostname(kuboRpcEndpoint.hostname);
                const isKuboApiPortTaken = await tcpPortUsed.check(kuboApiPort, connectHostname);
                // Test hook: widens the window between the re-entrancy guard above and the pendingKuboStart
                // assignment below, so tests can deterministically reproduce concurrent keepKuboUp entries
                // (issue #70, see test/cli/daemon-kubo-restart-race.test.ts)
                const portCheckDelayRaw = process.env["PKC_CLI_TEST_KEEPKUBOUP_PORTCHECK_DELAY_MS"];
                const portCheckDelay = portCheckDelayRaw ? Number(portCheckDelayRaw) : 0;
                if (Number.isFinite(portCheckDelay) && portCheckDelay > 0)
                    await new Promise((resolve) => setTimeout(resolve, portCheckDelay));
                // Re-check after the awaits above: the daemon may have begun shutting down, or another
                // kubo may have been adopted in the meantime — spawning now would race it (issue #70)
                if (mainProcessExited || kuboProcess || pendingKuboStart) return;
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
                let spawnedProcess: ChildProcessWithoutNullStreams | undefined;
                const startPromise = startKuboNode(kuboRpcEndpoint, ipfsGatewayEndpoint, mergedPkcOptions.dataPath!, (process) => {
                    spawnedProcess = process;
                    kuboProcess = process;
                    if (process.pid) {
                        const pid = process.pid;
                        liveKuboPids.add(pid);
                        process.once("exit", () => liveKuboPids.delete(pid));
                    }
                });
                pendingKuboStart = startPromise;
                let startedProcess: ChildProcessWithoutNullStreams | undefined;
                try {
                    startedProcess = await startPromise;
                } catch (error) {
                    // Only clear state this attempt owns — it may track another attempt's healthy kubo (issue #70)
                    if (pendingKuboStart === startPromise) pendingKuboStart = undefined;
                    if (!mainProcessExited && spawnedProcess && kuboProcess === spawnedProcess) kuboProcess = undefined;
                    throw error;
                }
                if (pendingKuboStart === startPromise) pendingKuboStart = undefined;
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
                    if (kuboProcess === startedProcess) kuboProcess = undefined;
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
                        if (kuboProcess === currentProcess) kuboProcess = undefined;
                        try {
                            await keepKuboUp();
                        } catch (error) {
                            log.trace(
                                `keepKuboUp error after kubo exit (interval will retry): ${error instanceof Error ? error.message : String(error)}`
                            );
                        }
                    } else {
                        currentProcess.removeAllListeners();
                    }
                };
                currentProcess.once("exit", onKuboExit);
            };

            // Single-flight wrapper: keepKuboUp is invoked from independent places (the kubo exit
            // handler and the watchdog interval). Concurrent callers must share one attempt —
            // otherwise both can pass keepKuboUpOnce's re-entrancy guard during its awaits and
            // spawn two kubo processes whose failure handling corrupts shared state (issue #70)
            let keepKuboUpInFlight: Promise<void> | undefined;
            const keepKuboUp = () => {
                if (!keepKuboUpInFlight) {
                    keepKuboUpInFlight = keepKuboUpOnce().finally(() => {
                        keepKuboUpInFlight = undefined;
                    });
                }
                return keepKuboUpInFlight;
            };

            let startedOwnRpc = false;
            let daemonServer: Awaited<ReturnType<typeof startDaemonServer>> | undefined;
            const createOrConnectRpc = async () => {
                if (mainProcessExited) return;
                if (startedOwnRpc) return;
                // Re-check the port: the early fail-fast at startup is a few ms before this runs,
                // so a TOCTOU race could let another process grab the port in between. If that
                // happens we must fail rather than silently leaving the daemon without an RPC.
                const isRpcPortTaken = await tcpPortUsed.check(Number(pkcRpcUrl.port), rpcConnectHostname);
                if (isRpcPortTaken) {
                    throw new Error(
                        `PKC RPC port ${pkcRpcUrl.hostname}:${pkcRpcUrl.port} (${pkcRpcUrl}) became occupied before the daemon could bind it.`
                    );
                }

                // Load installed challenge packages before starting the RPC server
                const loadedChallenges = await loadChallengesIntoPKC(mergedPkcOptions.dataPath);
                if (loadedChallenges.length > 0)
                    console.log(`Loaded challenge packages: ${loadedChallenges.map(formatChallengeNameVersion).join(", ")}`);

                daemonServer = await startDaemonServer(pkcRpcUrl, ipfsGatewayEndpoint, mergedPkcOptions, {
                    allowPrivateKeyExport: flags.allowPrivateKeyExport
                });

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
                // Test hook (issue #70): hold off the kubo teardown for a fixed delay so a test can
                // deterministically reproduce the window where the daemon's RPC port is already free
                // (daemonServer.destroy() runs in parallel) but kubo is still alive and bound. This is
                // exactly the window `update install` must not restart into — see
                // test/cli/update-install-restart-race.test.ts. The daemon process stays alive for the
                // duration because the exit hook awaits killKuboProcess() before exiting.
                const kuboShutdownDelayRaw = process.env["PKC_CLI_TEST_KUBO_SHUTDOWN_DELAY_MS"];
                const kuboShutdownDelay = kuboShutdownDelayRaw ? Number(kuboShutdownDelayRaw) : 0;
                if (Number.isFinite(kuboShutdownDelay) && kuboShutdownDelay > 0)
                    await new Promise((resolve) => setTimeout(resolve, kuboShutdownDelay));
                // Wait (bounded) for any in-flight start attempt so we kill the kubo it may still
                // spawn. Both promises settle on all failure paths (issue #70), but a spawned kubo
                // that wedges before "Daemon is ready" without exiting keeps them pending — the
                // bound ensures shutdown still reaches the SIGINT/SIGKILL flow below, which kills
                // it via kuboProcess (set in onSpawn) or the liveKuboPids sweep (PR #71 review).
                const inFlightStarts = [keepKuboUpInFlight, pendingKuboStart]
                    .filter((promise) => promise !== undefined)
                    .map((promise) => promise.catch(() => {}));
                if (inFlightStarts.length > 0)
                    await Promise.race([
                        Promise.all(inFlightStarts),
                        new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref())
                    ]);
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
                // Defense in depth: SIGKILL any spawned kubo that slipped out of kuboProcess
                // tracking (e.g. via a state race) so nothing outlives the daemon (issue #70)
                for (const pid of liveKuboPids) killKuboProcessGroup(pid, "SIGKILL");
                liveKuboPids.clear();
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

                    // Remove daemon state file so update install knows we're gone
                    await deleteDaemonState(process.pid).catch(() => {});

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
                { wait: DAEMON_SHUTDOWN_TIMEOUT_MS } // could take two minutes to shut down
            );

            // Emergency cleanup: if the process force-exits (e.g. double Ctrl+C),
            // synchronously SIGKILL every live kubo's process group. This is a no-op if
            // killKuboProcess() already ran (it clears kuboProcess and liveKuboPids).
            process.on("exit", () => {
                if (kuboProcess?.pid) {
                    killKuboProcessGroup(kuboProcess.pid, "SIGKILL");
                }
                for (const pid of liveKuboPids) killKuboProcessGroup(pid, "SIGKILL");
            });

            // Persistent signal guard (issue #70): exit-hook registers its SIGINT/SIGTERM handlers
            // with process.once, so its listener vanishes from the listener list the moment a
            // signal is dispatched. signal-exit (loaded by @pkcprotocol/proper-lock-file and other
            // dependencies) re-raises the signal when every remaining listener is its own — which
            // would kill the process while the async exit hook above is still shutting kubo down.
            // A persistent non-signal-exit listener keeps that heuristic from ever firing.
            // A repeated signal force-quits immediately (impatient Ctrl+C): process.exit triggers
            // the emergency "exit" handler above, which SIGKILLs every live kubo.
            let terminationSignalCount = 0;
            for (const signal of ["SIGINT", "SIGTERM"] as const) {
                process.on(signal, () => {
                    terminationSignalCount++;
                    if (terminationSignalCount >= 2) {
                        log(`Received ${signal} again during shutdown, force-quitting`);
                        process.exit(signal === "SIGINT" ? 130 : 143);
                    }
                });
            }

            // Test hook (issue #70): simulates a dependency registering a signal-exit handler
            // AFTER the asyncExitHook above — what @pkcprotocol/proper-lock-file (and the
            // signal-exit copies under ink/restore-cursor) do at module load. signal-exit
            // re-raises the signal when every remaining listener belongs to the signal-exit
            // family (`if (listeners.length === count) { ... process.kill(process.pid, s) }`),
            // which kills the daemon while the async exit hook is still cleaning up kubo —
            // exit-hook registers with process.once, so its listener is already gone by then.
            if (process.env["PKC_CLI_TEST_SIMULATE_LATE_SIGNAL_EXIT"]) {
                for (const signal of ["SIGINT", "SIGTERM"] as const) {
                    // Real signal-exit copies only count each other as "family" (via a shared
                    // global marker); any other listener makes them defer. Identify family by
                    // source: signal-exit's dispatcher carries the "an exit is coming" comment.
                    const isSignalExitFamily = (listener: NodeJS.SignalsListener) =>
                        String(listener).includes("an exit is coming");
                    const reRaiser = () => {
                        const onlyFamilyLeft = process
                            .listeners(signal)
                            .every((listener) => listener === reRaiser || isSignalExitFamily(listener));
                        if (onlyFamilyLeft) {
                            process.removeListener(signal, reRaiser);
                            process.kill(process.pid, signal);
                        }
                    };
                    process.on(signal, reRaiser);
                }
            }

            // RPC port was already verified free above (fail-fast); only the kuboRpcClientsOptions branch skips local kubo.
            if (!pkcOptionsFromFlag?.kuboRpcClientsOptions) await keepKuboUp();
            await createOrConnectRpc();

            keepKuboUpInterval = setInterval(async () => {
                if (mainProcessExited) return;
                await runKeepKuboUpTick({
                    pkcRpcUrl,
                    tcpPortUsedCheck: (port, host) => tcpPortUsed.check(port, host),
                    pkcOptionsFromFlag,
                    hasKuboProcess: !!kuboProcess,
                    hasPendingKuboStart: !!pendingKuboStart,
                    keepKuboUp,
                    createOrConnectRpc,
                    onError: (msg) => log.trace(msg)
                });
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
