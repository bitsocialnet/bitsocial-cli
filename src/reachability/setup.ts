import type { ChildProcess } from "child_process";
import dns from "dns/promises";
import fs from "fs/promises";
import net from "net";
import path from "path";
import {
    caddyfilePath,
    ensureCaddyBinary,
    generateCaddyfile,
    isOurCaddyRunning,
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
    addressesNotAnnounced,
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
    existingServerGuidance,
    IPV6_ONLY_CAVEAT,
    isBindDenied,
    NO_IPV6_HINT,
    noWssStatement,
    reverseProxySnippet,
    setcapCommand,
    testCommandHint,
    unreachableStatement,
    webTransportNotListeningGuidance,
    windowsFirewallGuidance
} from "./guidance.js";
import { formatCheck, type ReachabilityCheck } from "./checks.js";
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
    overrides?: { acmeDirectory?: string; acmeTrustedRootsPath?: string; publicIps?: string[]; httpsPort?: number; httpPort?: number; wsPort?: number };
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
    // Requirements to report before changing anything. Absent in tests that drive setup directly.
    checkRequirements?: (input: { publicIps: string[]; httpsPort: number; httpPort?: number; caddyAdminPort: number; wsPort: number }) => Promise<ReachabilityCheck[]>;
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
    const enabled = [parts.ip && "ip", parts.domain && "domain", parts.proxy && "reverse-proxy"].filter(Boolean);
    return (enabled.join("+") || "webtransport-only") as ReachabilityMode;
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

export function existingLoopbackWsPort(kuboConfig: any): number | undefined {
    const swarm: unknown = kuboConfig?.Addresses?.Swarm;
    if (!Array.isArray(swarm)) return undefined;
    for (const address of swarm) {
        const port = typeof address === "string" ? address.match(/^\/ip4\/127\.0\.0\.1\/tcp\/(\d+)\/ws$/)?.[1] : undefined;
        if (port) return Number(port);
    }
    return undefined;
}

// kubo itself may hold a port we chose earlier or one an operator configured by hand, so a busy check on
// those would wrongly add a second listener.
async function chooseWsPort(previous: ReachabilityConfig | undefined, kuboRepoPath: string): Promise<number> {
    if (previous) return previous.wsPort;
    const kuboConfig = await fs.readFile(path.join(kuboRepoPath, "config"), "utf-8").then(JSON.parse, () => undefined);
    return existingLoopbackWsPort(kuboConfig) ?? ((await isTcpPortFree(4002, "127.0.0.1")) ? 4002 : freePort());
}

// Keeps the stored admin port unless another program has taken it since.
async function chooseAdminPort(previous: ReachabilityConfig | undefined, dataPath: string): Promise<number> {
    if (!previous) return freePort();
    const usable = (await isOurCaddyRunning(previous.caddyAdminPort, dataPath)) || (await isTcpPortFree(previous.caddyAdminPort, "127.0.0.1"));
    return usable ? previous.caddyAdminPort : freePort();
}

