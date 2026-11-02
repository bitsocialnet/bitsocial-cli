import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import net from "net";
import path from "path";
import decompress from "decompress";
import { caddyDataDir, currentCertificates, readIssuedCertificates, reachabilityDir } from "./state.js";

// To bump Caddy, change the version and all six hashes in one commit. They are pinned here rather than
// read from the checksums file next to the download, because that file shares the download's origin.
export const CADDY_VERSION = "2.11.7";
export const CADDY_RELEASE_SHA256: Record<string, string> = {
    "linux-x64": "727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b",
    "linux-arm64": "d8fc6d179a5d283028a472a5618564f6ad8a86fed513e64f032b3b0b7cc45e42",
    "darwin-x64": "110c53e5c093e4cfce6eda787f94f23bef913c309f620fab26b4f678031841ad",
    "darwin-arm64": "cda3030e5d5b13eb9f0b6fb541037f633bddd958c070c5f561d7a5cccb581665",
    "win32-x64": "0a1edc0b799512051c57071ce0e798d3f2cf67dc98171366f1d2b326072e3b06",
    "win32-arm64": "34804a5e61106fa6718682f5be6c9edc4cceec9601ba7e25beec1e176cfc3b47"
};

export const LETS_ENCRYPT_DIRECTORY = "https://acme-v02.api.letsencrypt.org/directory";
export const LETS_ENCRYPT_STAGING_DIRECTORY = "https://acme-staging-v02.api.letsencrypt.org/directory";

const RELEASE_OS: Record<string, string> = { linux: "linux", darwin: "mac", win32: "windows" };
const RELEASE_ARCH: Record<string, string> = { x64: "amd64", arm64: "arm64" };

export function caddyReleaseFor(platform: string, arch: string): { url: string; sha256: string; binaryName: string } {
    const sha256 = CADDY_RELEASE_SHA256[`${platform}-${arch}`];
    if (!sha256) throw new Error(`Caddy has no pinned release for ${platform}-${arch}. Supported: ${Object.keys(CADDY_RELEASE_SHA256).join(", ")}`);
    const extension = platform === "win32" ? "zip" : "tar.gz";
    const file = `caddy_${CADDY_VERSION}_${RELEASE_OS[platform]}_${RELEASE_ARCH[arch]}.${extension}`;
    return {
        url: `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/${file}`,
        sha256,
        binaryName: platform === "win32" ? "caddy.exe" : "caddy"
    };
}

export const caddyBinaryPath = (dataPath: string, platform: string = process.platform) =>
    path.join(reachabilityDir(dataPath), "bin", `caddy-${CADDY_VERSION}${platform === "win32" ? ".exe" : ""}`);

export const caddyfilePath = (dataPath: string) => path.join(reachabilityDir(dataPath), "Caddyfile");

