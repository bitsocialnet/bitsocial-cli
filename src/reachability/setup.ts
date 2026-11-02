import type { ChildProcess } from "child_process";
import dns from "dns/promises";
import fs from "fs/promises";
import net from "net";
import path from "path";
import {
    caddyfilePath,
    ensureCaddyBinary,
    generateCaddyfile,
    isValidDomain,
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
    dnsMismatchMessage,
    IPV6_ONLY_CAVEAT,
    NO_IPV6_HINT,
    reverseProxySnippet,
    setcapCommand,
    testCommandHint,
    unreachableStatement,
    webTransportNotListeningGuidance,
    windowsFirewallGuidance
} from "./guidance.js";
import { localWsSwarmAddress, planKuboConfig } from "./kubo-config.js";
import { discoverNatRouter, type NatRouter } from "./nat.js";
import { dialWithLibp2p } from "./libp2p-dial.js";
import { caddyDataDir, isSameCertificateName, readReachabilityConfig, reachabilityDir, writeJsonAtomic, writeReachabilityConfig, type ReachabilityConfig, type ReachabilityMode } from "./state.js";

export class NeedsAnswerError extends Error {}
export class SetupRefusedError extends Error {}

export interface ResolvedDomain {
    v4: string[];
    v6: string[];
}

export interface SetupOptions {
    dataPath: string;
    kuboRepoPath: string;
    kuboRpcUrl: URL;
    staging: boolean;
    nonInteractive: boolean;
    domain?: string;
    announce?: string;
    force?: boolean;
    // Set only by tests, through the BITSOCIAL_TEST_REACHABILITY_* environment variables.
    overrides?: { acmeDirectory?: string; acmeTrustedRootsPath?: string; publicIps?: string[]; httpsPort?: number; httpPort?: number };
}

export interface SetupDependencies {
    log: (message: string) => void;
    warn: (message: string) => void;
    // undefined when nobody can answer, i.e. stdin is not a TTY or --non-interactive was passed.
    confirm?: (question: string) => Promise<boolean>;
    ask?: (question: string) => Promise<string>;
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
    resolveDomain: (domain: string) => Promise<ResolvedDomain>;
    dial: (address: string) => Promise<{ peerId: string }>;
    certificateTimeoutMs?: number;
}

export const realSetupDependencies = (): Pick<SetupDependencies, "discoverRouter" | "probePort" | "findHolder" | "publicIpsFromInterfaces" | "lanIpv4" | "ensureCaddy" | "resolveDomain" | "dial"> => ({
    discoverRouter: () => discoverNatRouter(),
    probePort: (port) => probeTcpPort(port),
    findHolder: (port) => findPortHolder(port),
    publicIpsFromInterfaces: () => publicIpsFromInterfaces(),
    lanIpv4: () => lanIpv4FromInterfaces(),
    ensureCaddy: (dataPath) => ensureCaddyBinary(dataPath),
    resolveDomain: resolveDomainRecords,
    dial: (address) => dialWithLibp2p(address)
});

// Asks DNS itself rather than the OS resolver, so a hosts-file entry cannot make a stale record look right.
export async function resolveDomainRecords(domain: string): Promise<ResolvedDomain> {
    const [v4, v6] = await Promise.all([dns.resolve4(domain).catch(() => [] as string[]), dns.resolve6(domain).catch(() => [] as string[])]);
    return { v4, v6 };
}

export function domainAnnounceAddress(domain: string, port: number, records: ResolvedDomain): string {
    const protocol = records.v4.length === 0 && records.v6.length > 0 ? "dns6" : "dns4";
    return `/${protocol}/${domain}/tcp/${port}/tls/ws`;
}

export function domainPointsHere(records: ResolvedDomain, publicIps: string[]): boolean {
    return [...records.v4, ...records.v6].some((resolved) => publicIps.some((ip) => isSameCertificateName(resolved, ip)));
}

