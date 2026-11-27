import os from "os";
import path from "path";
import fs from "fs";
import net from "net";
import * as fsPromises from "fs/promises";
import stripJsonComments from "strip-json-comments";
import PKCLoggerModule, { createLogger, type Logger as PKCLoggerInstance } from "@pkcprotocol/pkc-logger";

export type { PKCLoggerInstance };

let cliLoggerRoot: PKCLoggerInstance | undefined;

/**
 * The process's single logger root. Every `PKCLogger({ namespace })` in the cli is a child of it, and the daemon and
 * the RPC client commands pass it to pkc-js as `pkcOptions.logger.instance`. pkc-js's Node bundle carries its own copy
 * of pkc-logger and `debug`, whose enable state is fixed when its chunk first loads; with the root injected, pkc-js
 * logs through this package's `debug` instead, the one `setupDebugLogger` enables, whatever the module load order
 * (issue #292). It also gives the daemon one buffer and one listener for its own, pkc-js's and the RPC server's lines.
 */
export function getCliLoggerRoot(): PKCLoggerInstance {
    return (cliLoggerRoot ??= createLogger());
}

type PKCLoggerFn = ((options: { namespace: string; tags?: Record<string, string | undefined> }) => PKCLoggerInstance) & {
    enable: (namespaces: string) => void;
    disable: () => void;
    enabled: (namespaces: string) => boolean;
};

/** A child of the cli's logger root. Same call shape as pkc-logger's default export. */
export const PKCLogger: PKCLoggerFn = Object.assign((options: { namespace: string; tags?: Record<string, string | undefined> }) => {
    if (!options?.namespace) throw new Error("PKCLogger({ namespace }) requires a namespace");
    return getCliLoggerRoot().child(options);
}, {
    enable: (namespaces: string) => PKCLoggerModule.enable(namespaces),
    disable: () => PKCLoggerModule.disable(),
    enabled: (namespaces: string) => PKCLoggerModule.enabled(namespaces)
});

export type PKCLoggerType = typeof PKCLogger;

export const DEFAULT_DEBUG_NAMESPACE = "bitsocial*,pkc*,-pkc*trace";

/**
 * Read _PKC_DEBUG / DEBUG env vars and configure the Logger instance.
 * Does NOT redirect output — debug logs go to stderr (the default for the debug module).
 *
 * @param options.enableDefaultNamespace - If true, enable "bitsocial*,pkc*,-pkc*trace"
 *   when no DEBUG env is set (used by daemon). If false, only enable if user
 *   explicitly set DEBUG or _PKC_DEBUG (used by non-daemon commands).
 * @param options.alwaysEnabled - namespaces appended to whatever is enabled (the daemon's stdout/stderr capture).
 */
export function setupDebugLogger(
    Logger: Pick<PKCLoggerType, "enable">,
    options: { enableDefaultNamespace?: boolean; alwaysEnabled?: string[] } = {}
): { debugNamespace: string | undefined; enabledNamespaces: string | undefined } {
    const envDebug: string | undefined = process.env["_PKC_DEBUG"] || process.env["DEBUG"];
    const debugNamespace = envDebug === "0" || envDebug === "" ? undefined : envDebug;

    const selected = debugNamespace ?? (options.enableDefaultNamespace ? DEFAULT_DEBUG_NAMESPACE : undefined);
    const enabledNamespaces = [selected, ...(options.alwaysEnabled ?? [])].filter(Boolean).join(",") || undefined;
    if (enabledNamespaces) Logger.enable(enabledNamespaces);

    return { debugNamespace, enabledNamespaces };
}

export function getLanIpV4Address(): string | undefined {
    const allInterfaces = os.networkInterfaces();
    for (const k in allInterfaces) {
        const specificInterfaceInfos = allInterfaces[k];
        if (!specificInterfaceInfos) continue;

        const lanAddress: string | undefined = specificInterfaceInfos.filter((info) => info.family === "IPv4" && !info.internal)[0]
            ?.address;
        if (lanAddress) return lanAddress;
    }
    return undefined;
}

