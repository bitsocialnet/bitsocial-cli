import { execFile } from "child_process";
import dgram from "dgram";
import { promises as fs } from "fs";
import net from "net";
import os from "os";
import { promisify } from "util";
import { caddyBinaryPath, isOurCaddyRunning } from "./caddy.js";
import { addressesNotAnnounced, publicIpsFromMultiaddrs, detectContainer, findPortHolder, worstPortState, isPublicMultiaddr, kuboAutonat, kuboIdentity, kuboListenAddresses, parseSsHolder, probeTcpPort, publicIpsFromInterfaces, type KuboAutonat, type PortState } from "./discovery.js";
import { setcapCommand, tailscaleFunnelFix, UNPRIVILEGED_PORT_SYSCTL } from "./guidance.js";
import type { CertificateInfo } from "./state.js";
import { loadKuboConfigFile } from "../util.js";

const execFileAsync = promisify(execFile);

export type CheckStatus = "ok" | "warn" | "fail" | "unknown";

export interface ReachabilityCheck {
    id: string;
    status: CheckStatus;
    detail: string;
    fix?: string;
}

const CAP_NET_BIND_SERVICE_BIT = 10n;

export interface BindPermissionInput {
    platform: string;
    port: number;
    uid: number | undefined;
    // /proc/self/status CapEff, which is what actually counts for root in a container that dropped it.
    effectiveCapabilities: bigint | undefined;
    unprivilegedPortStart: number | undefined;
    // `getcap` output for the binary; undefined when getcap could not be run.
    fileCapabilities: string | undefined;
}

export type BindPermission = "allowed" | "denied" | "unknown";

// Whether a binary we spawn may bind this port. Asking Node to bind proves nothing: setcap on Caddy or
// kubo does not apply to Node, and the reverse is just as true.
export function bindPermission(input: BindPermissionInput): BindPermission {
    if (input.platform !== "linux" || input.port >= 1024) return "allowed"; // macOS since 10.14, and Windows
    if (input.unprivilegedPortStart !== undefined && input.unprivilegedPortStart <= input.port) return "allowed";
    if (input.uid === 0) {
        if (input.effectiveCapabilities === undefined) return "allowed";
        return (input.effectiveCapabilities >> CAP_NET_BIND_SERVICE_BIT) & 1n ? "allowed" : "denied";
    }
    if (input.fileCapabilities === undefined) return "unknown";
    return input.fileCapabilities.includes("cap_net_bind_service") ? "allowed" : "denied";
}

export interface FirewallState {
    name: "ufw" | "firewalld";
    active: boolean;
    allowsTcp443: boolean;
    allowsUdp443: boolean;
}

export const parseUfwStatus = (output: string): FirewallState | undefined => {
    if (!/^Status:/m.test(output)) return undefined;
    const active = /^Status: active/m.test(output);
    // Outgoing rules print as ALLOW OUT, and say nothing about what reaches this machine.
    const allowedInbound = output.split("\n").filter((line) => /\bALLOW\b(?! OUT)/.test(line));
    // The first column is a port, a list or range such as 80,443/tcp or 443:444/udp, or Anywhere, with an optional protocol.
    const hasPortRule = (protocol: string) =>
        allowedInbound.some((line) => {
            const [ports = "", ruleProtocol] = line.split(/\s/, 1)[0]!.replace(/\(v6\)$/, "").split("/");
            if (ruleProtocol && ruleProtocol !== protocol) return false;
            if (ports === "Anywhere") return true;
            return ports.split(",").some((part) => {
                const [first, last = first] = part.split(":").map(Number);
                return first! <= 443 && 443 <= last!;
            });
        });
    // App profiles only open TCP.
    const hasTcpProfile = allowedInbound.some((line) => /^(Caddy|Nginx (HTTPS|Full)|Apache (Secure|Full))\b/.test(line));
    return { name: "ufw", active, allowsTcp443: hasPortRule("tcp") || hasTcpProfile, allowsUdp443: hasPortRule("udp") };
};

