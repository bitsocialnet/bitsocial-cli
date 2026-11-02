import { X509Certificate } from "crypto";
import fs from "fs/promises";
import path from "path";
import type { KuboEditRecord } from "./kubo-config.js";

export const REACHABILITY_CONFIG_VERSION = 1;

export type ReachabilityMode = "webtransport-only" | "ip" | "domain" | "ip+domain" | "reverse-proxy" | "ip+reverse-proxy";

const REACHABILITY_MODES: readonly ReachabilityMode[] = ["webtransport-only", "ip", "domain", "ip+domain", "reverse-proxy", "ip+reverse-proxy"];

// Written by setup, enable and disable, and by the daemon when an IP change alters the addresses.
export interface ReachabilityConfig {
    version: typeof REACHABILITY_CONFIG_VERSION;
    enabled: boolean;
    mode: ReachabilityMode;
    wsPort: number;
    announce: string[];
    publicIps: string[];
    domain?: string;
    staging: boolean;
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
    if (!isStringArray(parsed.announce)) fail("announce must be a list of multiaddrs");
    if (!isStringArray(parsed.publicIps)) fail("publicIps must be a list of IP addresses");
    if (parsed.domain !== undefined && typeof parsed.domain !== "string") fail("domain must be a string");
    if (typeof parsed.staging !== "boolean") fail("staging must be a boolean");
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
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 4) + "\n");
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

// Status must keep working when this file is damaged: it only holds the last check results.
async function readRuntimeStatus(dataPath: string): Promise<ReachabilityRuntimeStatus | null> {
    try {
        return ((await readJsonIfExists(reachabilityRuntimeStatusPath(dataPath))) as ReachabilityRuntimeStatus | undefined) ?? null;
    } catch {
        return null;
    }
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
    const [certificates, lastChecks] = await Promise.all([readIssuedCertificates(dataPath, now), readRuntimeStatus(dataPath)]);
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