// The one place that decides where the kubo repo lives. Everything that spawns kubo or reads or
// writes its config must go through this, so they can never disagree on the directory (issue #200).
export function resolveKuboRepoPath(pkcDataPath: string): string {
    return process.env["IPFS_PATH"] || path.join(pkcDataPath, ".bitsocial-cli.ipfs");
}

export async function loadKuboConfigFile(pkcDataPath: string): Promise<any | undefined> {
    const kuboConfigPath = path.join(resolveKuboRepoPath(pkcDataPath), "config");

    if (!fs.existsSync(kuboConfigPath)) return undefined;

    const kuboConfig = JSON.parse((await fsPromises.readFile(kuboConfigPath)).toString());
    return kuboConfig;
}

// Which kubo RPC this data path talks to, for commands that have no daemon flags to consider.
export async function resolveKuboRpcUrl(pkcDataPath: string, envValue: string | undefined, fallback: URL): Promise<URL> {
    if (envValue) return new URL(envValue);
    return (await kuboRpcUrlFromKuboConfig(await loadKuboConfigFile(pkcDataPath))) ?? fallback;
}

async function parseMultiAddr(multiAddrString: string) {
    const module = await import("@multiformats/multiaddr");
    return module.multiaddr(multiAddrString);
}

function multiAddrToHostPort(multiAddrObj: { getComponents: () => { name: string; value?: string }[] }) {
    const components = multiAddrObj.getComponents();
    const hostComponent = components.find((component) => ["ip4", "ip6", "dns", "dns4", "dns6", "dnsaddr"].includes(component.name));
    const tcpComponent = components.find((component) => component.name === "tcp");
    const host = hostComponent?.value;
    const port = tcpComponent?.value ? Number(tcpComponent.value) : undefined;
    if (!host || !port || !Number.isFinite(port) || port <= 0) return undefined;
    return { host, port };
}

// new URL(route, base) would drop the /api/v0 prefix, because the base has no trailing slash.
export const kuboApiRouteUrl = (endpoint: URL, route: string) => {
    const url = new URL(endpoint.toString());
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${route}`;
    return url;
};

export const hostForUrl = (host: string) => (host.includes(":") && !host.startsWith("[") ? `[${host}]` : host);

/** The host to dial, for a connectivity check or a client URL. Sockets need IPv6 hosts without the
 * brackets a URL keeps, and a wildcard bind address is reached over loopback (macOS rejects connect to
 * 0.0.0.0 with EINVAL). */
export function toConnectableHostname(hostname: string): string {
    const bare = hostname.replace(/^\[(.*)\]$/, "$1");
    if (bare === "0.0.0.0") return "127.0.0.1";
    if (bare === "::") return "::1";
    return bare;
}

export async function parseMultiAddrKuboRpcToUrl(kuboMultiAddrString: string) {
    const multiAddrObj = await parseMultiAddr(kuboMultiAddrString);
    const parsed = multiAddrToHostPort(multiAddrObj);
    if (!parsed) throw new Error(`Unable to parse kubo RPC multiaddr: ${kuboMultiAddrString}`);
    return new URL(`http://${hostForUrl(toConnectableHostname(parsed.host))}:${parsed.port}/api/v0`);
}

export async function parseMultiAddrIpfsGatewayToUrl(ipfsGatewaymultiAddrString: string) {
    const multiAddrObj = await parseMultiAddr(ipfsGatewaymultiAddrString);
    const parsed = multiAddrToHostPort(multiAddrObj);
    if (!parsed) throw new Error(`Unable to parse IPFS gateway multiaddr: ${ipfsGatewaymultiAddrString}`);
    return new URL(`http://${hostForUrl(toConnectableHostname(parsed.host))}:${parsed.port}`);
}

