import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import fs from "fs";
import * as fsPromises from "fs/promises";
import * as remeda from "remeda";
import assert from "assert";
import tcpPortUsed from "tcp-port-used";
import { path as ipfsExePathFunc } from "kubo";
import { PKCLogger } from "../util.js";

async function getKuboExePath(): Promise<string> {
    return ipfsExePathFunc();
}

async function getKuboVersion(): Promise<string> {
    const kuboPackageJson = await import("kubo/package.json", { with: { type: "json" } });
    return kuboPackageJson.default.version;
}

export async function mergeCliDefaultsIntoIpfsConfig(log: any, ipfsConfigPath: string, apiUrl: URL, gatewayUrl: URL) {
    const currentIpfsConfigFile = JSON.parse((await fsPromises.readFile(ipfsConfigPath)).toString());
    const existingGatewayConfig = currentIpfsConfigFile["Gateway"] ?? {};
    const existingPublicGatewaysConfig = existingGatewayConfig["PublicGateways"] ?? {};
    const gatewayPublicGateways: Record<string, any> = {};

    for (const [hostname, gatewayConfig] of Object.entries(existingPublicGatewaysConfig)) {
        if (typeof gatewayConfig === "object" && gatewayConfig !== null) {
            gatewayPublicGateways[hostname] = { ...gatewayConfig, UseSubdomains: false };
        } else {
            gatewayPublicGateways[hostname] = { UseSubdomains: false };
        }
    }

    const canonicalGatewayHostname = gatewayUrl.hostname.includes(":") ? `[${gatewayUrl.hostname}]` : gatewayUrl.hostname;
    const hostnamesForDefaults = new Set<string>([canonicalGatewayHostname, "localhost", "127.0.0.1", "[::1]"]);

    for (const hostname of hostnamesForDefaults) {
        if (!hostname) continue;
        const existingConfig = gatewayPublicGateways[hostname];
        const normalizedExistingConfig = typeof existingConfig === "object" && existingConfig !== null ? { ...existingConfig } : {};
        const paths =
            Array.isArray(normalizedExistingConfig.Paths) && normalizedExistingConfig.Paths.length > 0
                ? normalizedExistingConfig.Paths
                : ["/ipfs/", "/ipns/"];

        gatewayPublicGateways[hostname] = {
            ...normalizedExistingConfig,
            InlineDNSLink: normalizedExistingConfig.InlineDNSLink !== undefined ? normalizedExistingConfig.InlineDNSLink : false,
            UseSubdomains: false,
            Paths: paths
        };
    }

    const mergedIpfsConfig = {
        ...currentIpfsConfigFile,
        Addresses: {
            ...(currentIpfsConfigFile["Addresses"] ?? {}),
            Gateway: `/ip4/${gatewayUrl.hostname}/tcp/${gatewayUrl.port}`,
            API: `/ip4/${apiUrl.hostname}/tcp/${apiUrl.port}`
        },
        AutoTLS: {
            ...(currentIpfsConfigFile["AutoTLS"] ?? {}),
            Enabled: true
        },
        Gateway: {
            ...existingGatewayConfig,
            PublicGateways: gatewayPublicGateways
        }
    };

    await fsPromises.writeFile(ipfsConfigPath, JSON.stringify(mergedIpfsConfig, null, 4));
    log("Applied bitsocial CLI defaults to freshly initialized IPFS config.", ipfsConfigPath);
}

// use this custom function instead of spawnSync for better logging
// also spawnSync might have been causing crash on start on windows

// Listens on 'close' (not 'exit') so all stderr 'data' events have been delivered
// before we read errorMessage — otherwise on macOS a fast-exiting child can deliver
// its exit signal before its stderr drains, producing a rejection with an empty
// message and breaking the "configuration file already exists" suppression upstream.
export function _gatherChildOutput(log: any, child: ChildProcessWithoutNullStreams): Promise<null> {
    return new Promise((resolve, reject) => {
        let errorMessage = "";
        child.on("close", (exitCode, signal) => {
            if (exitCode === 0) return resolve(null);
            const error = new Error(errorMessage);
            Object.assign(error, { exitCode, pid: child.pid, signal });
            reject(error);
        });
        child.stderr.on("data", (data) => {
            log.trace(data.toString());
            errorMessage += data.toString();
        });
        child.stdin.on("data", (data) => log.trace(data.toString()));
        child.stdout.on("data", (data) => log.trace(data.toString()));
        child.on("error", (data) => {
            errorMessage += data.toString();
            log.error(data.toString());
        });
    });
}

function _spawnAsync(log: any, ...args: any[]) {
    //@ts-ignore
    const child: ChildProcessWithoutNullStreams = spawn(...args);
    return _gatherChildOutput(log, child);
}

type MultiaddrComponent = { name: string; value?: string };
type MultiaddrModule = {
    multiaddr: (multiAddr: string) => {
        getComponents(): MultiaddrComponent[];
    };
};