export async function discoverPublicIps(
    options: SetupOptions,
    deps: SetupDependencies,
    ownAnnounce: string[] = []
): Promise<{ publicIps: string[]; router?: NatRouter; refused: string[]; sawCgnat: boolean }> {
    if (options.overrides?.publicIps) return { publicIps: options.overrides.publicIps, refused: [], sawCgnat: false };
    const fromInterfaces = deps.publicIpsFromInterfaces();
    const identity = await kuboIdentity(options.kuboRpcUrl);
    const fromKubo = identity ? publicIpsFromMultiaddrs(identity.addresses, ownAnnounce) : [];
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
    caChanged: boolean,
    options: SetupOptions,
    deps: SetupDependencies
): Promise<{ issued: string[]; failure?: string }> {
    const binaryPath = await deps.ensureCaddy(options.dataPath);
    const caddyfile = generateCaddyfile(spec);
    await fs.mkdir(reachabilityDir(options.dataPath), { recursive: true });
    await fs.writeFile(caddyfilePath(options.dataPath), caddyfile);

    const timeoutMs = deps.certificateTimeoutMs ?? 90_000;
    let running = await isOurCaddyRunning(spec.adminPort, options.dataPath);
    if (running && caChanged) {
        // A reload keeps serving the old CA's cached certificate and orders nothing, so moving CA needs a
        // restart. A running daemon brings Caddy back within seconds, from the Caddyfile written above.
        await stopCaddy(spec.adminPort);
        const stoppedBy = Date.now() + 5000;
        while (Date.now() < stoppedBy && (await isOurCaddyRunning(spec.adminPort, options.dataPath))) await new Promise((resolve) => setTimeout(resolve, 200));
        running = false;
        const respawnedBy = Date.now() + 7000;
        while (!running && Date.now() < respawnedBy) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            running = await isOurCaddyRunning(spec.adminPort, options.dataPath);
        }
    } else if (running) {
        await reloadCaddy(spec.adminPort, caddyfile);
    }
    if (running) {
        const { issued } = await waitForCertificates(options.dataPath, spec.acmeDirectory, names, timeoutMs);
        return { issued };
    }

    for (let attempt = 1; ; attempt++) {
        let output = "";
        const caddy = startCaddy(options.dataPath, binaryPath, (line) => (output += line));
        const exited = new Promise<void>((resolve) => (caddy as ChildProcess).once("exit", () => resolve()));
        let exitedEarly = false;
        void exited.then(() => (exitedEarly = true));
        const stopWaiting = new AbortController();
        const wait = await Promise.race([
            waitForCertificates(options.dataPath, spec.acmeDirectory, names, timeoutMs, stopWaiting.signal),
            exited.then(() => undefined)
        ]);
        stopWaiting.abort(); // its poll timer would otherwise keep the CLI alive for the full timeout
        if (!exitedEarly) {
            await stopCaddy(spec.adminPort).catch(() => caddy.kill());
            await exited;
        }
        if (wait) return { issued: wait.issued };

        if (!isBindDenied(output) || attempt > 1) return { issued: [], failure: output.trim().split("\n").at(-1) ?? "Caddy exited" };
        const guidance = bindDeniedGuidance({ inContainer: deps.inContainer, caddyPath: binaryPath, platform: deps.platform });
        if (deps.inContainer || !deps.confirm || !deps.runSudoSetcap || deps.platform !== "linux") throw new NeedsAnswerError(guidance);
        if (!(await deps.confirm(`Caddy needs permission to bind port 443. Run: ${setcapCommand(binaryPath)} ?`))) throw new NeedsAnswerError(guidance);
        if (!(await deps.runSudoSetcap(binaryPath))) throw new NeedsAnswerError(guidance);
    }
}