// Kubo accepts Addresses.API and Addresses.Gateway as a string or a list, and either can be empty
// (disabled) or a /unix socket, which has no URL form here. Take the first usable entry; undefined
// tells the caller to fall back to its defaults.
async function firstUsableKuboAddress(addresses: unknown, parse: (multiAddr: string) => Promise<URL>): Promise<URL | undefined> {
    for (const address of Array.isArray(addresses) ? addresses : [addresses]) {
        if (typeof address !== "string" || !address) continue;
        try {
            return await parse(address);
        } catch {
            continue;
        }
    }
    return undefined;
}

export function kuboRpcUrlFromKuboConfig(kuboConfig: any): Promise<URL | undefined> {
    return firstUsableKuboAddress(kuboConfig?.Addresses?.API, parseMultiAddrKuboRpcToUrl);
}

export function ipfsGatewayUrlFromKuboConfig(kuboConfig: any): Promise<URL | undefined> {
    return firstUsableKuboAddress(kuboConfig?.Addresses?.Gateway, parseMultiAddrIpfsGatewayToUrl);
}

const urlPort = (url: URL) => Number(url.port || (url.protocol === "https:" ? 443 : 80));

/** Every usable listener in a kubo Addresses.API / Addresses.Gateway value (string or list), with
 * the host exactly as bound. Empty entries, /unix sockets and unparsable entries are skipped. */
async function kuboListenersFromAddresses(addresses: unknown): Promise<{ host: string; port: number }[]> {
    const listeners: { host: string; port: number }[] = [];
    for (const address of Array.isArray(addresses) ? addresses : [addresses]) {
        if (typeof address !== "string" || !address) continue;
        try {
            const parsed = multiAddrToHostPort(await parseMultiAddr(address));
            if (parsed) listeners.push(parsed);
        } catch {
            continue;
        }
    }
    return listeners;
}

const isWildcardBind = (host: string) => host === "0.0.0.0" || host === "::";

const isLoopbackLiteral = (host: string) => host === "127.0.0.1" || host === "::1";

/** Whether two connectable hostnames reach the same listener. `localhost` resolves to either loopback
 * literal and the connect falls back across families, so it matches both; `127.0.0.1` and `::1` are
 * different listeners, since a kubo bound on one refuses a dial to the other. */
const sameConnectableHost = (a: string, b: string) =>
    a === b || (a === "localhost" && isLoopbackLiteral(b)) || (b === "localhost" && isLoopbackLiteral(a));

/** For a locally managed kubo the daemon never rewrites Addresses.* of an existing repo, so an env
 * override that differs from the config leaves kubo on one port and the daemon dialling another.
 * `configured` is the raw Addresses.API / Addresses.Gateway value, since kubo listens on every entry
 * of a list and a wildcard bind is reachable on any host. Returns the warning to print, or undefined
 * when the override reaches a configured listener or that cannot be judged offline. */
export async function describeKuboEndpointMismatch({
    envVar,
    configField,
    configPath,
    configured,
    chosen
}: {
    envVar: string;
    configField: string;
    configPath: string;
    configured: unknown;
    chosen: URL;
}): Promise<string | undefined> {
    const listeners = await kuboListenersFromAddresses(configured);
    if (listeners.length === 0) return undefined;
    const chosenHost = toConnectableHostname(chosen.hostname);
    // A DNS name other than localhost needs a lookup to compare; stay quiet rather than guess.
    if (chosenHost !== "localhost" && net.isIP(chosenHost) === 0) return undefined;
    // Kubo serves its RPC and gateway over plain http, so an https override never reaches it.
    const reachable =
        chosen.protocol === "http:" &&
        listeners.some(
            (listener) =>
                listener.port === urlPort(chosen) && (isWildcardBind(listener.host) || sameConnectableHost(listener.host, chosenHost))
        );
    if (reachable) return undefined;
    const configuredText = typeof configured === "string" ? configured : JSON.stringify(configured);
    return (
        `${envVar} is ${chosen} but ${configField} in ${configPath} is ${configuredText}. ` +
        `The daemon starts kubo from that config and dials ${envVar}, so it will not reach kubo. ` +
        `Unset ${envVar} to follow the config, or edit ${configField} to match.`
    );
}

