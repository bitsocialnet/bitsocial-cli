import type { ChildProcess } from "child_process";
import fs from "fs/promises";
import net from "net";
import path from "path";
import {
    caddyfilePath,
    ensureCaddyBinary,
    generateCaddyfile,
    LETS_ENCRYPT_DIRECTORY,
    LETS_ENCRYPT_STAGING_DIRECTORY,
    reloadCaddy,
    startCaddy,
    stopCaddy,
    waitForCertificates,
    type CaddyfileSpec
} from "./caddy.js";
import {
    findPortHolder,
    isCgnatIp,
    isTcpPortFree,
    kuboIdentity,
    kuboListenAddresses,
    lanIpv4FromInterfaces,
    probeTcpPort,
    publicIpsFromInterfaces,
    publicIpsFromMultiaddrs,
    shutdownKubo,
    type PortHolder,
    type PortState
} from "./discovery.js";
import {
    ACME_NOTICE,
    bindDeniedGuidance,
    busyPortMessage,
    IPV6_ONLY_CAVEAT,
    NO_IPV6_HINT,
    setcapCommand,
    testCommandHint,
    unreachableStatement,
    webTransportNotListeningGuidance,
    windowsFirewallGuidance
} from "./guidance.js";
import { localWsSwarmAddress, planKuboConfig } from "./kubo-config.js";
import { discoverNatRouter, type NatRouter } from "./nat.js";
import { caddyDataDir, readReachabilityConfig, reachabilityDir, writeJsonAtomic, writeReachabilityConfig, type ReachabilityConfig, type ReachabilityMode } from "./state.js";

export class NeedsAnswerError extends Error {}

export interface SetupOptions {
    dataPath: string;
    kuboRepoPath: string;
    kuboRpcUrl: URL;
    staging: boolean;
    nonInteractive: boolean;
    // Set only by tests, through the BITSOCIAL_TEST_REACHABILITY_* environment variables.
    overrides?: { acmeDirectory?: string; acmeTrustedRootsPath?: string; publicIps?: string[]; httpsPort?: number; httpPort?: number };
}

export interface SetupDependencies {
    log: (message: string) => void;
    warn: (message: string) => void;
    // undefined when nobody can answer, i.e. stdin is not a TTY or --non-interactive was passed.
    confirm?: (question: string) => Promise<boolean>;
    runSudoSetcap?: (binaryPath: string) => Promise<boolean>;
    platform: string;
    inContainer: boolean;
    isCi: boolean;
    kuboBinaryPath: string;
    discoverRouter: () => Promise<NatRouter | undefined>;
    probePort: (port: number) => Promise<PortState>;
    findHolder: (port: number) => Promise<PortHolder | undefined>;
    publicIpsFromInterfaces: () => string[];
    lanIpv4: () => string | undefined;
    ensureCaddy: (dataPath: string) => Promise<string>;
    certificateTimeoutMs?: number;
}

export const realSetupDependencies = (): Pick<SetupDependencies, "discoverRouter" | "probePort" | "findHolder" | "publicIpsFromInterfaces" | "lanIpv4" | "ensureCaddy"> => ({
    discoverRouter: () => discoverNatRouter(),
    probePort: (port) => probeTcpPort(port),
    findHolder: (port) => findPortHolder(port),
    publicIpsFromInterfaces: () => publicIpsFromInterfaces(),
    lanIpv4: () => lanIpv4FromInterfaces(),
    ensureCaddy: (dataPath) => ensureCaddyBinary(dataPath)
});

// CI must never spend real Let's Encrypt rate limit, whatever a workflow or test passes in.
export function assertAcmeDirectoryAllowed(directory: string, isCi: boolean) {
    if (isCi && directory === LETS_ENCRYPT_DIRECTORY) throw new Error("Refusing to use production Let's Encrypt from CI. Use Pebble or --staging.");
}

export function chooseAcmeDirectory(options: Pick<SetupOptions, "staging" | "overrides">): string {
    return options.overrides?.acmeDirectory ?? (options.staging ? LETS_ENCRYPT_STAGING_DIRECTORY : LETS_ENCRYPT_DIRECTORY);
}

