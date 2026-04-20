import os from "os";
import path from "path";
import fs from "fs";
import * as fsPromises from "fs/promises";
import stripJsonComments from "strip-json-comments";
import PKCLogger from "@pkcprotocol/pkc-logger";
export { PKCLogger };

export type PKCLoggerType = typeof PKCLogger & {
    inspectOpts?: { depth?: number; colors?: boolean; [key: string]: any };
};

/**
 * Read _PKC_DEBUG / DEBUG env vars and configure the Logger instance.
 * Does NOT redirect output — debug logs go to stderr (the default for the debug module).
 *
 * @param options.enableDefaultNamespace - If true, enable "bitsocial*,pkc*,-pkc*trace"
 *   when no DEBUG env is set (used by daemon). If false, only enable if user
 *   explicitly set DEBUG or _PKC_DEBUG (used by non-daemon commands).
 */
export function setupDebugLogger(
    Logger: PKCLoggerType,
    options: { enableDefaultNamespace?: boolean } = {}
): { debugNamespace: string | undefined; debugDepth: number } {
    const envDebug: string | undefined = process.env["_PKC_DEBUG"] || process.env["DEBUG"];
    const debugNamespace = envDebug === "0" || envDebug === "" ? undefined : envDebug;

    const debugDepth = process.env["DEBUG_DEPTH"] ? parseInt(process.env["DEBUG_DEPTH"]) : 10;
    Logger.inspectOpts = Logger.inspectOpts || {};
    Logger.inspectOpts.depth = debugDepth;

    const defaultNamespace = "bitsocial*,pkc*,-pkc*trace";

    if (debugNamespace) {
        Logger.enable(debugNamespace);
    } else if (options.enableDefaultNamespace) {
        Logger.enable(defaultNamespace);
    }

    return { debugNamespace, debugDepth };
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

export async function loadKuboConfigFile(pkcDataPath: string): Promise<any | undefined> {
    const kuboConfigPath = path.join(pkcDataPath, ".ipfs-bitsocial-cli", "config");

    if (!fs.existsSync(kuboConfigPath)) return undefined;

    const kuboConfig = JSON.parse((await fsPromises.readFile(kuboConfigPath)).toString());
    return kuboConfig;
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

export async function parseMultiAddrKuboRpcToUrl(kuboMultiAddrString: string) {
    const multiAddrObj = await parseMultiAddr(kuboMultiAddrString);
    const parsed = multiAddrToHostPort(multiAddrObj);
    if (!parsed) throw new Error(`Unable to parse kubo RPC multiaddr: ${kuboMultiAddrString}`);
    return new URL(`http://${parsed.host}:${parsed.port}/api/v0`);
}

export async function parseMultiAddrIpfsGatewayToUrl(ipfsGatewaymultiAddrString: string) {
    const multiAddrObj = await parseMultiAddr(ipfsGatewaymultiAddrString);
    const parsed = multiAddrToHostPort(multiAddrObj);
    if (!parsed) throw new Error(`Unable to parse IPFS gateway multiaddr: ${ipfsGatewaymultiAddrString}`);
    return new URL(`http://${parsed.host}:${parsed.port}`);
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
