import type { ChildProcess } from "child_process";
import fs from "fs/promises";
import net from "net";
import { caddyfilePath, ensureCaddyBinary, generateCaddyfile, isOurCaddyRunning, reloadCaddy, startCaddy, stopCaddy, waitForCertificates } from "./caddy.js";
import { kuboIdentity, lanIpv4FromInterfaces, publicIpsFromInterfaces, publicIpsFromMultiaddrs, shutdownKubo } from "./discovery.js";
import { discoverNatRouter, type NatRouter } from "./nat.js";
import { applyKuboConfig, resolveDomainRecords, type ResolvedDomain } from "./setup.js";
import {
    caddyDataDir,
    currentCertificates,
    isSameCertificateName,
    readIssuedCertificates,
    readReachabilityConfig,
    readReachabilityRuntimeStatus,
    writeReachabilityRuntimeStatus,
    type ReachabilityConfig,
    type ReachabilityRuntimeStatus
} from "./state.js";

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const LEASE_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
export const CADDY_WATCH_INTERVAL_MS = 5000;
const HOUR_MS = 60 * 60 * 1000;
export const STALE_NAME_DROP_AFTER_MS = 24 * HOUR_MS;
export const CERTIFICATE_WARNING_HOURS = 24;

export const NOT_CONFIGURED_MESSAGE = "Browsers cannot reach this node. To fix that, run: bitsocial reachability setup";

// The IPs we should now serve, or undefined for no change. A family we find nothing for is left alone,
// because a router not answering or kubo not yet having peers says nothing about the address.
export function planIpChange(current: string[], derived: string[]): string[] | undefined {
    const next: string[] = [];
    for (const isFamily of [net.isIPv4, net.isIPv6]) {
        const held = current.filter((ip) => isFamily(ip));
        const seen = derived.filter((ip) => isFamily(ip));
        if (seen.length === 0) next.push(...held);
        else {
            const stillHeld = held.filter((ip) => seen.some((other) => isSameCertificateName(ip, other)));
            next.push(...(stillHeld.length > 0 ? stillHeld : seen.slice(0, 1)));
        }
    }
    const unchanged = next.length === current.length && next.every((ip) => current.some((other) => isSameCertificateName(ip, other)));
    return unchanged ? undefined : next;
}

export interface AnnouncedName {
    name: string;
    address: string;
    // A proxy is meant to answer for the name, so only its disappearing counts as failure.
    onlyRequireResolution: boolean;
}

