import { X509Certificate } from "crypto";
import fs from "fs/promises";
import net from "net";
import path from "path";
import type { KuboEditRecord } from "./kubo-config.js";

export const REACHABILITY_CONFIG_VERSION = 1;

const REACHABILITY_MODES = [
    "webtransport-only",
    "ip",
    "domain",
    "ip+domain",
    "reverse-proxy",
    "ip+reverse-proxy",
    "domain+reverse-proxy",
    "ip+domain+reverse-proxy"
] as const;

export type ReachabilityMode = (typeof REACHABILITY_MODES)[number];

// Written by setup, enable and disable, and by the daemon when an IP change alters the addresses.
export interface ReachabilityConfig {
    version: typeof REACHABILITY_CONFIG_VERSION;
    enabled: boolean;
    mode: ReachabilityMode;
    wsPort: number;
    announce: string[];
    // False while kubo has only its UDP 443 listeners, because nothing can terminate WSS yet.
    serveWss?: boolean;
    publicIps: string[];
    domain?: string;
    // Set by --force: a proxy answers for this name, so its records are not expected to match our IPs.
    domainForced?: boolean;
    // Addresses served by the operator's own proxy, each verified by a libp2p dial.
    externalAnnounce?: string[];
    // Names the daemon stopped announcing after 24 hours of failure, restored when they recover.
    droppedAnnounce?: string[];
    staging: boolean;
    acmeDirectory: string;
    caddyAdminPort: number;
    // Stored so the daemon regenerates the same Caddyfile. Non-default only in tests.
    httpsPort?: number;
    httpPort?: number;
    acmeTrustedRootsPath?: string;
    kuboEdits?: KuboEditRecord;
}

// Written only by the daemon, in its own file so a check landing mid-setup cannot overwrite the
// operator's config with a stale copy.
export interface ReachabilityRuntimeStatus {
    updatedAt: string;
    lastIpCheck?: { at: string; publicIps: string[] };
    domains?: Record<string, { lastCheckAt: string; ok: boolean; failingSince?: string; droppedFromAnnounce?: boolean }>;
    caddy?: { running: boolean; lastExitAt?: string };
}

export interface CertificateInfo {
    issuer: string;
    names: string[];
    notAfter: string;
    hoursLeft: number;
}

export interface ReachabilityStatus {
    configured: boolean;
    enabled: boolean;
    mode: ReachabilityMode | null;
    addresses: string[];
    wsPort: number | null;
    domain: string | null;
    staging: boolean;
    certificates: CertificateInfo[];
    lastChecks: ReachabilityRuntimeStatus | null;
}

export const reachabilityDir = (dataPath: string) => path.join(dataPath, "reachability");
export const reachabilityConfigPath = (dataPath: string) => path.join(reachabilityDir(dataPath), "config.json");
export const reachabilityRuntimeStatusPath = (dataPath: string) => path.join(reachabilityDir(dataPath), "runtime-status.json");
export const readReachabilityRuntimeStatus = (dataPath: string) => readRuntimeStatus(dataPath);
export const caddyDataDir = (dataPath: string) => path.join(reachabilityDir(dataPath), "caddy-data");

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");

