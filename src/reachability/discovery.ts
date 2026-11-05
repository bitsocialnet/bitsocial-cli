import { execFile } from "child_process";
import { promises as fs } from "fs";
import net from "net";
import os from "os";
import { promisify } from "util";
import { multiaddr } from "@multiformats/multiaddr";
import { toConnectableHostname } from "../util.js";

const execFileAsync = promisify(execFile);

const NON_PUBLIC_V4 = new net.BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
] as const)
    NON_PUBLIC_V4.addSubnet(address, prefix, "ipv4");

const GLOBAL_V6 = new net.BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
const DOCUMENTATION_V6 = new net.BlockList();
DOCUMENTATION_V6.addSubnet("2001:db8::", 32, "ipv6");

export function isPublicIp(ip: string): boolean {
    if (net.isIPv4(ip)) return !NON_PUBLIC_V4.check(ip, "ipv4");
    if (net.isIPv6(ip)) return GLOBAL_V6.check(ip, "ipv6") && !DOCUMENTATION_V6.check(ip, "ipv6");
    return false;
}

export function isCgnatIp(ip: string): boolean {
    if (!net.isIPv4(ip)) return false;
    const blockList = new net.BlockList();
    blockList.addSubnet("100.64.0.0", 10, "ipv4");
    return blockList.check(ip, "ipv4");
}

export function publicIpsFromInterfaces(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
    const addresses = Object.values(interfaces).flatMap((infos) => infos ?? []);
    return [...new Set(addresses.filter((info) => !info.internal && isPublicIp(info.address)).map((info) => info.address))];
}

export function localIpsFromInterfaces(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
    return Object.values(interfaces)
        .flatMap((infos) => infos ?? [])
        .map((info) => info.address);
}

export function lanIpv4FromInterfaces(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string | undefined {
    return Object.values(interfaces)
        .flatMap((infos) => infos ?? [])
        .find((info) => !info.internal && info.family === "IPv4" && !isPublicIp(info.address))?.address;
}

// kubo's view of how others reach it; the IPs from its addresses that are public. kubo's address list also
// echoes what we told it to announce, so pass that as ownAnnounce or an old IP would confirm itself forever.
export function publicIpsFromMultiaddrs(addresses: string[], ownAnnounce: string[] = []): string[] {
    const ips = new Set<string>();
    for (const address of addresses) {
        if (ownAnnounce.includes(address.replace(/\/p2p\/[^/]+$/, ""))) continue;
        try {
            const host = multiaddr(address)
                .getComponents()
                .find((component) => component.name === "ip4" || component.name === "ip6")?.value;
            if (host && isPublicIp(host)) ips.add(host);
        } catch {
            continue;
        }
    }
    return [...ips];
}

export async function detectContainer(readFile: (path: string) => Promise<string> = (path) => fs.readFile(path, "utf-8")): Promise<boolean> {
    if (process.platform !== "linux") return false;
    try {
        await readFile("/.dockerenv");
        return true;
    } catch {
        /* not Docker, or not visible */
    }
    try {
        return /docker|containerd|kubepods|podman|libpod|lxc/.test(await readFile("/proc/self/cgroup"));
    } catch {
        return false;
    }
}

export type PortState = "free" | "busy" | "no-permission";

const probeTcpHost = (port: number, host: string): Promise<PortState> =>
    new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (error: NodeJS.ErrnoException) => {
            // A machine without IPv6 cannot be holding the port on it.
            if (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT") return resolve("free");
            resolve(error.code === "EACCES" ? "no-permission" : "busy");
        });
        server.listen({ port, host, exclusive: true }, () => server.close(() => resolve("free")));
    });

const acceptsConnections = (port: number, host: string): Promise<boolean> =>
    new Promise((resolve) => {
        const socket = net.connect({ port, host, timeout: 1000 });
        const finish = (result: boolean) => {
            socket.destroy();
            resolve(result);
        };
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });

export const worstPortState = (states: PortState[]): PortState => (states.includes("busy") ? "busy" : states.includes("no-permission") ? "no-permission" : "free");

// A successful bind proves nothing alone: Windows allows one on a wildcard address while another program
// listens on it. Something accepting on loopback is held, whatever the OS's bind rules are.
export const probeTcpPort = async (port: number, host?: string): Promise<PortState> => {
    const hosts = host ? [host] : ["0.0.0.0", "::"];
    const states: PortState[] = [];
    for (const candidate of hosts) states.push(await probeTcpHost(port, candidate));
    const loopbacks = host ? [toConnectableHostname(host)] : ["127.0.0.1", "::1"];
    for (const loopback of loopbacks) if (await acceptsConnections(port, loopback)) states.push("busy");
    return worstPortState(states);
};