export const parseFirewalldState = (state: string, ports: string, services: string): FirewallState => ({
    name: "firewalld",
    active: state.trim() === "running",
    allowsTcp443: /\b443\/tcp\b/.test(ports) || /\bhttps\b/.test(services),
    allowsUdp443: /\b443\/udp\b/.test(ports) || /\bhttp3\b/.test(services)
});

export interface CheckFacts {
    platform: string;
    inContainer: boolean;
    enabled: boolean;
    daemonRunning: boolean;
    publicIps: string[];
    httpsPort: number;
    httpPort?: number;
    wsPort: number | undefined;
    caddyPath: string;
    kuboPath: string;
    ourCaddyRunning: boolean;
    tcp443: PortState;
    tcp443Holder: string | undefined;
    tcp80: PortState;
    tcp80Holder: string | undefined;
    udp443: PortState;
    udp443Holder: string | undefined;
    caddyBind: BindPermission;
    kuboBind: BindPermission;
    kuboListen: string[] | undefined;
    // What setup applied, against what kubo's config file says and what running kubo reports.
    announce: string[];
    kuboConfigAnnounce: string[] | undefined;
    kuboRunningAnnounce: string[] | undefined;
    firewall: FirewallState | undefined;
    certificates: CertificateInfo[];
    // WSS addresses kubo announces that passed a handshake from this machine. Only `status` fills these two in.
    verifiedWss?: string[];
    kuboAutonat?: KuboAutonat;
}

const bindFix = (facts: CheckFacts, binaryPath: string) => {
    if (facts.inContainer) return "Add cap_add: [NET_BIND_SERVICE] to your compose file";
    return `You only need one of these: ${UNPRIVILEGED_PORT_SYSCTL} (persist it in /etc/sysctl.d/), or ${setcapCommand(binaryPath)}`;
};

// "Announced addresses" in status is our own record, so only this says whether kubo really announces them.
function kuboAnnounceCheck(facts: CheckFacts): ReachabilityCheck | undefined {
    if (facts.announce.length === 0) return undefined;
    if (facts.kuboConfigAnnounce === undefined && facts.kuboRunningAnnounce === undefined) return undefined;
    const fix = "Run: bitsocial reachability enable";
    const missingFromConfig = addressesNotAnnounced(facts.announce, facts.kuboConfigAnnounce ?? facts.announce);
    if (missingFromConfig.length > 0)
        return { id: "kubo-announce", status: "fail", detail: `kubo's config does not announce ${missingFromConfig.join(", ")}, so browsers cannot learn it from this node`, fix };
    const notRunning = addressesNotAnnounced(facts.announce, facts.kuboRunningAnnounce ?? facts.announce);
    if (notRunning.length > 0)
        return {
            id: "kubo-announce",
            status: "fail",
            detail: `Running kubo does not announce ${notRunning.join(", ")}, so browsers cannot learn it from this node`,
            fix: `${fix}. If that does not help, check Addresses.NoAnnounce in kubo's config`
        };
    return { id: "kubo-announce", status: "ok", detail: `kubo announces ${facts.announce.length === 1 ? "the browser address" : `all ${facts.announce.length} browser addresses`}` };
}

export const NO_PUBLIC_ADDRESS_MESSAGE =
    "This node announces no public address, so other nodes and browsers cannot reach it and it seeds nothing for them";
const NO_PUBLIC_ADDRESS_FIX =
    "Forward UDP and TCP 4001 (and 443) on the router or enable UPnP, run on a host with a public IPv4 or global IPv6, or, inside a VM, use bridged networking instead of NAT. Then run: bitsocial reachability setup";
const NO_PUBLIC_ADDRESS_CONTAINER_FIX = "In Docker, use --network host or publish 4001/udp and 4001/tcp";