async function downloadWithRetry(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetchImpl(url, { signal: AbortSignal.timeout(300_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            lastError = error;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
    }
    throw new Error(`Failed to download Caddy from ${url}: ${(lastError as Error).message}`);
}

// Downloads on first use, not at install time. The archive is hash-checked before anything is unpacked,
// and the binary only appears at its final path once complete, so a crash cannot leave a partial one.
export async function ensureCaddyBinary(
    dataPath: string,
    { fetchImpl = fetch, log = () => {} }: { fetchImpl?: typeof fetch; log?: (message: string) => void } = {}
): Promise<string> {
    const finalPath = caddyBinaryPath(dataPath);
    try {
        await fs.access(finalPath);
        return finalPath;
    } catch {
        /* not downloaded yet */
    }
    const release = caddyReleaseFor(process.platform, process.arch);
    log(`Downloading Caddy ${CADDY_VERSION} from ${release.url}`);
    const archive = await downloadWithRetry(release.url, fetchImpl);
    const actualHash = createHash("sha256").update(archive).digest("hex");
    if (actualHash !== release.sha256)
        throw new Error(`Caddy download failed verification, refusing to run it.\n  URL: ${release.url}\n  Expected sha256: ${release.sha256}\n  Actual sha256: ${actualHash}`);

    const binDirectory = path.dirname(finalPath);
    await fs.mkdir(binDirectory, { recursive: true });
    const unpackDirectory = await fs.mkdtemp(path.join(binDirectory, "unpack-"));
    try {
        const files = await decompress(archive, unpackDirectory, { filter: (file) => file.path === release.binaryName });
        if (files.length !== 1) throw new Error(`Caddy archive did not contain ${release.binaryName}`);
        const unpackedPath = path.join(unpackDirectory, release.binaryName);
        await fs.chmod(unpackedPath, 0o755);
        await fs.rename(unpackedPath, finalPath);
    } finally {
        await fs.rm(unpackDirectory, { recursive: true, force: true });
    }
    return finalPath;
}

export interface CaddyfileSpec {
    ips: string[];
    domains: string[];
    wsPort: number;
    adminPort: number;
    dataDirectory: string;
    acmeDirectory: string;
    httpsPort?: number;
    httpPort?: number;
    acmeTrustedRootsPath?: string;
}

// Hostnames reach the Caddyfile from --domain, so anything but a plain name must not get through:
// a space, brace or newline would let the value add directives of its own.
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

const assertPort = (label: string, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} is not a valid port: ${port}`);
};

// Forward slashes work on every OS Caddy runs on, and backslashes would need Caddyfile escaping.
const quotedPath = (value: string) => {
    if (/["\r\n]/.test(value)) throw new Error(`Path cannot be used in a Caddyfile: ${value}`);
    return `"${value.replaceAll("\\", "/")}"`;
};

export function generateCaddyfile(spec: CaddyfileSpec): string {
    assertPort("wsPort", spec.wsPort);
    assertPort("adminPort", spec.adminPort);
    for (const ip of spec.ips) if (net.isIP(ip) === 0) throw new Error(`Not an IP address: ${ip}`);
    for (const domain of spec.domains) if (!HOSTNAME_PATTERN.test(domain)) throw new Error(`Not a valid domain name: ${domain}`);
    if (spec.httpsPort !== undefined) assertPort("httpsPort", spec.httpsPort);
    if (spec.httpPort !== undefined) assertPort("httpPort", spec.httpPort);

    const portSuffix = spec.httpsPort && spec.httpsPort !== 443 ? `:${spec.httpsPort}` : "";
    const siteAddress = (host: string) => `https://${host}${portSuffix}`;
    const ipSite = (ip: string) => siteAddress(net.isIPv6(ip) ? `[${ip}]` : ip);
    const defaultSni = spec.ips.find((ip) => net.isIPv4(ip)) ?? spec.ips[0];

    const issuer = (profile?: string) =>
        [
            "\ttls {",
            "\t\tissuer acme {",
            `\t\t\tdir ${spec.acmeDirectory}`,
            ...(spec.acmeTrustedRootsPath ? [`\t\t\ttrusted_roots ${quotedPath(spec.acmeTrustedRootsPath)}`] : []),
            ...(profile ? [`\t\t\tprofile ${profile}`] : []),
            "\t\t}",
            "\t}"
        ].join("\n");
    const site = (addresses: string[], profile?: string) =>
        `${addresses.join(", ")} {\n${issuer(profile)}\n\treverse_proxy 127.0.0.1:${spec.wsPort}\n}`;

    const globalOptions = [
        `admin 127.0.0.1:${spec.adminPort}`,
        "persist_config off",
        `storage file_system ${quotedPath(spec.dataDirectory)}`,
        // Without this Caddy binds port 80 for redirects and fails to start when anything holds it.
        "auto_https disable_redirects",
        "skip_install_trust",
        // Browsers send no SNI when dialling an IP. Behind NAT the local address is not the public IP
        // either, so Caddy could not otherwise pick the certificate.
        ...(defaultSni ? [`default_sni ${defaultSni}`] : []),
        ...(spec.httpPort ? [`http_port ${spec.httpPort}`] : []),
        ...(spec.httpsPort ? [`https_port ${spec.httpsPort}`] : []),
        // HTTP/3 would bind UDP on the HTTPS port, which is kubo's WebTransport listener on UDP 443.
        "servers {\n\t\tprotocols h1 h2\n\t}"
    ];

    return [
        `{\n${globalOptions.map((line) => `\t${line}`).join("\n")}\n}`,
        ...(spec.ips.length > 0 ? [site(spec.ips.map(ipSite), "shortlived")] : []),
        ...spec.domains.map((domain) => site([siteAddress(domain)]))
    ].join("\n\n") + "\n";
}

export function startCaddy(dataPath: string, binaryPath: string, onOutput?: (line: string) => void): ChildProcessWithoutNullStreams {
    const child = spawn(binaryPath, ["run", "--config", caddyfilePath(dataPath), "--adapter", "caddyfile"], {
        env: {
            ...process.env,
            XDG_CONFIG_HOME: path.join(reachabilityDir(dataPath), "caddy-config"),
            XDG_DATA_HOME: caddyDataDir(dataPath)
        },
        windowsHide: true
    });
    child.stdout.on("data", (data: Buffer) => onOutput?.(data.toString()));
    child.stderr.on("data", (data: Buffer) => onOutput?.(data.toString()));
    return child;
}

const adminRequest = async (adminPort: number, route: string, init: RequestInit) => {
    const origin = `http://127.0.0.1:${adminPort}`;
    // fetch sends Sec-Fetch-Mode: cors, and Caddy then refuses any request without an allowed Origin.
    const headers = { Origin: origin, ...init.headers };
    const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(10_000), ...init, headers });
    if (!response.ok) throw new Error(`Caddy admin ${route} returned HTTP ${response.status}: ${await response.text()}`);
};

// Through the admin API rather than signals, so the same code stops Caddy on every OS.
export const stopCaddy = (adminPort: number) => adminRequest(adminPort, "/stop", { method: "POST" });

export const reloadCaddy = (adminPort: number, caddyfile: string) =>
    adminRequest(adminPort, "/load", { method: "POST", headers: { "Content-Type": "text/caddyfile" }, body: caddyfile });

// Issuance succeeding is the proof that the internet reached us, so this is the real result of setup.
// Only certificates from this CA count: a leftover --staging one must not pass for a production result.
export async function waitForCertificates(
    dataPath: string,
    acmeDirectory: string,
    names: string[],
    timeoutMs = 90_000
): Promise<{ issued: string[]; missing: string[] }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const unexpired = (await readIssuedCertificates(dataPath)).filter((certificate) => certificate.hoursLeft > 0);
        const issued = names.filter((name) => currentCertificates(unexpired, acmeDirectory, [name]).length > 0);
        if (issued.length === names.length || Date.now() >= deadline) return { issued, missing: names.filter((name) => !issued.includes(name)) };
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}