// Only a browser-dialable shape is worth announcing, and the dial below needs to add our own /p2p part.
export function assertAnnounceShape(address: string) {
    if (!/\/(tls\/ws|wss)$/.test(address)) throw new SetupRefusedError(`--announce must end in /tls/ws or /wss so browsers can dial it: ${address}`);
}

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
    if (options.announce) assertAnnounceShape(options.announce);

    const previous = await readReachabilityConfig(options.dataPath);
    const httpsPort = options.overrides?.httpsPort ?? 443;
    const wsPort = await chooseWsPort(previous);
    const caddyAdminPort = previous?.caddyAdminPort ?? (await freePort());
    let domain = options.domain ?? previous?.domain;
    if (domain && !isValidDomain(domain)) throw new SetupRefusedError(`Not a valid domain name: ${domain}`);

    const { publicIps, refused, sawCgnat } = await discoverPublicIps(options, deps);
    if (publicIps.length > 0) deps.log(`Public addresses: ${publicIps.join(", ")}`);

    const ourCaddyRunning = await adminUp(caddyAdminPort);
    const portState = ourCaddyRunning ? "free" : await deps.probePort(httpsPort);
    const portBusy = portState === "busy";
    const holder = portBusy ? await deps.findHolder(httpsPort) : undefined;
    if (portBusy) deps.warn(busyPortMessage(holder));

    // Path B is what is left when the IP certificate cannot work, so that is when it is worth asking.
    if (!domain && !options.announce && deps.ask && (portBusy || publicIps.length === 0)) {
        const answer = (await deps.ask("Domain name pointing at this machine (Enter to skip):")).trim();
        if (answer) {
            if (!isValidDomain(answer)) throw new SetupRefusedError(`Not a valid domain name: ${answer}`);
            domain = answer;
        }
    }

    let records: ResolvedDomain = { v4: [], v6: [] };
    let domainUsable = domain !== undefined;
    if (domain) {
        records = await deps.resolveDomain(domain);
        if (!domainPointsHere(records, publicIps)) {
            const message = dnsMismatchMessage(domain, [...records.v4, ...records.v6], publicIps);
            // Refuse what the operator asked for now. A stored name going stale must not block repairing
            // the rest, so it only sits out this run, and is still stored for when its DNS is fixed.
            if (options.domain && !options.force) throw new SetupRefusedError(message);
            deps.warn(message);
            if (options.force) deps.warn("Continuing because of --force.");
            else domainUsable = false;
        }
    }

    const certificateNames = portBusy ? [] : [...publicIps, ...(domain && domainUsable ? [domain] : [])];
    let issued: string[] = [];
    let failure: string | undefined;
    const spec: CaddyfileSpec = {
        ips: publicIps,
        domains: domain && domainUsable ? [domain] : [],
        wsPort,
        adminPort: caddyAdminPort,
        dataDirectory: caddyDataDir(options.dataPath),
        acmeDirectory,
        ...(options.overrides?.httpsPort ? { httpsPort: options.overrides.httpsPort } : {}),
        ...(options.overrides?.httpPort ? { httpPort: options.overrides.httpPort } : {}),
        ...(options.overrides?.acmeTrustedRootsPath ? { acmeTrustedRootsPath: options.overrides.acmeTrustedRootsPath } : {})
    };
    if (certificateNames.length > 0) {
        deps.log(ACME_NOTICE);
        const result = await issueCertificates(spec, certificateNames, options, deps);
        issued = result.issued;
        failure = result.failure;
        // Keep only what worked, so the daemon's Caddy does not retry a name forever.
        await fs.writeFile(
            caddyfilePath(options.dataPath),
            generateCaddyfile({ ...spec, ips: publicIps.filter((ip) => issued.includes(ip)), domains: domain && issued.includes(domain) ? [domain] : [] })
        );
    }
    const issuedIps = publicIps.filter((ip) => issued.includes(ip));
    const domainIssued = domain !== undefined && issued.includes(domain);
    if (domain && domainUsable && !portBusy && !domainIssued) deps.warn(`No certificate was issued for ${domain}. ${failure ?? "Let's Encrypt could not reach this machine on TCP 80 or 443 through that name."}`);

    if (issuedIps.length > 0 && issuedIps.every((ip) => net.isIPv6(ip))) deps.warn(IPV6_ONLY_CAVEAT);
    if (issuedIps.length > 0 && !publicIps.some((ip) => net.isIPv6(ip))) deps.log(NO_IPV6_HINT);
    if (deps.platform === "win32" && issued.length > 0) deps.log(windowsFirewallGuidance());

    const buildConfig = (externalAnnounce: string[]): ReachabilityConfig => {
        const announce = [
            ...issuedIps.map((ip) => announceForIp(ip, httpsPort)),
            ...(domain && domainIssued ? [domainAnnounceAddress(domain, httpsPort, records)] : []),
            ...externalAnnounce
        ];
        return {
            version: 1,
            enabled: true,
            mode: deriveMode({ ip: issuedIps.length > 0, domain: domainIssued, proxy: externalAnnounce.length > 0 }),
            wsPort,
            announce,
            publicIps: issuedIps,
            ...(domain ? { domain } : {}),
            ...(externalAnnounce.length > 0 ? { externalAnnounce } : {}),
            staging: options.staging,
            acmeDirectory,
            caddyAdminPort,
            ...(options.overrides?.httpsPort ? { httpsPort: options.overrides.httpsPort } : {}),
            ...(options.overrides?.httpPort ? { httpPort: options.overrides.httpPort } : {}),
            ...(options.overrides?.acmeTrustedRootsPath ? { acmeTrustedRootsPath: options.overrides.acmeTrustedRootsPath } : {})
        };
    };

    // The listeners go first: the operator's proxy has nothing to forward to until kubo has its ws port.
    let externalAnnounce = previous?.externalAnnounce ?? [];
    let applied = await applyKuboConfig({ ...buildConfig(externalAnnounce), ...(previous?.kuboEdits ? { kuboEdits: previous.kuboEdits } : {}) }, options, true);
    await restartAndVerifyKubo(applied.config, applied.kuboConfigChanged, options, deps);

    if (options.announce) {
        const identity = await kuboIdentity(options.kuboRpcUrl);
        if (!identity) throw new SetupRefusedError("--announce is verified by dialling this node through it, so the daemon must be running.");
        try {
            await deps.dial(`${options.announce}/p2p/${identity.peerId}`);
        } catch (error) {
            throw new SetupRefusedError(`Could not complete a libp2p handshake with this node through ${options.announce}, so it was not announced: ${(error as Error).message}`);
        }
        deps.log(`Verified ${options.announce} with a libp2p handshake.`);
        externalAnnounce = [...new Set([...externalAnnounce, options.announce])];
        applied = await applyKuboConfig({ ...buildConfig(externalAnnounce), ...(applied.config.kuboEdits ? { kuboEdits: applied.config.kuboEdits } : {}) }, options, true);
        await restartAndVerifyKubo(applied.config, applied.kuboConfigChanged, options, deps);
    }
    const { config } = applied;

    if (config.announce.length > 0) {
        deps.log("Announced browser addresses:");
        for (const address of config.announce) deps.log(`  ${address}`);
        const testHost = issuedIps[0] ?? (domainIssued ? domain : undefined);
        if (testHost) deps.log(testCommandHint(testHost, httpsPort));
        return config;
    }

    deps.log("WebTransport on UDP 443 is configured. No WSS address is announced.");
    if (portBusy && domain) {
        deps.log(reverseProxySnippet(holder, domain, wsPort));
        if (!deps.confirm) throw new NeedsAnswerError(`Set up the reverse proxy above, then rerun setup with --announce. kubo is listening on 127.0.0.1:${wsPort}.`);
        return config;
    }
    const reason = portBusy
        ? "TCP 443 is in use by another program and no domain was given"
        : publicIps.length === 0
          ? sawCgnat
              ? "this network is behind carrier-grade NAT and has no global IPv6"
              : "no public IPv4 or global IPv6 address was found"
          : (failure ?? "Let's Encrypt could not reach this machine on TCP 80 or 443");
    deps.warn(unreachableStatement(refused.length > 0 ? `${reason}; the router refused ${refused.join(", ")}` : reason));
    return config;
}