/** Recursively replaces all `null` values with `undefined`.
 * Used before calling community.edit() since pkc-js expects `undefined` for removal,
 * but JSON/CLI input produces `null`. */
export function replaceNullWithUndefined(obj: any): any {
    if (obj === null) return undefined;
    if (Array.isArray(obj)) return obj.map(replaceNullWithUndefined);
    if (typeof obj === "object" && obj.constructor === Object) {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = replaceNullWithUndefined(value);
        }
        return result;
    }
    return obj;
}

/**
 * Custom merge function that implements CLI-specific merge behavior.
 * This matches the expected behavior from the test suite.
 */
export function mergeDeep(target: any, source: any, arrayStrategy: "concat" | "replace" = "concat"): any {
    function isObject(item: any): boolean {
        return item && typeof item === "object" && !Array.isArray(item);
    }

    function isPlainObject(item: any): boolean {
        return isObject(item) && item.constructor === Object;
    }

    // Handle arrays with CLI-specific behavior
    if (Array.isArray(target) && Array.isArray(source)) {
        // RFC 7396 JSON Merge Patch: arrays are replaced entirely
        if (arrayStrategy === "replace") {
            return source;
        }

        // Check if source is sparse (has holes/empty items) - indicates indexed assignment like --rules[2]
        const sourceHasHoles = source.length !== Object.keys(source).length;

        if (sourceHasHoles) {
            // Sparse array: merge by index, extending to accommodate both arrays
            const maxLength = Math.max(target.length, source.length);
            const result = new Array(maxLength);

            for (let i = 0; i < maxLength; i++) {
                if (i in source) {
                    if (i in target && isPlainObject(target[i]) && isPlainObject(source[i])) {
                        result[i] = mergeDeep(target[i], source[i], arrayStrategy);
                    } else {
                        result[i] = source[i];
                    }
                } else if (i in target) {
                    result[i] = target[i];
                }
                // If neither has this index, it remains undefined
            }

            return result;
        } else {
            // Dense array: CLI behavior is to extend the array to include both original and new values
            // This creates: [source[0], source[1], target[2], target[3], ...]
            const maxLength = target.length + source.length;
            const result = new Array(maxLength);

            // First, place source values at the beginning
            for (let i = 0; i < source.length; i++) {
                result[i] = source[i];
            }

            // Then, place target values at their original indices (beyond source length)
            for (let i = source.length; i < maxLength; i++) {
                const targetIndex = i; // Use the same index, not shifted
                if (targetIndex < target.length) {
                    result[i] = target[targetIndex];
                } else {
                    result[i] = undefined;
                }
            }

            return result;
        }
    }

    // Handle plain objects
    if (isPlainObject(target) && isPlainObject(source)) {
        const result = { ...target };

        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (Array.isArray(target[key]) && Array.isArray(source[key])) {
                    result[key] = mergeDeep(target[key], source[key], arrayStrategy);
                } else if (isPlainObject(target[key]) && isPlainObject(source[key])) {
                    result[key] = mergeDeep(target[key], source[key], arrayStrategy);
                } else {
                    result[key] = source[key];
                }
            }
        }

        return result;
    }

    // If not both objects/arrays, source takes precedence
    return source;
}

export async function parseJsoncFile(filePath: string): Promise<Record<string, unknown>> {
    const fileContent = await fsPromises.readFile(filePath, "utf-8");
    const stripped = stripJsonComments(fileContent);
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripped);
    } catch (e) {
        if (e instanceof SyntaxError) {
            throw new Error(`Invalid JSONC in file ${filePath}: ${e.message}`);
        }
        throw e;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSONC file must contain a JSON object (not an array, null, string, or number)");
    }
    return parsed as Record<string, unknown>;
}