export async function applyKuboConfig(
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
    const identity = await kuboIdentity(options.kuboRpcUrl);
    if (!identity) {
        deps.log("The daemon is not running. Start it with: bitsocial daemon");
        return;
    }
    const deadline = Date.now() + (deps.certificateTimeoutMs ?? 60_000);
    // The file can be right while kubo still runs from an older copy of it, and only a restart loads it.
    if (restart || addressesNotAnnounced(config.announce, identity.addresses).length > 0) {
        await shutdownKubo(options.kuboRpcUrl);
        // The old kubo can answer for a moment after the request, and its answer says nothing about the new one.
        const downBy = Date.now() + 10_000;
        while (Date.now() < downBy && (await kuboIdentity(options.kuboRpcUrl))) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let listen = await kuboListenAddresses(options.kuboRpcUrl);
    while (!listen && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        listen = await kuboListenAddresses(options.kuboRpcUrl);
    }
    if (!listen) {
        deps.warn("kubo has not come back after the restart. Check the daemon, then run: bitsocial reachability status");
        return;
    }
    if (config.serveWss !== false && !listen.some((address) => address.includes(localWsSwarmAddress(config.wsPort)))) {
        deps.warn(`kubo is not listening on ${localWsSwarmAddress(config.wsPort)}. Check the daemon, then run: bitsocial reachability status`);
        return;
    }
    if (!listen.some((address) => address.includes("/udp/443/quic-v1/webtransport")))
        deps.warn(webTransportNotListeningGuidance({ inContainer: deps.inContainer, kuboPath: deps.kuboBinaryPath, platform: deps.platform }));
    const stillMissing = addressesNotAnnounced(config.announce, (await kuboIdentity(options.kuboRpcUrl))?.addresses ?? config.announce);
    if (stillMissing.length > 0) deps.warn(`kubo does not announce ${stillMissing.join(", ")} after a restart. Check Addresses.NoAnnounce in kubo's config.`);
}

export async function runReachabilitySetup(options: SetupOptions, deps: SetupDependencies): Promise<ReachabilityConfig> {
    const acmeDirectory = chooseAcmeDirectory(options);
    assertAcmeDirectoryAllowed(acmeDirectory, deps.isCi);
    if (options.announce) {
        assertAnnounceShape(options.announce);
        // Checked first, so a refusal leaves the kubo config as it was.
        if (!(await kuboIdentity(options.kuboRpcUrl))) throw new SetupRefusedError("--announce is verified by dialling this node through it, so the daemon must be running.");
    }

    const previous = await readReachabilityConfig(options.dataPath);
    const httpsPort = options.overrides?.httpsPort ?? 443;
    const wsPort = previous?.wsPort ?? options.overrides?.wsPort ?? (await chooseWsPort(previous, options.kuboRepoPath));
    const caddyAdminPort = await chooseAdminPort(previous, options.dataPath);
    let domain = options.domain ?? previous?.domain;
    if (domain && !isValidDomain(domain)) throw new SetupRefusedError(`Not a valid domain name: ${domain}`);

    const { publicIps, refused, sawCgnat } = await discoverPublicIps(options, deps, previous?.announce);
    if (publicIps.length > 0) deps.log(`Public addresses: ${publicIps.join(", ")}`);

    // Reported, not enforced: setup goes on to do what it can, and each path below says what it managed.
    for (const check of (await deps.checkRequirements?.({ publicIps, httpsPort, caddyAdminPort, wsPort, ...(options.overrides?.httpPort ? { httpPort: options.overrides.httpPort } : {}) })) ?? []) {
        if (check.status === "fail" || check.status === "warn") deps.warn(formatCheck(check));
    }

    const ourCaddyRunning = await isOurCaddyRunning(caddyAdminPort, options.dataPath);
    const portState = ourCaddyRunning ? "free" : await deps.probePort(httpsPort);
    const portBusy = portState === "busy";
    const holder = portBusy ? await deps.findHolder(httpsPort) : undefined;
    if (portBusy) deps.warn(busyPortMessage(holder));

    // Path B is what is left when the IP certificate cannot work, so that is when it is worth asking.
    // Without a public IP there is nothing to match an answer against, so --domain --force is the way there.
    let domainAskedForNow = options.domain !== undefined;
    if (!domain && !options.announce && deps.ask && portBusy && publicIps.length > 0) {
        const answer = (await deps.ask("Domain name pointing at this machine (Enter to skip):")).trim();
        if (answer) {
            if (!isValidDomain(answer)) throw new SetupRefusedError(`Not a valid domain name: ${answer}`);
            domain = answer;
            domainAskedForNow = true;
        }
    }

    // A proxy answers for a forced name, so its records are not expected to match on later runs either.
    const force = options.force === true || (domain !== undefined && previous?.domain === domain && previous.domainForced === true);
    let records: ResolvedDomain = { v4: [], v6: [] };
    let domainUsable = domain !== undefined;
    if (domain) {
        records = await deps.resolveDomain(domain);
        if (!domainPointsHere(records, publicIps)) {
            const message = dnsMismatchMessage(domain, [...records.v4, ...records.v6], publicIps);
            // Refuse what the operator asked for now. A stored name going stale must not block repairing
            // the rest, so it is not announced for now, and is still stored for when its DNS is fixed.
            if (domainAskedForNow && !force) throw new SetupRefusedError(message);
            deps.warn(message);
            if (force) deps.warn("Continuing because of --force.");
            else domainUsable = false;
        }
    }

    // The daemon announces a stale name again when its DNS recovers, and does not touch the Caddyfile then, so a name
    // that was served here keeps its site. Caddy orders nothing for it while its certificate on disk is still valid for this CA.
    // Our Caddy cannot start with sites while another server holds the port, so there it waits for a rerun of setup.
    const staleOwnAddresses = (domain && !domainUsable ? [`/dns4/${domain}/tcp/${httpsPort}/tls/ws`, `/dns6/${domain}/tcp/${httpsPort}/tls/ws`] : []).filter((address) => !previous?.externalAnnounce?.includes(address));
    const staleWasAnnounced = staleOwnAddresses.filter((address) => previous?.announce.includes(address));
    const keepsStaleSite = !portBusy && (staleWasAnnounced.length > 0 || staleOwnAddresses.some((address) => previous?.droppedAnnounce?.includes(address)));
    const servedDomains = domain && (domainUsable || keepsStaleSite) ? [domain] : [];

    const certificateNames = portBusy ? [] : [...publicIps, ...(domain && domainUsable ? [domain] : [])];
    let issued: string[] = [];
    let failure: string | undefined;
    const spec: CaddyfileSpec = {
        ips: publicIps,
        domains: servedDomains,
        wsPort,
        adminPort: caddyAdminPort,
        dataDirectory: caddyDataDir(options.dataPath),
        acmeDirectory,
        ...(options.overrides?.httpsPort ? { httpsPort: options.overrides.httpsPort } : {}),
        ...(options.overrides?.httpPort ? { httpPort: options.overrides.httpPort } : {}),
        ...(options.overrides?.acmeTrustedRootsPath ? { acmeTrustedRootsPath: options.overrides.acmeTrustedRootsPath } : {})
    };
    // Reruns only add or repair, so a failed attempt must not cost a node the WSS it already serves. The daemon's
    // checks follow an address that moved. A proxy's addresses survive below without this.
    const servedByUs = previous?.enabled && previous.announce.length > (previous.externalAnnounce?.length ?? 0) ? previous : undefined;
    const keepServing = (served: ReachabilityConfig, reason: string): ReachabilityConfig => {
        const message = `${reason}, so nothing changed and this node still announces ${served.announce.join(", ")}.`;
        if (options.announce) throw new SetupRefusedError(message);
        deps.warn(message);
        return served;
    };
    // A router not answering says nothing about the address. Storing no IPs would also stop the daemon looking for them.
    if (servedByUs && publicIps.length === 0 && certificateNames.length === 0 && !portBusy) return keepServing(servedByUs, "No public address was found");
    if (certificateNames.length > 0) {
        deps.log(ACME_NOTICE);
        const previousCaddyfile = await fs.readFile(caddyfilePath(options.dataPath), "utf-8").catch(() => undefined);
        const result = await issueCertificates(spec, certificateNames, previous !== undefined && previous.acmeDirectory !== acmeDirectory, options, deps);
        issued = result.issued;
        failure = result.failure;
        if (servedByUs && issued.length === 0) {
            if (previousCaddyfile !== undefined) await fs.writeFile(caddyfilePath(options.dataPath), previousCaddyfile);
            return keepServing(servedByUs, `No certificate could be issued (${failure ?? "Let's Encrypt could not reach this machine on TCP 80 or 443"})`);
        }
        // Keep only what worked, so the daemon's Caddy does not retry a name forever.
        await fs.writeFile(
            caddyfilePath(options.dataPath),
            generateCaddyfile({ ...spec, ips: publicIps.filter((ip) => issued.includes(ip)), domains: domain && (issued.includes(domain) || keepsStaleSite) ? [domain] : [] })
        );
    } else {
        // Nothing for our Caddy to serve now, so the daemon must not keep starting it for old sites.
        await fs.mkdir(reachabilityDir(options.dataPath), { recursive: true });
        await fs.writeFile(caddyfilePath(options.dataPath), generateCaddyfile({ ...spec, ips: [], domains: keepsStaleSite ? [domain!] : [] }));
    }
    const issuedIps = publicIps.filter((ip) => issued.includes(ip));
    const domainIssued = domain !== undefined && issued.includes(domain);
    if (domain && domainUsable && !portBusy && !domainIssued) deps.warn(`No certificate was issued for ${domain}. ${failure ?? "Let's Encrypt could not reach this machine on TCP 80 or 443 through that name."}`);

    if (issuedIps.length > 0 && issuedIps.every((ip) => net.isIPv6(ip))) deps.warn(IPV6_ONLY_CAVEAT);
    if (issuedIps.length > 0 && !publicIps.some((ip) => net.isIPv6(ip))) deps.log(NO_IPV6_HINT);
    if (deps.platform === "win32" && issued.length > 0) deps.log(windowsFirewallGuidance());

    // WSS needs kubo's loopback listener, the filter removal and AutoTLS off. Without something to terminate it,
    // or an operator who said they are setting that up, those edits would cost something and buy nothing.
    const wantsWss = (externalAnnounce: string[]) => issued.length > 0 || externalAnnounce.length > 0 || keepsStaleSite || (portBusy && domain !== undefined && domainUsable);

    const buildConfig = (externalAnnounce: string[], serveWss: boolean): ReachabilityConfig => {
        const announce = [
            ...issuedIps.map((ip) => announceForIp(ip, httpsPort)),
            ...(domain && domainIssued ? [domainAnnounceAddress(domain, httpsPort, records)] : []),
            ...externalAnnounce
        ];
        // Kept so the daemon can restore a name that recovers later, unless this run announced it again. A domain
        // this run moved away from is forgotten, because it has no site here and the daemon would announce it anyway.
        const stillDropped = [...new Set([...(previous?.droppedAnnounce ?? []), ...(keepsStaleSite ? staleWasAnnounced : [])])].filter(
            (address) => !announce.includes(address) && (address.match(/^\/dns[46]?\/([^/]+)\//)?.[1] === domain || externalAnnounce.includes(address))
        );
        return {
            version: 1,
            enabled: true,
            mode: deriveMode({ ip: issuedIps.length > 0, domain: domainIssued, proxy: externalAnnounce.length > 0 }),
            wsPort,
            announce,
            ...(serveWss ? {} : { serveWss: false }),
            publicIps: issuedIps,
            ...(domain ? { domain } : {}),
            ...(domain && force ? { domainForced: true } : {}),
            ...(externalAnnounce.length > 0 ? { externalAnnounce } : {}),
            ...(stillDropped.length > 0 ? { droppedAnnounce: stillDropped } : {}),
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
    let applied = await applyKuboConfig(
        { ...buildConfig(externalAnnounce, wantsWss(externalAnnounce) || options.announce !== undefined), ...(previous?.kuboEdits ? { kuboEdits: previous.kuboEdits } : {}) },
        options,
        true
    );
    await restartAndVerifyKubo(applied.config, applied.kuboConfigChanged, options, deps);

    if (options.announce) {
        const identity = await kuboIdentity(options.kuboRpcUrl);
        if (!identity) throw new SetupRefusedError("--announce is verified by dialling this node through it, so the daemon must be running.");
        try {
            await deps.dial(`${options.announce}/p2p/${identity.peerId}`);
        } catch (error) {
            // Back to how it was before this attempt, so a failed try does not cost AutoTLS or the filter.
            applied = await applyKuboConfig(
                { ...buildConfig(externalAnnounce, wantsWss(externalAnnounce)), ...(applied.config.kuboEdits ? { kuboEdits: applied.config.kuboEdits } : {}) },
                options,
                true
            );
            await restartAndVerifyKubo(applied.config, applied.kuboConfigChanged, options, deps);
            throw new SetupRefusedError(`Could not complete a libp2p handshake with this node through ${options.announce}, so it was not announced: ${(error as Error).message}`);
        }
        deps.log(`Verified ${options.announce} with a libp2p handshake.`);
        externalAnnounce = [...new Set([...externalAnnounce, options.announce])];
        applied = await applyKuboConfig({ ...buildConfig(externalAnnounce, true), ...(applied.config.kuboEdits ? { kuboEdits: applied.config.kuboEdits } : {}) }, options, true);
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

    if (portBusy && domain && domainUsable) {
        deps.warn(noWssStatement("no reverse proxy has been verified yet"));
        deps.log(reverseProxySnippet(holder, domain, wsPort));
        if (!deps.confirm) throw new NeedsAnswerError(`Set up the reverse proxy above, then rerun setup with --announce. kubo is listening on 127.0.0.1:${wsPort}.`);
        return config;
    }
    if (publicIps.length === 0) {
        const reason = sawCgnat ? "this network is behind carrier-grade NAT and has no global IPv6" : "no public IPv4 or global IPv6 address was found";
        deps.warn(unreachableStatement(refused.length > 0 ? `${reason}; the router refused ${refused.join(", ")}` : reason));
        return config;
    }
    if (portBusy) {
        deps.warn(noWssStatement("another program holds TCP 443"));
        deps.log(existingServerGuidance(holder, publicIps.find((ip) => net.isIPv4(ip)) ?? publicIps[0]!, wsPort, httpsPort));
        if (!deps.confirm) throw new NeedsAnswerError("Setting up browser access through the program holding TCP 443 needs you to act, as printed above.");
        return config;
    }
    const reason = failure ?? "Let's Encrypt could not reach this machine on TCP 80 or 443";
    deps.warn(noWssStatement(refused.length > 0 ? `${reason}; the router refused ${refused.join(", ")}` : reason));
    return config;
}