export const noPublicAddressFix = (inContainer: boolean) =>
    inContainer ? `${NO_PUBLIC_ADDRESS_FIX}. ${NO_PUBLIC_ADDRESS_CONTAINER_FIX}` : NO_PUBLIC_ADDRESS_FIX;

// What the network sees, unlike public-address, which looks at this machine's interfaces. Without a public
// address in kubo's own announcements, no other node or browser can dial it, whatever this machine has.
export function publicAddressAnnouncedCheck(input: {
    running: string[] | undefined;
    inContainer: boolean;
    treatAsPublic?: string[];
}): ReachabilityCheck {
    const id = "public-address-announced";
    if (input.running === undefined)
        return { id, status: "unknown", detail: "kubo is not running, so the addresses it announces cannot be read" };
    const bare = [...new Set(input.running.map((address) => address.replace(/\/p2p\/[^/]+$/, "")))];
    const publicAddresses = bare.filter((address) => isPublicMultiaddr(address, input.treatAsPublic));
    if (publicAddresses.length > 0) {
        const shown = publicAddresses.slice(0, 3).join(", ");
        const more = publicAddresses.length > 3 ? ` and ${publicAddresses.length - 3} more` : "";
        return { id, status: "ok", detail: `kubo announces public addresses: ${shown}${more}` };
    }
    const announced = bare.length > 0 ? `. It announces only ${bare.join(", ")}` : ". It announces no address at all";
    return { id, status: "fail", detail: `${NO_PUBLIC_ADDRESS_MESSAGE}${announced}`, fix: noPublicAddressFix(input.inContainer) };
}

// AutoNAT tests UDP 4001 and the like, not the UDP 443 this check is about. Plain QUIC doesn't count: browsers need WebTransport.
const isUdpFallback = (address: string) => {
    const port = address.match(/\/udp\/(\d+)\/quic-v1\/webtransport/)?.[1];
    return port !== undefined && port !== "443";
};