export function announcedNames(config: ReachabilityConfig): AnnouncedName[] {
    const names: AnnouncedName[] = [];
    for (const address of [...config.announce, ...(config.droppedAnnounce ?? [])]) {
        const name = address.match(/^\/dns[46]?\/([^/]+)\//)?.[1];
        if (!name) continue;
        const isProxied = (config.externalAnnounce ?? []).includes(address) || (name === config.domain && config.domainForced === true);
        names.push({ name, address, onlyRequireResolution: isProxied });
    }
    return names;
}

export function isNameHealthy(entry: AnnouncedName, records: ResolvedDomain, publicIps: string[]): boolean {
    const resolved = [...records.v4, ...records.v6];
    if (resolved.length === 0) return false;
    if (entry.onlyRequireResolution) return true;
    return resolved.some((ip) => publicIps.some((own) => isSameCertificateName(ip, own)));
}

export type NameVerdict = { warn: boolean; drop: boolean; restore: boolean; failingSince?: string };

export function judgeName(healthy: boolean, previous: { failingSince?: string; droppedFromAnnounce?: boolean } | undefined, lastWarnedAt: number | undefined, now: number): NameVerdict {
    if (healthy) return { warn: false, drop: false, restore: previous?.droppedFromAnnounce === true };
    const failingSince = previous?.failingSince ?? new Date(now).toISOString();
    return {
        warn: lastWarnedAt === undefined || now - lastWarnedAt >= HOUR_MS,
        drop: previous?.droppedFromAnnounce !== true && now - new Date(failingSince).getTime() >= STALE_NAME_DROP_AFTER_MS,
        restore: false,
        failingSince
    };
}

export const staleNameWarning = (address: string, since: string) =>
    `${address} has not pointed at this node since ${since}. It is dropped from the announced addresses after 24 hours. Fix its DNS or run: bitsocial reachability setup`;

export interface RuntimeDependencies {
    dataPath: string;
    kuboRepoPath: string;
    kuboRpcUrl: URL;
    log: (message: string) => void;
    warn: (message: string) => void;
    now?: () => number;
    // Overridable so tests can drive every decision without a router, DNS or real Caddy.
    derivePublicIps?: () => Promise<string[]>;
    resolveDomain?: (name: string) => Promise<ResolvedDomain>;
    caddy?: {
        start: (onExit: () => void) => Promise<void>;
        stop: () => Promise<void>;
        reload: (caddyfile: string) => Promise<void>;
        isUp: () => Promise<boolean>;
    };
    restartKubo?: () => Promise<void>;
    waitForIssuance?: (config: ReachabilityConfig, names: string[]) => Promise<string[]>;
    discoverRouter?: () => Promise<NatRouter | undefined>;
    hasPublicIpv4Interface?: () => boolean;
    lanIpv4?: () => string | undefined;
}

export class ReachabilityRuntime {
    private readonly deps: RuntimeDependencies;
    private readonly now: () => number;
    private caddyChild: ChildProcess | undefined;
    private caddyRunning = false;
    private caddyAdopted = false;
    private watchQueue: Promise<unknown> = Promise.resolve();
    private expectingCaddyExit = false;
    private leases: Promise<void> | undefined;
    private stopping = false;
    private loadedCaddyfile: string | undefined;
    private router: NatRouter | undefined;
    private pendingIps: string | undefined;
    private readonly lastWarned = new Map<string, number>();
    private timers: NodeJS.Timeout[] = [];
    private checkInFlight: Promise<void> | undefined;

    constructor(deps: RuntimeDependencies) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
    }

    private warnThrottled(key: string, message: string) {
        const last = this.lastWarned.get(key);
        if (last !== undefined && this.now() - last < HOUR_MS) return;
        this.lastWarned.set(key, this.now());
        this.deps.warn(message);
    }

    async start(): Promise<void> {
        const config = await this.readConfig();
        if (!config) {
            this.deps.warn(NOT_CONFIGURED_MESSAGE);
        } else if (config.enabled) {
            await this.printAddresses(config);
        }
        // A failed start, e.g. a download error, must not stop the checks: the next tick tries again.
        await this.watchCaddy().catch((error) => this.warnThrottled("caddy-start", `Caddy could not start: ${(error as Error).message}`));
        // setup's lease may have expired while no daemon was running, so this cannot wait for the first refresh.
        this.leases = this.refreshLeases().catch((error) => this.deps.warn(String(error)));
        this.timers.push(setInterval(() => void this.watchCaddy().catch((error) => this.warnThrottled("caddy-start", `Caddy could not start: ${(error as Error).message}`)), CADDY_WATCH_INTERVAL_MS));
        this.timers.push(setInterval(() => void this.runChecks().catch((error) => this.deps.warn(String(error))), CHECK_INTERVAL_MS));
        this.timers.push(setInterval(() => void this.refreshLeases().catch((error) => this.deps.warn(String(error))), LEASE_REFRESH_INTERVAL_MS));
        for (const timer of this.timers) timer.unref();
    }

    private async readConfig(): Promise<ReachabilityConfig | undefined> {
        try {
            return await readReachabilityConfig(this.deps.dataPath);
        } catch (error) {
            this.warnThrottled("config", `Reachability is not running: ${(error as Error).message}`);
            return undefined;
        }
    }

    private async printAddresses(config: ReachabilityConfig) {
        this.deps.log(`Browser addresses: ${config.announce.join(", ") || "none (WebTransport only)"}`);
        const names = [...config.publicIps, ...(config.domain ? [config.domain] : [])];
        const certificates = currentCertificates(await readIssuedCertificates(this.deps.dataPath, new Date(this.now())), config.acmeDirectory, names);
        for (const certificate of certificates) this.deps.log(`Certificate for ${certificate.names.join(", ")} expires ${certificate.notAfter}`);
    }

    private get caddy() {
        return (
            this.deps.caddy ?? {
                start: async (onExit: () => void) => {
                    const binaryPath = await ensureCaddyBinary(this.deps.dataPath);
                    let output = "";
                    this.caddyChild = startCaddy(this.deps.dataPath, binaryPath, (line) => {
                        output = (output + line).slice(-2000);
                    });
                    this.caddyChild.once("exit", () => {
                        this.caddyChild = undefined;
                        if (!this.stopping && !this.expectingCaddyExit) this.warnThrottled("caddy-exit", `Caddy exited, so browsers cannot reach this node over WSS until it restarts. Last output: ${output.trim().split("\n").at(-1) ?? "none"}`);
                        this.expectingCaddyExit = false;
                        onExit();
                    });
                },
                stop: async () => {
                    const config = await this.readConfig();
                    if (config) await stopCaddy(config.caddyAdminPort).catch(() => this.caddyChild?.kill());
                    else this.caddyChild?.kill();
                },
                reload: async (caddyfile: string) => {
                    const config = await this.readConfig();
                    if (config) await reloadCaddy(config.caddyAdminPort, caddyfile);
                },
                isUp: async () => {
                    const config = await this.readConfig();
                    return config ? isOurCaddyRunning(config.caddyAdminPort, this.deps.dataPath) : false;
                }
            }
        );
    }

    // Runs every few seconds, so `setup`, `enable` and `disable` take effect on a running daemon and
    // a crashed Caddy comes back the same way a crashed kubo does.
    // Serialized: a slow start, such as the first download, would otherwise overlap the next tick and spawn twice.
    watchCaddy(): Promise<void> {
        const run = this.watchQueue.then(() => this.watchCaddyOnce());
        this.watchQueue = run.catch(() => {});
        return run;
    }

    private async watchCaddyOnce(): Promise<void> {
        if (this.stopping) return;
        const config = await this.readConfig();
        const wanted = config?.enabled === true && config.publicIps.length + (config.domain ? 1 : 0) > 0;
        const caddyfile = wanted ? await fs.readFile(caddyfilePath(this.deps.dataPath), "utf-8").catch(() => undefined) : undefined;
        const hasSites = caddyfile !== undefined && /^https:\/\//m.test(caddyfile);

        if (!hasSites) {
            if (this.caddyRunning) {
                this.expectingCaddyExit = true;
                await this.caddy.stop().catch(() => {});
                this.caddyRunning = false;
                this.caddyAdopted = false;
                this.loadedCaddyfile = undefined;
            }
            return;
        }
        // An adopted Caddy is not our child, so nothing tells us when it goes away.
        if (this.caddyAdopted && !(await this.caddy.isUp())) {
            this.caddyAdopted = false;
            this.caddyRunning = false;
        }
        if (!this.caddyRunning) {
            // Left by a daemon that was killed, or by a setup still in progress: adopt it, don't fight it.
            if (await this.caddy.isUp()) {
                this.caddyRunning = true;
                this.caddyAdopted = true;
                this.loadedCaddyfile = undefined;
            } else {
                await this.caddy.start(() => {
                    this.caddyRunning = false;
                    this.loadedCaddyfile = undefined;
                });
                this.caddyRunning = true;
                this.loadedCaddyfile = caddyfile;
                return;
            }
        }
        if (caddyfile !== this.loadedCaddyfile) {
            await this.caddy.reload(caddyfile);
            this.loadedCaddyfile = caddyfile;
        }
    }

    private async derivePublicIps(config: ReachabilityConfig): Promise<string[]> {
        if (this.deps.derivePublicIps) return this.deps.derivePublicIps();
        const override = process.env["BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS"];
        if (override) return override.split(",");
        const fromInterfaces = publicIpsFromInterfaces();
        const ips = new Set(fromInterfaces);
        if (!fromInterfaces.some((ip) => net.isIPv4(ip))) {
            this.router ??= await (this.deps.discoverRouter ?? discoverNatRouter)();
            const external = await this.router?.externalIp().catch(() => undefined);
            if (external) for (const ip of publicIpsFromMultiaddrs([`/ip4/${external}`])) ips.add(ip);
        }
        // Peers' reports of our address are the noisiest source, so they only fill in a missing family.
        const identity = await kuboIdentity(this.deps.kuboRpcUrl);
        const observed = identity ? publicIpsFromMultiaddrs(identity.addresses, config.announce) : [];
        for (const isFamily of [net.isIPv4, net.isIPv6])
            if (![...ips].some((ip) => isFamily(ip))) for (const ip of observed.filter((candidate) => isFamily(candidate))) ips.add(ip);
        return [...ips];
    }

    private async restartKubo() {
        if (this.deps.restartKubo) return this.deps.restartKubo();
        await shutdownKubo(this.deps.kuboRpcUrl);
    }

    private async saveAndApply(config: ReachabilityConfig) {
        // This can follow a wait of up to 90 s. An operator may have run disable during it, which must stand.
        const latest = await this.readConfig();
        if (!latest?.enabled) return latest ?? config;
        const { kuboEdits: _stale, ...rest } = config;
        const { config: applied, kuboConfigChanged } = await applyKuboConfig({ ...rest, ...(latest.kuboEdits ? { kuboEdits: latest.kuboEdits } : {}) }, this.deps, true);
        if (kuboConfigChanged) await this.restartKubo();
        return applied;
    }

    private async handleIpChange(config: ReachabilityConfig, nextIps: string[]): Promise<ReachabilityConfig> {
        // Moves only IP-certificate addresses. A domain's or proxy's address does not contain our IP.
        const spec = {
            // A dropped name keeps its site: nothing else would add it back when its DNS recovers.
            domains: config.domain && [...config.announce, ...(config.droppedAnnounce ?? [])].some((address) => address.includes(`/${config.domain}/`)) ? [config.domain] : [],
            wsPort: config.wsPort,
            adminPort: config.caddyAdminPort,
            dataDirectory: caddyDataDir(this.deps.dataPath),
            acmeDirectory: config.acmeDirectory,
            ...(config.httpsPort ? { httpsPort: config.httpsPort } : {}),
            ...(config.httpPort ? { httpPort: config.httpPort } : {}),
            ...(config.acmeTrustedRootsPath ? { acmeTrustedRootsPath: config.acmeTrustedRootsPath } : {})
        };
        const previousCaddyfile = await fs.readFile(caddyfilePath(this.deps.dataPath), "utf-8").catch(() => undefined);
        const candidate = generateCaddyfile({ ...spec, ips: nextIps });
        await fs.writeFile(caddyfilePath(this.deps.dataPath), candidate);
        await this.watchCaddy();

        const issued = this.deps.waitForIssuance
            ? await this.deps.waitForIssuance(config, nextIps)
            : (await waitForCertificates(this.deps.dataPath, config.acmeDirectory, nextIps)).issued;
        // Nothing issued, e.g. a rate limit or an ACME outage. Keep the stored addresses so the next checks
        // retry: with an empty list the daemon would never look at IPs again, and would stop Caddy too.
        if (issued.length === 0) {
            this.deps.warn(`No certificate could be issued for ${nextIps.join(", ")} after the IP change. Will retry.`);
            if (previousCaddyfile !== undefined) await fs.writeFile(caddyfilePath(this.deps.dataPath), previousCaddyfile);
            await this.watchCaddy();
            return config;
        }
        if (issued.length !== nextIps.length) {
            this.deps.warn(`No certificate could be issued for ${nextIps.filter((ip) => !issued.includes(ip)).join(", ")} after the IP change.`);
            await fs.writeFile(caddyfilePath(this.deps.dataPath), generateCaddyfile({ ...spec, ips: issued }));
            await this.watchCaddy();
        }
        const port = config.httpsPort ?? 443;
        const ipAddress = (ip: string) => `/${net.isIPv6(ip) ? "ip6" : "ip4"}/${ip}/tcp/${port}/tls/ws`;
        const oldIpAddresses = config.publicIps.map(ipAddress);
        const announce = [...issued.map(ipAddress), ...config.announce.filter((address) => !oldIpAddresses.includes(address))];
        this.deps.log(`Public address changed from ${config.publicIps.join(", ") || "none"} to ${issued.join(", ") || "none"}. Announcing: ${announce.join(", ") || "nothing"}`);
        return this.saveAndApply({ ...config, publicIps: issued, announce });
    }

    private async checkNames(config: ReachabilityConfig, publicIps: string[], status: ReachabilityRuntimeStatus): Promise<ReachabilityConfig> {
        const domains: NonNullable<ReachabilityRuntimeStatus["domains"]> = {};
        let next = config;
        let changed = false;
        for (const entry of announcedNames(config)) {
            const records = await (this.deps.resolveDomain ?? resolveDomainRecords)(entry.name);
            const healthy = isNameHealthy(entry, records, publicIps);
            const previous = status.domains?.[entry.name];
            const verdict = judgeName(healthy, previous, this.lastWarned.get(`name:${entry.name}`), this.now());
            const nowIso = new Date(this.now()).toISOString();
            let droppedFromAnnounce = previous?.droppedFromAnnounce === true;
            if (verdict.warn) this.warnThrottled(`name:${entry.name}`, staleNameWarning(entry.address, verdict.failingSince!));
            if (healthy) this.lastWarned.delete(`name:${entry.name}`);
            if (verdict.drop) {
                next = {
                    ...next,
                    announce: next.announce.filter((address) => address !== entry.address),
                    droppedAnnounce: [...new Set([...(next.droppedAnnounce ?? []), entry.address])]
                };
                droppedFromAnnounce = true;
                changed = true;
                this.deps.warn(`${entry.address} failed for 24 hours and is no longer announced.`);
            }
            if (verdict.restore) {
                const stillDropped = (next.droppedAnnounce ?? []).filter((address) => address !== entry.address);
                next = { ...next, announce: [...new Set([...next.announce, entry.address])], ...(stillDropped.length > 0 ? { droppedAnnounce: stillDropped } : {}) };
                if (stillDropped.length === 0) delete next.droppedAnnounce;
                droppedFromAnnounce = false;
                changed = true;
                this.deps.log(`${entry.address} points at this node again and is announced again.`);
            }
            domains[entry.name] = {
                lastCheckAt: nowIso,
                ok: healthy,
                ...(verdict.failingSince ? { failingSince: verdict.failingSince } : {}),
                ...(droppedFromAnnounce ? { droppedFromAnnounce } : {})
            };
        }
        status.domains = domains;
        return changed ? this.saveAndApply(next) : next;
    }

    private async checkCertificates(config: ReachabilityConfig) {
        const names = [...config.publicIps, ...(config.domain ? [config.domain] : [])];
        const certificates = currentCertificates(await readIssuedCertificates(this.deps.dataPath, new Date(this.now())), config.acmeDirectory, names);
        for (const certificate of certificates)
            if (certificate.hoursLeft < CERTIFICATE_WARNING_HOURS)
                this.warnThrottled(`certificate:${certificate.names.join()}`, `The certificate for ${certificate.names.join(", ")} has ${certificate.hoursLeft} hours left. Caddy normally renews it long before this, so check that TCP 80 or 443 still reaches this machine.`);
    }

    // Single-flight: an IP change can outlast the interval, and two at once would fight over kubo's config.
    runChecks(): Promise<void> {
        this.checkInFlight ??= this.runChecksOnce().finally(() => {
            this.checkInFlight = undefined;
        });
        return this.checkInFlight;
    }

    private async runChecksOnce(): Promise<void> {
        if (this.stopping) return;
        let config = await this.readConfig();
        if (!config?.enabled) return;
        const status: ReachabilityRuntimeStatus = (await readReachabilityRuntimeStatus(this.deps.dataPath)) ?? { updatedAt: "" };
        const derived = await this.derivePublicIps(config);
        const nowIso = new Date(this.now()).toISOString();
        status.lastIpCheck = { at: nowIso, publicIps: derived };

        // Only addresses that hold a certificate move. A proxy-only node has nothing here to change.
        if (config.publicIps.length > 0) {
            const nextIps = planIpChange(config.publicIps, derived);
            // Seen twice in a row before acting: a restart is too costly to spend on one odd reading.
            const key = nextIps?.join() ?? undefined;
            if (key !== undefined && key === this.pendingIps) {
                this.pendingIps = undefined;
                config = await this.handleIpChange(config, nextIps!);
            } else {
                this.pendingIps = key;
            }
        }
        config = await this.checkNames(config, [...new Set([...derived, ...config.publicIps])], status);
        await this.checkCertificates(config);
        status.caddy = { running: this.caddyRunning };
        status.updatedAt = nowIso;
        await writeReachabilityRuntimeStatus(this.deps.dataPath, status);
    }

    async refreshLeases(): Promise<void> {
        const config = await this.readConfig();
        if (!config?.enabled) {
            await this.router?.release().catch(() => {});
            this.router = undefined;
            return;
        }
        const hasPublicIpv4 = this.deps.hasPublicIpv4Interface?.() ?? (Boolean(process.env["BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS"]) || publicIpsFromInterfaces().some((ip) => net.isIPv4(ip)));
        if (hasPublicIpv4) return;
        this.router ??= await (this.deps.discoverRouter ?? discoverNatRouter)();
        const lanIp = (this.deps.lanIpv4 ?? lanIpv4FromInterfaces)();
        if (this.router && lanIp) await this.router.mapPorts(lanIp);
    }

    leasesSettled(): Promise<void> {
        return this.leases ?? Promise.resolve();
    }

    async stop(): Promise<void> {
        this.stopping = true;
        for (const timer of this.timers) clearInterval(timer);
        this.timers = [];
        await this.checkInFlight?.catch(() => {});
        await this.watchQueue;
        await this.leases;
        await this.router?.release().catch(() => {});
        if (!this.caddyRunning) return;
        const child = this.caddyChild;
        await this.caddy.stop().catch(() => {});
        if (child && child.exitCode === null && child.signalCode === null) {
            await Promise.race([
                new Promise((resolve) => child.once("exit", resolve)),
                new Promise((resolve) => setTimeout(resolve, 5000).unref())
            ]);
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
        this.caddyRunning = false;
    }

    // For the daemon's synchronous exit path, where nothing can be awaited.
    killCaddySync(): void {
        this.caddyChild?.kill("SIGKILL");
    }
}