function assertValidConfig(parsed: any, configPath: string): asserts parsed is ReachabilityConfig {
    const fail = (reason: string): never => {
        throw new Error(`Invalid reachability config at ${configPath}: ${reason}`);
    };
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail("expected a JSON object");
    if (typeof parsed.version !== "number") fail("missing version");
    // Rewriting a newer file with this version's schema would silently lose fields, so refuse.
    if (parsed.version > REACHABILITY_CONFIG_VERSION)
        fail(`version ${parsed.version} was written by a newer bitsocial-cli; this one understands up to ${REACHABILITY_CONFIG_VERSION}. Update bitsocial-cli`);
    if (parsed.version < 1) fail(`unknown version ${parsed.version}`);
    if (typeof parsed.enabled !== "boolean") fail("enabled must be a boolean");
    if (!REACHABILITY_MODES.includes(parsed.mode)) fail(`unknown mode ${JSON.stringify(parsed.mode)}`);
    if (!Number.isInteger(parsed.wsPort) || parsed.wsPort < 1 || parsed.wsPort > 65535) fail("wsPort must be a port number");
    if (parsed.serveWss !== undefined && typeof parsed.serveWss !== "boolean") fail("serveWss must be a boolean");
    if (!isStringArray(parsed.announce)) fail("announce must be a list of multiaddrs");
    if (!isStringArray(parsed.publicIps)) fail("publicIps must be a list of IP addresses");
    if (parsed.domain !== undefined && typeof parsed.domain !== "string") fail("domain must be a string");
    if (parsed.externalAnnounce !== undefined && !isStringArray(parsed.externalAnnounce)) fail("externalAnnounce must be a list of multiaddrs");
    if (parsed.droppedAnnounce !== undefined && !isStringArray(parsed.droppedAnnounce)) fail("droppedAnnounce must be a list of multiaddrs");
    if (typeof parsed.staging !== "boolean") fail("staging must be a boolean");
    if (typeof parsed.acmeDirectory !== "string") fail("acmeDirectory must be a URL");
    if (!Number.isInteger(parsed.caddyAdminPort)) fail("caddyAdminPort must be a port number");
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in ${filePath}: ${(error as Error).message}`);
    }
}

// Write then rename, so a crash or a concurrent reader never sees a half-written file. The temp name
// is unique per process because the daemon and a CLI command can both be writing.
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 4));
    await fs.rename(temporaryPath, filePath);
}

export async function readReachabilityConfig(dataPath: string): Promise<ReachabilityConfig | undefined> {
    const configPath = reachabilityConfigPath(dataPath);
    const parsed = await readJsonIfExists(configPath);
    if (parsed === undefined) return undefined;
    assertValidConfig(parsed, configPath);
    return parsed;
}

export const writeReachabilityConfig = (dataPath: string, config: ReachabilityConfig) =>
    writeJsonAtomic(reachabilityConfigPath(dataPath), config);

export const writeReachabilityRuntimeStatus = (dataPath: string, status: ReachabilityRuntimeStatus) =>
    writeJsonAtomic(reachabilityRuntimeStatusPath(dataPath), status);

const isPlainObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);

function isRuntimeStatus(value: unknown): value is ReachabilityRuntimeStatus {
    if (!isPlainObject(value) || typeof value["updatedAt"] !== "string") return false;
    const { lastIpCheck, domains, caddy } = value;
    if (lastIpCheck !== undefined && !(isPlainObject(lastIpCheck) && typeof lastIpCheck["at"] === "string" && isStringArray(lastIpCheck["publicIps"])))
        return false;
    if (domains !== undefined) {
        if (!isPlainObject(domains)) return false;
        for (const domain of Object.values(domains))
            if (!isPlainObject(domain) || typeof domain["lastCheckAt"] !== "string" || typeof domain["ok"] !== "boolean") return false;
    }
    return caddy === undefined || (isPlainObject(caddy) && typeof caddy["running"] === "boolean");
}

// Status must keep working when this file is damaged: it only holds the last check results.
async function readRuntimeStatus(dataPath: string): Promise<ReachabilityRuntimeStatus | null> {
    try {
        const parsed = await readJsonIfExists(reachabilityRuntimeStatusPath(dataPath));
        return isRuntimeStatus(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

// The directory name Caddy stores a CA's certificates under.
export function acmeIssuerKey(acmeDirectory: string): string {
    const url = new URL(acmeDirectory);
    return `${url.host}${url.pathname}`.replace(/[:/]/g, "-");
}

// Certificate SANs and operator input spell the same IPv6 address differently, so compare as addresses.
export function isSameCertificateName(a: string, b: string): boolean {
    if (net.isIPv6(a) && net.isIPv6(b)) {
        const blockList = new net.BlockList();
        blockList.addAddress(a, "ipv6");
        return blockList.check(b, "ipv6");
    }
    return a.toLowerCase() === b.toLowerCase();
}

// What the node serves now. Caddy keeps certificates for old addresses and other CAs until they expire,
// and treating those as current would misreport expiry, or let a staging certificate pass for a real one.
export function currentCertificates(certificates: CertificateInfo[], acmeDirectory: string, names: string[]): CertificateInfo[] {
    const issuer = acmeIssuerKey(acmeDirectory);
    return certificates.filter(
        (certificate) => certificate.issuer === issuer && certificate.names.some((held) => names.some((name) => isSameCertificateName(held, name)))
    );
}

function certificateNames(certificate: X509Certificate): string[] {
    return (certificate.subjectAltName ?? "")
        .split(", ")
        .filter(Boolean)
        .map((entry) => entry.replace(/^(DNS|IP Address):/, ""));
}

// Caddy stores certificates at <data>/certificates/<ca>/<name>/<name>.crt.
export async function readIssuedCertificates(dataPath: string, now: Date = new Date()): Promise<CertificateInfo[]> {
    const certificatesRoot = path.join(caddyDataDir(dataPath), "certificates");
    let entries: { name: string; parentPath: string; isFile(): boolean }[];
    try {
        entries = await fs.readdir(certificatesRoot, { recursive: true, withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    const certificates: CertificateInfo[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".crt")) continue;
        const filePath = path.join(entry.parentPath, entry.name);
        try {
            const certificate = new X509Certificate(await fs.readFile(filePath));
            const notAfter = new Date(certificate.validTo);
            certificates.push({
                issuer: path.relative(certificatesRoot, filePath).split(path.sep)[0]!,
                names: certificateNames(certificate),
                notAfter: notAfter.toISOString(),
                hoursLeft: Math.floor((notAfter.getTime() - now.getTime()) / 3_600_000)
            });
        } catch {
            continue; // Caddy may be mid-write; the next status call will see it
        }
    }
    return certificates.sort((a, b) => a.notAfter.localeCompare(b.notAfter));
}

export async function readReachabilityStatus(dataPath: string, now: Date = new Date()): Promise<ReachabilityStatus> {
    const config = await readReachabilityConfig(dataPath);
    const [allCertificates, lastChecks] = await Promise.all([readIssuedCertificates(dataPath, now), readRuntimeStatus(dataPath)]);
    const names = config ? [...config.publicIps, ...(config.domain ? [config.domain] : [])] : [];
    const certificates = config ? currentCertificates(allCertificates, config.acmeDirectory, names) : [];
    return {
        configured: config !== undefined,
        enabled: config?.enabled ?? false,
        mode: config?.mode ?? null,
        addresses: config?.enabled ? config.announce : [],
        wsPort: config?.wsPort ?? null,
        domain: config?.domain ?? null,
        staging: config?.staging ?? false,
        certificates,
        lastChecks
    };
}