// What losing UDP 443 costs a node that browsers already reach over WSS: WebTransport has only its other UDP port left.
function udpUnavailableBesideWorkingWss(facts: CheckFacts): ReachabilityCheck {
    const isHeld = facts.udp443 === "busy";
    const held = isHeld ? `UDP 443 is held by ${facts.udp443Holder ?? "another program"}` : "kubo has no permission to bind UDP 443";
    const fix = isHeld ? "Stop whatever holds UDP 443, so kubo can listen there" : bindFix(facts, facts.kuboPath);
    const reachable = facts.kuboAutonat?.reachable.filter(isUdpFallback) ?? [];
    if (reachable.length > 0) {
        const port = reachable[0]!.match(/\/udp\/(\d+)\//)![1];
        // go-libp2p marks a WebTransport address reachable once QUIC on its port is, without dialing WebTransport itself.
        return { id: "udp-443", status: "ok", detail: `${held}, but AutoNAT reached kubo over QUIC on UDP ${port}, so browsers that support WebTransport should be able to use it unless their network blocks UDP: ${reachable.join(", ")}` };
    }
    const unreachable = facts.kuboAutonat?.unreachable.filter(isUdpFallback) ?? [];
    if (unreachable.length > 0) return { id: "udp-443", status: "warn", detail: `${held}, and AutoNAT could not reach kubo's other UDP addresses, so WebTransport may not work: ${unreachable.join(", ")}`, fix };
    return { id: "udp-443", status: "warn", detail: `${held}, and whether WebTransport works on kubo's other UDP port has not been tested yet`, fix };
}

function inboundCheck(facts: CheckFacts): ReachabilityCheck {
    const { reachable = [], unreachable = [], unknown = [] } = facts.kuboAutonat ?? {};
    // Nothing on this machine can prove this, including a cloud provider's firewall, which is invisible from here.
    const unproven = "Only a connection from another network can prove inbound traffic reaches this machine. A provider firewall cannot be seen from here";
    if (reachable.length + unreachable.length + unknown.length === 0) return { id: "inbound", status: "unknown", detail: unproven };
    const results = [
        ...(reachable.length > 0 ? [`AutoNAT reached: ${reachable.join(", ")}`] : []),
        ...(unreachable.length > 0 ? [`AutoNAT could not reach: ${unreachable.join(", ")}`] : []),
        ...(unknown.length > 0 ? [`Not tested yet: ${unknown.join(", ")}`] : [])
    ].join(". ");
    const status = reachable.length > 0 ? "ok" : unreachable.length > 0 ? "warn" : "unknown";
    return { id: "inbound", status, detail: `${results}. This does not cover WSS through a reverse proxy, which only a connection from another network can prove` };
}

// A node setup ran on and left without WSS, because the internet could not reach it on TCP 443. With another program
// on that port and a public address, setup's reverse proxy guidance applies instead. Without a public address that
// program cannot be reached either, and Funnel does not use this machine's TCP 443, so the pointer still applies.
// A forced name is the exception: setup takes it without a public address to match, and prints the reverse proxy
// snippet for it. A stored name that was not forced gets that only where it resolves to a public address found here.
// Nor does it apply while a WSS address setup does not manage works, such as one from AutoTLS, or after a name
// that worked here was dropped, where its DNS is what needs fixing.
// The public-address evidence setup uses, as far as status can have it: interfaces, and the addresses running kubo
// reports apart from the ones we told it to announce. kubo maps ports on a UPnP router itself and then reports the
// router's external address. Status does not ask the router as setup does, so with the daemon stopped only interfaces count.
export const hasPublicAddressEvidence = (facts: Pick<CheckFacts, "publicIps" | "kuboRunningAnnounce">, ownAnnounce: string[]): boolean =>
    facts.publicIps.length > 0 || publicIpsFromMultiaddrs(facts.kuboRunningAnnounce ?? [], ownAnnounce).length > 0;

export function noWssAddressCheck(input: {
    announce: string[];
    wsPort: number;
    tcp443: PortState | undefined;
    hasPublicAddress: boolean;
    forcedDomain: boolean;
    otherWssWorks: boolean;
    droppedName: boolean;
}): ReachabilityCheck | undefined {
    const proxyGuidanceApplies = input.tcp443 === "busy" && (input.hasPublicAddress || input.forcedDomain);
    if (input.announce.length > 0 || proxyGuidanceApplies || input.otherWssWorks || input.droppedName) return undefined;
    return { id: "browser-address", status: "warn", detail: "Setup could not give this node a WSS address, so browsers depend on WebTransport", fix: tailscaleFunnelFix(input.wsPort) };
}

export function evaluateChecks(facts: CheckFacts): ReachabilityCheck[] {
    const checks: ReachabilityCheck[] = [];
    const port = facts.httpsPort;

    checks.push(
        facts.publicIps.length > 0
            ? { id: "public-address", status: "ok", detail: `Public addresses: ${facts.publicIps.join(", ")}` }
            : {
                  id: "public-address",
                  status: "warn",
                  detail: "No public address on this machine's interfaces. Setup also asks the router and kubo",
                  fix: "A public IPv4 address, global IPv6, or a router allowing UPnP or manual forwarding is needed"
              }
    );

    const verifiedOnPort = facts.verifiedWss?.find((address) => address.includes(`/tcp/${port}/`));
    if (facts.ourCaddyRunning) checks.push({ id: "tcp-443", status: "ok", detail: `TCP ${port} is served by this node's Caddy` });
    else if (verifiedOnPort)
        checks.push({ id: "tcp-443", status: "ok", detail: facts.tcp443 === "busy" ? `TCP ${port} is held by ${facts.tcp443Holder ?? "another program"}, which serves ${verifiedOnPort}` : `TCP ${port} serves ${verifiedOnPort}` });
    else if (facts.tcp443 === "busy")
        checks.push({
            id: "tcp-443",
            status: "fail",
            detail: `TCP ${port} is held by ${facts.tcp443Holder ?? "another program"}, so this node cannot serve its own certificate`,
            fix: "Free the port, or use --domain with your existing server as a reverse proxy"
        });
    else if (facts.caddyBind === "denied")
        checks.push({ id: "tcp-443", status: "fail", detail: `Caddy has no permission to bind TCP ${port}`, fix: bindFix(facts, facts.caddyPath) });
    else if (facts.caddyBind === "unknown")
        checks.push({ id: "tcp-443", status: "unknown", detail: `TCP ${port} is free, but getcap is not installed so Caddy's permission could not be read` });
    else checks.push({ id: "tcp-443", status: "ok", detail: `TCP ${port} is free and Caddy may bind it` });

    const kuboHoldsUdp = facts.kuboListen?.some((address) => address.includes("/udp/443/quic-v1/webtransport")) === true;
    if (kuboHoldsUdp) checks.push({ id: "udp-443", status: "ok", detail: "kubo is listening for WebTransport on UDP 443" });
    else if ((facts.udp443 === "busy" || facts.kuboBind === "denied") && facts.verifiedWss?.length) checks.push(udpUnavailableBesideWorkingWss(facts));
    else if (facts.udp443 === "busy")
        checks.push({ id: "udp-443", status: "fail", detail: `UDP 443 is held by ${facts.udp443Holder ?? "another program"}, so kubo cannot listen there`, fix: "Stop whatever holds it. Until then WebTransport depends on kubo's other UDP port" });
    else if (facts.kuboBind === "denied")
        checks.push({ id: "udp-443", status: "fail", detail: "kubo has no permission to bind UDP 443. It would start normally and silently not listen", fix: bindFix(facts, facts.kuboPath) });
    else if (facts.kuboBind === "unknown") checks.push({ id: "udp-443", status: "unknown", detail: "getcap is not installed, so kubo's permission to bind UDP 443 could not be read" });
    else if (facts.enabled && facts.daemonRunning) checks.push({ id: "udp-443", status: "fail", detail: "kubo should be listening on UDP 443 but is not", fix: "Check the daemon log, then run: bitsocial reachability enable" });
    else checks.push({ id: "udp-443", status: "ok", detail: "UDP 443 is free and kubo may bind it" });

    if (facts.tcp80 === "busy" && !facts.ourCaddyRunning)
        checks.push({ id: "tcp-80", status: "warn", detail: `TCP ${facts.httpPort ?? 80} is held by ${facts.tcp80Holder ?? "another program"}. Let's Encrypt can still validate over TCP 443, but HTTP validation is unavailable` });
    else if (facts.tcp80 === "no-permission" && facts.caddyBind === "denied") checks.push({ id: "tcp-80", status: "warn", detail: "Caddy has no permission to bind TCP 80, so only TCP 443 validation is available" });
    else checks.push({ id: "tcp-80", status: "ok", detail: "TCP 80 is available for certificate validation" });

    if (facts.firewall?.active) {
        const closed = [!facts.firewall.allowsTcp443 && "TCP 443", !facts.firewall.allowsUdp443 && "UDP 443"].filter(Boolean);
        if (closed.length > 0) {
            const openCommand = facts.firewall.name === "ufw" ? "sudo ufw allow 443" : "sudo firewall-cmd --permanent --add-port=443/tcp --add-port=443/udp && sudo firewall-cmd --reload";
            checks.push({ id: "firewall", status: "warn", detail: `${facts.firewall.name} is active and does not appear to allow ${closed.join(" or ")}`, fix: openCommand });
        } else checks.push({ id: "firewall", status: "ok", detail: `${facts.firewall.name} allows port 443` });
    }

    if (facts.enabled) {
        if (!facts.daemonRunning) checks.push({ id: "daemon", status: "warn", detail: "The daemon is not running, so nothing is being served", fix: "Run: bitsocial daemon" });
        else if (facts.wsPort !== undefined) {
            const listening = facts.kuboListen?.some((address) => address.includes(`/tcp/${facts.wsPort}/ws`)) === true;
            checks.push(
                listening
                    ? { id: "kubo-ws", status: "ok", detail: `kubo is listening on 127.0.0.1:${facts.wsPort} for the terminator` }
                    : { id: "kubo-ws", status: "fail", detail: `kubo is not listening on 127.0.0.1:${facts.wsPort}, so WSS cannot reach it`, fix: "Run: bitsocial reachability enable" }
            );
        }
        const announceCheck = kuboAnnounceCheck(facts);
        if (announceCheck) checks.push(announceCheck);
        for (const certificate of facts.certificates)
            if (certificate.hoursLeft < 24)
                checks.push({ id: "certificate", status: "warn", detail: `The certificate for ${certificate.names.join(", ")} has ${certificate.hoursLeft} hours left`, fix: "Check that TCP 80 or 443 still reaches this machine" });
    }

    checks.push(inboundCheck(facts));
    return checks;
}

const probeUdpHost = (port: number, host: string): Promise<PortState> =>
    new Promise((resolve) => {
        const socket = net.isIPv6(host) ? dgram.createSocket({ type: "udp6", ipv6Only: true }) : dgram.createSocket("udp4");
        socket.once("error", (error: NodeJS.ErrnoException) => {
            socket.close();
            if (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT") return resolve("free");
            resolve(error.code === "EACCES" ? "no-permission" : "busy");
        });
        socket.bind({ port, address: host, exclusive: true }, () => socket.close(() => resolve("free")));
    });

export const probeUdpPort = async (port: number, host?: string): Promise<PortState> => {
    if (host) return probeUdpHost(port, host);
    return worstPortState([await probeUdpHost(port, "0.0.0.0"), await probeUdpHost(port, "::")]);
};

async function readLinuxBindInputs(platform: string) {
    if (platform !== "linux") return { unprivilegedPortStart: undefined, effectiveCapabilities: undefined };
    const unprivileged = await fs.readFile("/proc/sys/net/ipv4/ip_unprivileged_port_start", "utf-8").catch(() => undefined);
    const status = await fs.readFile("/proc/self/status", "utf-8").catch(() => undefined);
    const capabilities = status?.match(/^CapEff:\s*([0-9a-f]+)/m)?.[1];
    return {
        unprivilegedPortStart: unprivileged === undefined ? undefined : Number(unprivileged.trim()),
        effectiveCapabilities: capabilities ? BigInt(`0x${capabilities}`) : undefined
    };
}

const fileCapabilities = async (binaryPath: string): Promise<string | undefined> => {
    try {
        return (await execFileAsync("getcap", [binaryPath])).stdout;
    } catch (error) {
        // A missing binary has no capabilities yet, which is different from not being able to ask.
        return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "";
    }
};

async function readFirewall(platform: string): Promise<FirewallState | undefined> {
    if (platform !== "linux") return undefined;
    try {
        const parsed = parseUfwStatus((await execFileAsync("ufw", ["status"])).stdout);
        if (parsed?.active) return parsed;
    } catch {
        /* not installed, or not root */
    }
    try {
        const [state, ports, services] = await Promise.all([
            execFileAsync("firewall-cmd", ["--state"]),
            execFileAsync("firewall-cmd", ["--list-ports"]),
            execFileAsync("firewall-cmd", ["--list-services"])
        ]);
        return parseFirewalldState(state.stdout, ports.stdout, services.stdout);
    } catch {
        return undefined;
    }
}

const findUdpHolder = async (port: number, platform: string): Promise<string | undefined> => {
    if (platform !== "linux") return undefined;
    try {
        return parseSsHolder((await execFileAsync("ss", ["-lunpH", `sport = :${port}`])).stdout);
    } catch {
        return undefined;
    }
};

const findTcpHolderName = async (port: number): Promise<string | undefined> => {
    if (process.platform === "linux") {
        try {
            return parseSsHolder((await execFileAsync("ss", ["-ltnpH", `sport = :${port}`])).stdout);
        } catch {
            return undefined;
        }
    }
    return findPortHolder(port);
};

export async function gatherCheckFacts(input: {
    dataPath: string;
    kuboPath: string;
    kuboRpcUrl: URL;
    enabled: boolean;
    publicIps?: string[];
    httpsPort?: number;
    httpPort?: number;
    wsPort?: number;
    caddyAdminPort?: number;
    certificates?: CertificateInfo[];
    announce?: string[];
    // Only for `status`: setup warns on everything it gets, and AutoNAT has no answer for a kubo that just started.
    autonat?: boolean;
}): Promise<CheckFacts> {
    const platform = process.platform;
    const httpsPort = input.httpsPort ?? 443;
    const httpPort = input.httpPort ?? 80;
    const caddyPath = caddyBinaryPath(input.dataPath);
    const { unprivilegedPortStart, effectiveCapabilities } = await readLinuxBindInputs(platform);
    const permissionFor = async (binaryPath: string, port: number) =>
        bindPermission({ platform, port, uid: process.getuid?.(), effectiveCapabilities, unprivilegedPortStart, fileCapabilities: await fileCapabilities(binaryPath) });

    const kuboListen = await kuboListenAddresses(input.kuboRpcUrl);
    const kuboConfig = await loadKuboConfigFile(input.dataPath).catch(() => undefined);
    const ourCaddyRunning = input.caddyAdminPort ? await isOurCaddyRunning(input.caddyAdminPort, input.dataPath) : false;
    const autonat = input.autonat ? await kuboAutonat(input.kuboRpcUrl) : undefined;
    const [tcp443, tcp80, udp443] = await Promise.all([probeTcpPort(httpsPort), probeTcpPort(httpPort), probeUdpPort(443)]);
    return {
        platform,
        inContainer: await detectContainer(),
        enabled: input.enabled,
        daemonRunning: kuboListen !== undefined,
        publicIps: input.publicIps ?? publicIpsFromInterfaces(),
        httpsPort,
        httpPort,
        wsPort: input.wsPort,
        caddyPath,
        kuboPath: input.kuboPath,
        ourCaddyRunning,
        tcp443,
        tcp443Holder: tcp443 === "busy" ? await findTcpHolderName(httpsPort) : undefined,
        tcp80,
        tcp80Holder: tcp80 === "busy" ? await findTcpHolderName(httpPort) : undefined,
        udp443,
        udp443Holder: udp443 === "busy" ? await findUdpHolder(443, platform) : undefined,
        caddyBind: await permissionFor(caddyPath, httpsPort),
        kuboBind: await permissionFor(input.kuboPath, 443),
        kuboListen,
        announce: input.announce ?? [],
        kuboConfigAnnounce: kuboConfig ? [...(kuboConfig.Addresses?.Announce ?? []), ...(kuboConfig.Addresses?.AppendAnnounce ?? [])] : undefined,
        kuboRunningAnnounce: (await kuboIdentity(input.kuboRpcUrl))?.addresses,
        firewall: await readFirewall(platform),
        certificates: input.certificates ?? [],
        ...(autonat ? { kuboAutonat: autonat } : {})
    };
}

export const formatCheck = (check: ReachabilityCheck) => {
    const mark: Record<CheckStatus, string> = { ok: "ok", warn: "warning", fail: "problem", unknown: "unknown" };
    return `  [${mark[check.status]}] ${check.detail}${check.fix ? `${os.EOL}      Fix: ${check.fix}` : ""}`;
};