const announceForIp = (ip: string, httpsPort: number) => `/${net.isIPv6(ip) ? "ip6" : "ip4"}/${ip}/tcp/${httpsPort}/tls/ws`;

export function deriveMode(parts: { ip: boolean; domain: boolean; proxy: boolean }): ReachabilityMode {
    if (parts.ip && parts.domain) return "ip+domain";
    if (parts.ip && parts.proxy) return "ip+reverse-proxy";
    if (parts.ip) return "ip";
    if (parts.domain) return "domain";
    if (parts.proxy) return "reverse-proxy";
    return "webtransport-only";
}

const freePort = (host = "127.0.0.1"): Promise<number> =>
    new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, host, () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });

async function chooseWsPort(previous: ReachabilityConfig | undefined): Promise<number> {
    if (previous) return previous.wsPort; // kubo itself may hold it, so a busy check would be wrong
    return (await isTcpPortFree(4002, "127.0.0.1")) ? 4002 : freePort();
}

const adminUp = async (adminPort: number) => {
    try {
        await fetch(`http://127.0.0.1:${adminPort}/config/`, { headers: { Origin: `http://127.0.0.1:${adminPort}` }, signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
};

export async function discoverPublicIps(
    options: SetupOptions,
    deps: SetupDependencies
): Promise<{ publicIps: string[]; router?: NatRouter; refused: string[]; sawCgnat: boolean }> {
    if (options.overrides?.publicIps) return { publicIps: options.overrides.publicIps, refused: [], sawCgnat: false };
    const fromInterfaces = deps.publicIpsFromInterfaces();
    const identity = await kuboIdentity(options.kuboRpcUrl);
    const fromKubo = identity ? publicIpsFromMultiaddrs(identity.addresses) : [];
    const ips = new Set([...fromInterfaces, ...fromKubo]);
    let sawCgnat = false;
    let router: NatRouter | undefined;
    const refused: string[] = [];

    if (!fromInterfaces.some((ip) => net.isIPv4(ip))) {
        router = await deps.discoverRouter();
        const lanIp = deps.lanIpv4();
        if (router && lanIp) {
            const result = await router.mapPorts(lanIp);
            refused.push(...result.refused);
            if (result.mapped.length > 0) deps.log(`Router forwarded ${result.mapped.join(", ")} to this machine.`);
            if (result.refused.length > 0) deps.warn(`Router refused to forward ${result.refused.join(", ")}.`);
            const external = await router.externalIp().catch(() => undefined);
            if (external) {
                if (isCgnatIp(external)) sawCgnat = true;
                else if (publicIpsFromMultiaddrs([`/ip4/${external}`]).length > 0) ips.add(external);
            }
        }
    }
    return { publicIps: [...ips], ...(router ? { router } : {}), refused, sawCgnat };
}

// Starts Caddy (or reloads the one the daemon already runs) until the names are issued.
async function issueCertificates(
    spec: CaddyfileSpec,
    names: string[],
    options: SetupOptions,
    deps: SetupDependencies
): Promise<{ issued: string[]; failure?: string }> {
    const binaryPath = await deps.ensureCaddy(options.dataPath);
    const caddyfile = generateCaddyfile(spec);
    await fs.mkdir(reachabilityDir(options.dataPath), { recursive: true });
    await fs.writeFile(caddyfilePath(options.dataPath), caddyfile);

    const timeoutMs = deps.certificateTimeoutMs ?? 90_000;
    if (await adminUp(spec.adminPort)) {
        await reloadCaddy(spec.adminPort, caddyfile);
        const { issued } = await waitForCertificates(options.dataPath, spec.acmeDirectory, names, timeoutMs);
        return { issued };
    }

    for (let attempt = 1; ; attempt++) {
        let output = "";
        const caddy = startCaddy(options.dataPath, binaryPath, (line) => (output += line));
        const exited = new Promise<void>((resolve) => (caddy as ChildProcess).once("exit", () => resolve()));
        let exitedEarly = false;
        void exited.then(() => (exitedEarly = true));
        const wait = await Promise.race([
            waitForCertificates(options.dataPath, spec.acmeDirectory, names, timeoutMs),
            exited.then(() => undefined)
        ]);
        if (!exitedEarly) {
            await stopCaddy(spec.adminPort).catch(() => caddy.kill());
            await exited;
        }
        if (wait) return { issued: wait.issued };

        const denied = /permission denied/i.test(output) && /bind|listen/i.test(output);
        if (!denied || attempt > 1) return { issued: [], failure: output.trim().split("\n").at(-1) ?? "Caddy exited" };
        const guidance = bindDeniedGuidance({ inContainer: deps.inContainer, caddyPath: binaryPath, platform: deps.platform });
        if (deps.inContainer || !deps.confirm || !deps.runSudoSetcap || deps.platform !== "linux") throw new NeedsAnswerError(guidance);
        if (!(await deps.confirm(`Caddy needs permission to bind port 443. Run: ${setcapCommand(binaryPath)} ?`))) throw new NeedsAnswerError(guidance);
        if (!(await deps.runSudoSetcap(binaryPath))) throw new NeedsAnswerError(guidance);
    }
}

async function applyKuboConfig(
    config: ReachabilityConfig,
    options: Pick<SetupOptions, "kuboRepoPath" | "dataPath">,
    enabled: boolean
): Promise<{ config: ReachabilityConfig; kuboConfigChanged: boolean }> {
    const configPath = path.join(options.kuboRepoPath, "config");
    const current = JSON.parse(await fs.readFile(configPath, "utf-8"));
    const { kuboConfig, kuboEdits } = planKuboConfig(current, config, enabled);
    const kuboConfigChanged = JSON.stringify(kuboConfig) !== JSON.stringify(current);
    if (kuboConfigChanged) await writeJsonAtomic(configPath, kuboConfig);
    const next: ReachabilityConfig = { ...config, enabled };
    if (kuboEdits) next.kuboEdits = kuboEdits;
    else delete next.kuboEdits;
    await writeReachabilityConfig(options.dataPath, next);
    return { config: next, kuboConfigChanged };
}

// The daemon restarts kubo within seconds. Without a daemon there is nothing to restart or to check yet.
async function restartAndVerifyKubo(config: ReachabilityConfig, restart: boolean, options: SetupOptions, deps: SetupDependencies) {
    if (!(await kuboIdentity(options.kuboRpcUrl))) {
        deps.log("The daemon is not running. Start it with: bitsocial daemon");
        return;
    }
    if (restart) await shutdownKubo(options.kuboRpcUrl);
    const deadline = Date.now() + (deps.certificateTimeoutMs ?? 60_000);
    // Waits for the new kubo: the old one can answer for a moment after the shutdown request.
    let listen: string[] | undefined;
    while (Date.now() < deadline) {
        listen = await kuboListenAddresses(options.kuboRpcUrl);
        if (listen?.some((address) => address.includes(localWsSwarmAddress(config.wsPort)))) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!listen?.some((address) => address.includes(localWsSwarmAddress(config.wsPort)))) {
        deps.warn(`kubo has not come back listening on ${localWsSwarmAddress(config.wsPort)}. Check the daemon, then run: bitsocial reachability status`);
        return;
    }
    if (!listen.some((address) => address.includes("/udp/443/quic-v1/webtransport")))
        deps.warn(webTransportNotListeningGuidance({ inContainer: deps.inContainer, kuboPath: deps.kuboBinaryPath, platform: deps.platform }));
}

export async function runReachabilitySetup(options: SetupOptions, deps: SetupDependencies): Promise<ReachabilityConfig> {
    const acmeDirectory = chooseAcmeDirectory(options);
    assertAcmeDirectoryAllowed(acmeDirectory, deps.isCi);

    const previous = await readReachabilityConfig(options.dataPath);
    const httpsPort = options.overrides?.httpsPort ?? 443;
    const wsPort = await chooseWsPort(previous);
    const caddyAdminPort = previous?.caddyAdminPort ?? (await freePort());

    const { publicIps, refused, sawCgnat } = await discoverPublicIps(options, deps);
    if (publicIps.length > 0) deps.log(`Public addresses: ${publicIps.join(", ")}`);

    const ourCaddyRunning = await adminUp(caddyAdminPort);
    const portState = ourCaddyRunning ? "free" : await deps.probePort(httpsPort);
    let issuedIps: string[] = [];
    let unreachableReason: string | undefined;

    if (publicIps.length === 0) {
        unreachableReason = sawCgnat ? "this network is behind carrier-grade NAT and has no global IPv6" : "no public IPv4 or global IPv6 address was found";
    } else if (portState === "busy") {
        deps.warn(busyPortMessage(await deps.findHolder(httpsPort)));
        unreachableReason = "TCP 443 is in use by another program";
    } else {
        deps.log(ACME_NOTICE);
        const spec: CaddyfileSpec = {
            ips: publicIps,
            domains: [],
            wsPort,
            adminPort: caddyAdminPort,
            dataDirectory: caddyDataDir(options.dataPath),
            acmeDirectory,
            ...(options.overrides?.httpsPort ? { httpsPort: options.overrides.httpsPort } : {}),
            ...(options.overrides?.httpPort ? { httpPort: options.overrides.httpPort } : {}),
            ...(options.overrides?.acmeTrustedRootsPath ? { acmeTrustedRootsPath: options.overrides.acmeTrustedRootsPath } : {})
        };
        const { issued, failure } = await issueCertificates(spec, publicIps, options, deps);
        issuedIps = issued;
        if (issuedIps.length === 0) unreachableReason = failure ?? "Let's Encrypt could not reach this machine on TCP 80 or 443";
        // Keep only what worked, so the daemon's Caddy does not retry a name forever.
        await fs.writeFile(caddyfilePath(options.dataPath), generateCaddyfile({ ...spec, ips: issuedIps }));
    }

    if (issuedIps.length > 0 && issuedIps.every((ip) => net.isIPv6(ip))) deps.warn(IPV6_ONLY_CAVEAT);
    if (!publicIps.some((ip) => net.isIPv6(ip)) && issuedIps.length > 0) deps.log(NO_IPV6_HINT);
    if (issuedIps.length === 0 && unreachableReason) {
        const portHint = refused.length > 0 ? `${unreachableReason}; the router refused ${refused.join(", ")}` : unreachableReason;
        deps.warn(unreachableStatement(portHint));
    }
    if (deps.platform === "win32" && issuedIps.length > 0) deps.log(windowsFirewallGuidance());

    const announce = issuedIps.map((ip) => announceForIp(ip, httpsPort));
    const { config, kuboConfigChanged } = await applyKuboConfig(
        {
            version: 1,
            enabled: true,
            mode: deriveMode({ ip: issuedIps.length > 0, domain: false, proxy: false }),
            wsPort,
            announce,
            publicIps: issuedIps,
            staging: options.staging,
            acmeDirectory,
            caddyAdminPort,
            ...(options.overrides?.httpsPort ? { httpsPort: options.overrides.httpsPort } : {}),
            ...(options.overrides?.httpPort ? { httpPort: options.overrides.httpPort } : {}),
            ...(options.overrides?.acmeTrustedRootsPath ? { acmeTrustedRootsPath: options.overrides.acmeTrustedRootsPath } : {}),
            ...(previous?.kuboEdits ? { kuboEdits: previous.kuboEdits } : {})
        },
        options,
        true
    );
    await restartAndVerifyKubo(config, kuboConfigChanged, options, deps);

    if (announce.length > 0) {
        deps.log("Announced browser addresses:");
        for (const address of announce) deps.log(`  ${address}`);
        deps.log(testCommandHint(issuedIps[0]!, httpsPort));
    } else {
        deps.log("WebTransport on UDP 443 is configured. No WSS address is announced.");
    }
    return config;
}