let cachedMultiaddrFactory: MultiaddrModule["multiaddr"] | undefined;

async function getMultiaddrFactory(): Promise<MultiaddrModule["multiaddr"]> {
    if (!cachedMultiaddrFactory) {
        const module = (await import("@multiformats/multiaddr")) as MultiaddrModule;
        cachedMultiaddrFactory = module.multiaddr;
    }
    return cachedMultiaddrFactory;
}

async function parseTcpMultiaddr(multiAddrString: string): Promise<{ host: string; port: number } | undefined> {
    if (!multiAddrString) return undefined;
    try {
        const factory = await getMultiaddrFactory();
        const address = factory(multiAddrString);
        const components = address.getComponents();
        const tcpComponent = components.find((component) => component.name === "tcp");
        const hostComponent = components.find((component) => ["ip4", "ip6", "dns", "dns4", "dns6", "dnsaddr"].includes(component.name));
        const host = hostComponent?.value;
        const portValue = tcpComponent?.value ? Number(tcpComponent.value) : undefined;
        if (!host || !portValue || !Number.isFinite(portValue) || portValue <= 0) return undefined;
        return { host, port: portValue };
    } catch {
        return undefined;
    }
}

async function ensureIpfsPortsAreAvailable(log: any, configPath: string, apiUrl: URL, gatewayUrl: URL) {
    let configRaw: string;
    try {
        configRaw = await fsPromises.readFile(configPath, "utf-8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to read IPFS config at ${configPath} to validate ports: ${message}`);
    }

    let config: any;
    try {
        config = JSON.parse(configRaw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to parse IPFS config at ${configPath} to validate ports: ${message}`);
    }

    const addresses = config?.Addresses ?? {};
    const checks = new Map<string, { label: string; host: string; port: number; source: string }>();

    const addCheck = (label: string, host: string, port: number, source: string) => {
        if (!host || typeof host !== "string") return;
        if (!Number.isFinite(port) || port <= 0) return;
        const key = `${label}|${host}:${port}`;
        if (!checks.has(key)) checks.set(key, { label, host, port, source });
    };

    const apiMultiAddr = typeof addresses.API === "string" ? await parseTcpMultiaddr(addresses.API) : undefined;
    if (apiMultiAddr) addCheck("IPFS API", apiMultiAddr.host, apiMultiAddr.port, addresses.API);
    else if (apiUrl?.hostname) {
        const fallbackPort = Number(apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80));
        if (Number.isFinite(fallbackPort) && fallbackPort > 0) addCheck("IPFS API", apiUrl.hostname, fallbackPort, apiUrl.toString());
    }

    const gatewayMultiAddr = typeof addresses.Gateway === "string" ? await parseTcpMultiaddr(addresses.Gateway) : undefined;
    if (gatewayMultiAddr) addCheck("IPFS Gateway", gatewayMultiAddr.host, gatewayMultiAddr.port, addresses.Gateway);
    else if (gatewayUrl?.hostname) {
        const fallbackPort = Number(gatewayUrl.port || (gatewayUrl.protocol === "https:" ? 443 : 80));
        if (Number.isFinite(fallbackPort) && fallbackPort > 0)
            addCheck("IPFS Gateway", gatewayUrl.hostname, fallbackPort, gatewayUrl.toString());
    }

    const swarmAddresses: string[] = Array.isArray(addresses.Swarm)
        ? addresses.Swarm.filter((addr: any): addr is string => typeof addr === "string")
        : typeof addresses.Swarm === "string"
        ? [addresses.Swarm]
        : [];

    for (const swarmAddr of swarmAddresses) {
        const parsed = await parseTcpMultiaddr(swarmAddr);
        if (parsed) addCheck("IPFS Swarm", parsed.host, parsed.port, swarmAddr);
    }

    for (const check of checks.values()) {
        const inUse = await tcpPortUsed.check(check.port, check.host);
        log.trace?.(`Validating ${check.label} port ${check.host}:${check.port} (source: ${check.source}) - in use: ${inUse}`);
        if (inUse) {
            throw new Error(
                `Cannot start IPFS daemon because the ${check.label} port ${check.host}:${check.port} (configured as ${check.source}) is already in use.`
            );
        }
    }
}
export async function startKuboNode(
    apiUrl: URL,
    gatewayUrl: URL,
    dataPath: string,
    onSpawn?: (process: ChildProcessWithoutNullStreams) => void
): Promise<ChildProcessWithoutNullStreams> {
    return new Promise(async (resolve, reject) => {
        const log = PKCLogger("bitsocial-cli:ipfs:startKuboNode");
        const ipfsDataPath = process.env["IPFS_PATH"] || path.join(dataPath, ".bitsocial-cli.ipfs");
        await fs.promises.mkdir(ipfsDataPath, { recursive: true });
        const ipfsConfigPath = path.join(ipfsDataPath, "config");

        const kuboExePath = await getKuboExePath();
        const kuboVersion = await getKuboVersion();
        log(`Using Kubo version: ${kuboVersion}`);
        log(`IpfsDataPath (${ipfsDataPath}), kuboExePath (${kuboExePath})`, "kubo ipfs config file", path.join(ipfsDataPath, "config"));
        log("If you would like to change kubo config, please edit the config file at", path.join(ipfsDataPath, "config"));

        const env = { IPFS_PATH: ipfsDataPath, DEBUG_COLORS: "1" };

        let configJustInitialized = false;
        try {
            await _spawnAsync(log, kuboExePath, ["init"], { env, hideWindows: true });
            configJustInitialized = true;
        } catch (e) {
            const error = <Error>e;
            if (!error?.message?.includes("ipfs configuration file already exists!")) throw new Error("Failed to call ipfs init" + error);
        }
        if (configJustInitialized) {
            await _spawnAsync(log, kuboExePath, ["config", "profile", "apply", `server`], {
                env,
                hideWindows: true
            });
            log("Called 'ipfs config profile apply server' successfully");
            await mergeCliDefaultsIntoIpfsConfig(log, ipfsConfigPath, apiUrl, gatewayUrl);
        } else {
            log("IPFS config already exists; skipping config overrides to preserve user changes.");
        }

        try {
            await _spawnAsync(log, kuboExePath, ["repo", "migrate"], { env, hideWindows: true });
            log("Ensured IPFS repository is migrated to the latest supported version.");
        } catch (migrationError) {
            log.error("Failed to run IPFS repo migrations automatically", migrationError);
            throw migrationError;
        }

        try {
            await ensureIpfsPortsAreAvailable(log, ipfsConfigPath, apiUrl, gatewayUrl);
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }

        const daemonArgs = ["--enable-namesys-pubsub", "--migrate"];

        const kuboProcess: ChildProcessWithoutNullStreams = spawn(kuboExePath, ["daemon", ...daemonArgs], {
            env,
            cwd: process.cwd(),
            detached: true
        });
        onSpawn?.(kuboProcess);
        log.trace(`Kubo ipfs daemon process started with pid ${kuboProcess.pid} and args`, daemonArgs);

        let lastError: string = "Kubo process exited before Daemon was ready."; // Default error for premature exit
        let daemonReady = false;

        // Define handlers upfront to allow removal
        const onProcessExit = () => {
            if (!daemonReady) {
                // Only reject if daemon wasn't ready (i.e., startup failed)
                log.error(`Kubo ipfs process with pid ${kuboProcess.pid} exited prematurely. Last error: ${lastError}`);
                // Clean up all listeners associated with this promise to prevent multiple rejections or logs from this context
                kuboProcess.removeAllListeners();
                reject(new Error(lastError));
            } else {
                // If daemon was already ready, this exit is handled by listeners in daemon.ts (e.g., keepKuboUp or asyncExitHook)
                log.trace(`Kubo ipfs process with pid ${kuboProcess.pid} exited after daemon was ready.`);
            }
        };

        const onProcessError = (err: Error) => {
            lastError = err.message || "Kubo process encountered an error during startup.";
            log.error(`Kubo process error: ${lastError}`);
            if (!daemonReady) {
                // Only reject if daemon wasn't ready
                kuboProcess.removeAllListeners();
                reject(err);
            }
        };

        const onDaemonReadyOutput = (data: Buffer | string) => {
            const output = data.toString();
            log.trace(output);
            if (output.match("Daemon is ready")) {
                daemonReady = true;
                assert(typeof kuboProcess.pid === "number", `kuboProcess.pid (${kuboProcess.pid}) is not a valid pid`);

                const delayRaw = process.env["PKC_CLI_TEST_IPFS_READY_DELAY_MS"];
                const readyDelay = delayRaw ? Number(delayRaw) : 0;
                const completeResolve = () => {
                    // IMPORTANT: Remove promise-specific handlers once startup is successful
                    kuboProcess.removeListener("exit", onProcessExit);
                    kuboProcess.removeListener("error", onProcessError);
                    // Stderr listener can remain for ongoing logging if desired, or be removed too.
                    // kuboProcess.stderr.removeListener("data", onStderrData); // If you want to stop this specific stderr logging

                    resolve(kuboProcess);
                };

                if (Number.isFinite(readyDelay) && readyDelay > 0) setTimeout(completeResolve, readyDelay);
                else completeResolve();
            }
        };

        const onStderrData = (data: Buffer | string) => {
            const errorOutput = data.toString();
            lastError = errorOutput; // Keep track of the last thing seen on stderr for error reporting
            log.error(errorOutput); // Log all stderr output
        };

        kuboProcess.stderr.on("data", onStderrData);
        // kuboProcess.stdin.on("data", (data) => log.trace(data.toString())); // Listening on child's stdin is unusual, usually for writing.
        kuboProcess.stdout.on("data", onDaemonReadyOutput);
        kuboProcess.on("error", onProcessError); // For spawn errors or other direct errors from the process object itself
        kuboProcess.on("exit", onProcessExit); // For when the process terminates
    });
}
