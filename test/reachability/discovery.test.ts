import { describe, expect, it } from "vitest";
import {
    classifyPortHolder,
    detectContainer,
    isCgnatIp,
    isPublicIp,
    lanIpv4FromInterfaces,
    parseLsofHolder,
    parseNetstatPid,
    parseSsHolder,
    publicIpsFromInterfaces,
    publicIpsFromMultiaddrs
} from "../../src/reachability/discovery.js";

const iface = (address: string, internal = false) => ({ address, internal, family: address.includes(":") ? "IPv6" : "IPv4" }) as any;

describe("isPublicIp", () => {
    it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("%s is public", (ip) => expect(isPublicIp(ip)).toBe(true));
    it.each([
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.1.1",
        "100.64.0.1",
        "203.0.113.7",
        "::1",
        "fe80::1",
        "fc00::1",
        "2001:db8::1",
        "not an ip"
    ])("%s is not public", (ip) => expect(isPublicIp(ip)).toBe(false));
});

it("isCgnatIp recognises only 100.64.0.0/10", () => {
    expect(isCgnatIp("100.64.0.1")).toBe(true);
    expect(isCgnatIp("100.127.255.255")).toBe(true);
    expect(isCgnatIp("100.128.0.1")).toBe(false);
    expect(isCgnatIp("2606:4700::1")).toBe(false);
});

describe("interface discovery", () => {
    const interfaces = { lo: [iface("127.0.0.1", true)], eth0: [iface("192.168.1.5"), iface("93.184.216.34"), iface("2606:4700::1"), iface("fe80::1")] };

    it("finds only public addresses", () => {
        expect(publicIpsFromInterfaces(interfaces)).toEqual(["93.184.216.34", "2606:4700::1"]);
    });

    it("finds the LAN address to map the router to", () => {
        expect(lanIpv4FromInterfaces(interfaces)).toBe("192.168.1.5");
    });
});

it("publicIpsFromMultiaddrs keeps public IPs, skips private, dns and garbage", () => {
    expect(
        publicIpsFromMultiaddrs([
            "/ip4/93.184.216.34/tcp/4001/p2p/12D3KooWHFrmLWTTDD4NodngtRMEVYgxrLDNS3uwHkpTKm5PkvY7",
            "/ip4/93.184.216.34/udp/4001/quic-v1",
            "/ip4/192.168.1.5/tcp/4001",
            "/dns4/node.example/tcp/443/tls/ws",
            "/ip6/2606:4700::1/tcp/4001",
            "garbage"
        ])
    ).toEqual(["93.184.216.34", "2606:4700::1"]);
});

it("publicIpsFromMultiaddrs does not let our own announced address confirm itself", () => {
    const own = "/ip4/93.184.216.34/tcp/443/tls/ws";
    const peer = "12D3KooWHFrmLWTTDD4NodngtRMEVYgxrLDNS3uwHkpTKm5PkvY7";
    expect(publicIpsFromMultiaddrs([`${own}/p2p/${peer}`], [own])).toEqual([]);
    expect(publicIpsFromMultiaddrs([`${own}/p2p/${peer}`, `/ip4/93.184.216.34/tcp/4001/p2p/${peer}`], [own])).toEqual(["93.184.216.34"]);
    expect(publicIpsFromMultiaddrs([`/ip4/93.184.216.35/tcp/4001/p2p/${peer}`, `${own}/p2p/${peer}`], [own])).toEqual(["93.184.216.35"]);
});

describe("port holder parsing", () => {
    it("reads ss output", () => {
        expect(parseSsHolder('LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=1,fd=6))')).toBe("nginx");
        expect(parseSsHolder("LISTEN 0 511 0.0.0.0:443 0.0.0.0:*")).toBeUndefined();
    });

    it("reads lsof -Fc output", () => {
        expect(parseLsofHolder("p123\ncnginx\nf6\n")).toBe("nginx");
    });

    it("reads the listening pid from netstat", () => {
        const output = "  TCP    0.0.0.0:80     0.0.0.0:0   LISTENING  100\r\n  TCP    0.0.0.0:443    0.0.0.0:0   LISTENING  4\r\n  TCP    1.2.3.4:443    5.6.7.8:9   ESTABLISHED  7\r\n";
        expect(parseNetstatPid(output, 443)).toBe("4");
        expect(parseNetstatPid(output, 8443)).toBeUndefined();
    });

    it.each([
        ["nginx", "nginx"],
        ["nginx: worker", "nginx"],
        ["apache2", "apache"],
        ["httpd.exe", "apache"],
        ["caddy", "caddy"],
        ["System", "iis"],
        ["w3wp.exe", "iis"],
        ["node", "other"]
    ])("classifies %s as %s", (name, holder) => expect(classifyPortHolder(name)).toBe(holder));

    it("stays unknown without a name", () => expect(classifyPortHolder(undefined)).toBeUndefined());
});

describe.runIf(process.platform === "linux")("detectContainer", () => {
    const reader = (files: Record<string, string>) => async (path: string) => {
        if (path in files) return files[path]!;
        throw new Error("ENOENT");
    };
    it("sees /.dockerenv", async () => expect(await detectContainer(reader({ "/.dockerenv": "" }))).toBe(true));
    it("sees a container cgroup", async () => expect(await detectContainer(reader({ "/proc/self/cgroup": "0::/docker/abc" }))).toBe(true));
    it("sees a normal host", async () => expect(await detectContainer(reader({ "/proc/self/cgroup": "0::/user.slice/session.scope" }))).toBe(false));
});