export const isTcpPortFree = async (port: number, host: string) => (await probeTcpPort(port, host)) === "free";

export type PortHolder = "nginx" | "apache" | "caddy" | "iis" | "other";

export function classifyPortHolder(processName: string | undefined): PortHolder | undefined {
    if (!processName) return undefined;
    const name = processName.toLowerCase();
    if (name.includes("nginx")) return "nginx";
    if (name.includes("apache") || name.includes("httpd")) return "apache";
    if (name.includes("caddy")) return "caddy";
    if (name === "system" || name.includes("w3wp") || name.includes("http.sys")) return "iis";
    return "other";
}

export const parseSsHolder = (output: string) => output.match(/users:\(\("([^"]+)"/)?.[1];
export const parseLsofHolder = (output: string) => output.split("\n").find((line) => line.startsWith("c"))?.slice(1);
export function parseNetstatPid(output: string, port: number): string | undefined {
    for (const line of output.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        if (columns[0] === "TCP" && columns[1]?.endsWith(`:${port}`) && columns[3] === "LISTENING") return columns[4];
    }
    return undefined;
}

// Best effort: naming the server only makes the printed snippet more useful, so every failure,
// including lacking permission to see other users' processes, just means "unknown".
export async function findPortHolder(port: number, platform: string = process.platform): Promise<PortHolder | undefined> {
    try {
        if (platform === "linux") return classifyPortHolder(parseSsHolder((await execFileAsync("ss", ["-ltnpH", `sport = :${port}`])).stdout));
        if (platform === "darwin") return classifyPortHolder(parseLsofHolder((await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fc"])).stdout));
        if (platform === "win32") {
            const pid = parseNetstatPid((await execFileAsync("netstat", ["-ano", "-p", "TCP"])).stdout, port);
            if (!pid) return undefined;
            if (pid === "4") return "iis"; // the System process, which is how HTTP.sys appears
            const { stdout } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
            return classifyPortHolder(stdout.match(/^"([^"]+)"/)?.[1]);
        }
    } catch {
        /* unknown */
    }
    return undefined;
}

const kuboPost = (kuboRpcUrl: URL, route: string) => {
    const url = new URL(kuboRpcUrl.toString());
    url.hostname = toConnectableHostname(url.hostname).includes(":") ? `[${toConnectableHostname(url.hostname)}]` : toConnectableHostname(url.hostname);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${route}`;
    return fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) });
};

export async function kuboIdentity(kuboRpcUrl: URL): Promise<{ peerId: string; addresses: string[] } | undefined> {
    try {
        const response = await kuboPost(kuboRpcUrl, "id");
        if (!response.ok) return undefined;
        const body = (await response.json()) as { ID: string; Addresses: string[] | null };
        return { peerId: body.ID, addresses: body.Addresses ?? [] };
    } catch {
        return undefined;
    }
}

// kubo reports its announced addresses with /p2p/<peer id> on the end.
export const addressesNotAnnounced = (expected: string[], announced: string[]): string[] =>
    expected.filter((address) => !announced.some((entry) => entry === address || entry.startsWith(`${address}/p2p/`)));

// AutoNAT v2's verdict on each address, from servers on other networks. It tests kubo's own listeners, AutoTLS included, and did not list a /tls/ws address that was only announced, as one behind a reverse proxy is.
export interface KuboAutonat {
    reachable: string[];
    unreachable: string[];
    unknown: string[];
}

export async function kuboAutonat(kuboRpcUrl: URL): Promise<KuboAutonat | undefined> {
    try {
        const response = await kuboPost(kuboRpcUrl, "swarm/addrs/autonat");
        if (!response.ok) return undefined;
        const body = (await response.json()) as { reachable?: string[] | null; unreachable?: string[] | null; unknown?: string[] | null };
        return { reachable: body.reachable ?? [], unreachable: body.unreachable ?? [], unknown: body.unknown ?? [] };
    } catch {
        return undefined;
    }
}

export async function kuboListenAddresses(kuboRpcUrl: URL): Promise<string[] | undefined> {
    try {
        const response = await kuboPost(kuboRpcUrl, "swarm/addrs/listen");
        if (!response.ok) return undefined;
        return ((await response.json()) as { Strings: string[] | null }).Strings ?? [];
    } catch {
        return undefined;
    }
}

export async function shutdownKubo(kuboRpcUrl: URL): Promise<void> {
    try {
        await kuboPost(kuboRpcUrl, "shutdown");
    } catch {
        /* the connection dropping is what a successful shutdown can look like */
    }
}
