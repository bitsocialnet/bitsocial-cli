import fs from "fs/promises";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { directory as randomDirectory } from "tempy";
import { describe, expect, it } from "vitest";
import { caddyfilePath, generateCaddyfile, LETS_ENCRYPT_DIRECTORY, LETS_ENCRYPT_STAGING_DIRECTORY } from "../../src/reachability/caddy.js";
import { ReachabilityRuntime } from "../../src/reachability/runtime.js";
import { caddyDataDir, readReachabilityConfig, reachabilityDir, type ReachabilityConfig } from "../../src/reachability/state.js";
import { bindDeniedGuidance, busyPortMessage, dnsMismatchMessage, existingServerGuidance, noWssStatement, reverseProxySnippet, testCommandHint, unreachableStatement, webTransportNotListeningGuidance } from "../../src/reachability/guidance.js";
import {
    assertAcmeDirectoryAllowed,
    applyKuboConfig,
    assertAnnounceShape,
    chooseAcmeDirectory,
    deriveMode,
    discoverPublicIps,
    domainAnnounceAddress,
    domainPointsHere,
    existingLoopbackWsPort,
    runReachabilitySetup,
    SetupRefusedError,
    type SetupDependencies,
    type SetupOptions
} from "../../src/reachability/setup.js";

describe("ACME directory", () => {
    it("is production by default and staging on request", () => {
        expect(chooseAcmeDirectory({ staging: false })).toBe(LETS_ENCRYPT_DIRECTORY);
        expect(chooseAcmeDirectory({ staging: true })).toBe(LETS_ENCRYPT_STAGING_DIRECTORY);
    });

    it("refuses production Let's Encrypt from CI", () => {
        expect(() => assertAcmeDirectoryAllowed(LETS_ENCRYPT_DIRECTORY, true)).toThrow(/from CI/);
    });

    it("allows staging and Pebble from CI, and production elsewhere", () => {
        expect(() => assertAcmeDirectoryAllowed(LETS_ENCRYPT_STAGING_DIRECTORY, true)).not.toThrow();
        expect(() => assertAcmeDirectoryAllowed("https://127.0.0.1:1/dir", true)).not.toThrow();
        expect(() => assertAcmeDirectoryAllowed(LETS_ENCRYPT_DIRECTORY, false)).not.toThrow();
    });
});

it.each([
    [{ ip: true, domain: true, proxy: false }, "ip+domain"],
    [{ ip: true, domain: false, proxy: true }, "ip+reverse-proxy"],
    [{ ip: false, domain: true, proxy: true }, "domain+reverse-proxy"],
    [{ ip: true, domain: true, proxy: true }, "ip+domain+reverse-proxy"],
    [{ ip: true, domain: false, proxy: false }, "ip"],
    [{ ip: false, domain: true, proxy: false }, "domain"],
    [{ ip: false, domain: false, proxy: true }, "reverse-proxy"],
    [{ ip: false, domain: false, proxy: false }, "webtransport-only"]
] as const)("deriveMode(%j) is %s", (parts, mode) => expect(deriveMode(parts)).toBe(mode));

describe("per-OS guidance", () => {
    it("never suggests sudo inside a container", () => {
        const text = bindDeniedGuidance({ inContainer: true, caddyPath: "/x/caddy", platform: "linux" });
        expect(text).toContain("NET_BIND_SERVICE");
        expect(text).not.toContain("sudo");
    });

    it("offers setcap and the sysctl on a Linux host", () => {
        const text = bindDeniedGuidance({ inContainer: false, caddyPath: "/x/caddy", platform: "linux" });
        expect(text).toContain('setcap cap_net_bind_service=+ep "/x/caddy"');
        expect(text).toContain("net.ipv4.ip_unprivileged_port_start");
    });

    it("tells a Linux operator that kubo needs the permission too", () => {
        const text = webTransportNotListeningGuidance({ inContainer: false, kuboPath: "/x/ipfs", platform: "linux" });
        expect(text).toContain('setcap cap_net_bind_service=+ep "/x/ipfs"');
        expect(text).toContain("net.ipv4.ip_unprivileged_port_start");
    });

    it("prints a test command with the right URL for each address family and port", () => {
        expect(testCommandHint("93.184.216.34", 443)).toContain("https://93.184.216.34/");
        expect(testCommandHint("2606:4700::1", 443)).toContain("https://[2606:4700::1]/");
        expect(testCommandHint("127.0.0.1", 8443)).toContain("https://127.0.0.1:8443/");
    });

    it("names HTTP.sys holding 443", () => expect(busyPortMessage("iis")).toContain("HTTP.sys"));

    it("states what would change an unreachable node", () => {
        expect(unreachableStatement("behind CGNAT")).toMatch(/Neither WSS nor WebTransport.*behind CGNAT/);
    });
});

describe("discoverPublicIps", () => {
    const options = { kuboRpcUrl: new URL("http://127.0.0.1:1/api/v0"), dataPath: "", kuboRepoPath: "", staging: false, nonInteractive: true } as SetupOptions;
    const deps = (overrides: Partial<SetupDependencies>) =>
        ({ log: () => {}, warn: () => {}, publicIpsFromInterfaces: () => [], lanIpv4: () => "192.168.1.5", discoverRouter: async () => undefined, ...overrides }) as SetupDependencies;
    const router = (externalIp: string, refused: string[] = []) => ({
        externalIp: async () => externalIp,
        mapPorts: async () => ({ mapped: ["TCP 443"], refused }),
        release: async () => {}
    });

    it("skips the router when an interface already holds a public IPv4", async () => {
        let asked = false;
        const result = await discoverPublicIps(options, deps({ publicIpsFromInterfaces: () => ["93.184.216.34"], discoverRouter: async () => ((asked = true), undefined) }));
        expect(result.publicIps).toEqual(["93.184.216.34"]);
        expect(asked).toBe(false);
    });

    it("uses the router's external IP behind NAT", async () => {
        const result = await discoverPublicIps(options, deps({ discoverRouter: async () => router("93.184.216.34") }));
        expect(result.publicIps).toEqual(["93.184.216.34"]);
    });

    it("recognises CGNAT and does not treat it as public", async () => {
        const result = await discoverPublicIps(options, deps({ discoverRouter: async () => router("100.64.1.1") }));
        expect(result).toMatchObject({ publicIps: [], sawCgnat: true });
    });

    it("reports ports the router refused", async () => {
        const result = await discoverPublicIps(options, deps({ discoverRouter: async () => router("93.184.216.34", ["TCP 80"]) }));
        expect(result.refused).toEqual(["TCP 80"]);
    });

    it("still checks the router for IPv4 on an IPv6-only interface", async () => {
        const result = await discoverPublicIps(options, deps({ publicIpsFromInterfaces: () => ["2606:4700::1"], discoverRouter: async () => router("93.184.216.34") }));
        expect(result.publicIps.sort()).toEqual(["2606:4700::1", "93.184.216.34"]);
    });

    it("finds nothing with no public IP and no router", async () => {
        expect((await discoverPublicIps(options, deps({}))).publicIps).toEqual([]);
    });
});

describe("Path B checks", () => {
    it("matches a domain on any of its records", () => {
        expect(domainPointsHere({ v4: ["93.184.216.34"], v6: [] }, ["93.184.216.34"])).toBe(true);
        expect(domainPointsHere({ v4: ["1.1.1.1"], v6: ["2606:4700:0:0::1"] }, ["2606:4700::1"])).toBe(true);
    });

    it("does not match another address or an empty result", () => {
        expect(domainPointsHere({ v4: ["1.1.1.1"], v6: [] }, ["93.184.216.34"])).toBe(false);
        expect(domainPointsHere({ v4: [], v6: [] }, ["93.184.216.34"])).toBe(false);
    });

    it("shows both sides of a mismatch and names --force", () => {
        const message = dnsMismatchMessage("node.example", ["1.1.1.1"], ["93.184.216.34"]);
        expect(message).toContain("1.1.1.1");
        expect(message).toContain("93.184.216.34");
        expect(message).toContain("--force");
    });

    it("announces dns4 unless the name has only AAAA records", () => {
        expect(domainAnnounceAddress("node.example", 443, { v4: ["1.1.1.1"], v6: ["2606:4700::1"] })).toBe("/dns4/node.example/tcp/443/tls/ws");
        expect(domainAnnounceAddress("node.example", 443, { v4: [], v6: ["2606:4700::1"] })).toBe("/dns6/node.example/tcp/443/tls/ws");
        expect(domainAnnounceAddress("node.example", 443, { v4: [], v6: [] })).toBe("/dns4/node.example/tcp/443/tls/ws");
    });

    it.each(["/dns4/node.example/tcp/443/tls/ws", "/ip4/93.184.216.34/tcp/443/wss"])("accepts %s for --announce", (address) => {
        expect(() => assertAnnounceShape(address)).not.toThrow();
    });

    it.each(["/ip4/93.184.216.34/tcp/4001", "/dns4/node.example/tcp/80/ws", "/ip4/93.184.216.34/udp/443/quic-v1/webtransport"])("rejects %s for --announce", (address) => {
        expect(() => assertAnnounceShape(address)).toThrow(/--announce/);
    });
});

describe("reverseProxySnippet", () => {
    it.each([
        ["nginx", "proxy_pass http://127.0.0.1:4002;"],
        ["apache", "ws://127.0.0.1:4002/"],
        ["caddy", "reverse_proxy 127.0.0.1:4002"]
    ] as const)("%s forwards to kubo's loopback ws port", (holder, expected) => {
        const snippet = reverseProxySnippet(holder, "node.example", 4002);
        expect(snippet).toContain(expected);
        expect(snippet).toContain("node.example");
        expect(snippet).toContain("--announce /dns4/node.example/tcp/443/tls/ws");
    });

    it("gives nginx as the example for an unknown server", () => {
        expect(reverseProxySnippet(undefined, "node.example", 4002)).toContain("For example, in nginx");
    });

    it("carries the upgrade headers nginx does not forward by default", () => {
        expect(reverseProxySnippet("nginx", "node.example", 4002)).toContain("proxy_set_header Upgrade $http_upgrade");
    });
});

describe("existingServerGuidance", () => {
    it("gives an existing Caddy a site block for the IP, with the shortlived profile", () => {
        const text = existingServerGuidance("caddy", "93.184.216.34", 4002);
        expect(text).toContain("https://93.184.216.34 {");
        expect(text).toContain("profile shortlived");
        expect(text).toContain("reverse_proxy 127.0.0.1:4002");
        expect(text).toContain("--announce /ip4/93.184.216.34/tcp/443/tls/ws");
    });

    it("warns that the operator's Caddy must stay off UDP 443", () => {
        expect(existingServerGuidance("caddy", "93.184.216.34", 4002)).toContain("protocols h1 h2");
    });

    it("brackets IPv6, in both the site and the multiaddr form", () => {
        const text = existingServerGuidance("caddy", "2606:4700::1", 4002);
        expect(text).toContain("https://[2606:4700::1] {");
        expect(text).toContain("--announce /ip6/2606:4700::1/tcp/443/tls/ws");
    });

    it("gives both routes when the server could not be identified", () => {
        const text = existingServerGuidance(undefined, "93.184.216.34", 4002);
        expect(text).toContain("profile shortlived");
        expect(text).toContain("--domain");
    });

    it.each(["nginx", "apache", "other"] as const)("sends %s to --domain, which cannot get an IP certificate alone", (holder) => {
        const text = existingServerGuidance(holder, "93.184.216.34", 4002);
        expect(text).toContain("--domain");
        expect(text).not.toContain("profile shortlived");
    });

    it("never tells the operator we will change their server", () => {
        expect(existingServerGuidance("caddy", "93.184.216.34", 4002)).toContain("will not change");
    });
});

it("noWssStatement says WebTransport is configured, not that nothing can reach this machine", () => {
    const text = noWssStatement("TCP 443 is in use");
    expect(text).toContain("TCP 443 is in use");
    expect(text).toContain("WebTransport");
    expect(text).not.toContain("Neither");
});

describe("existingLoopbackWsPort", () => {
    it("reuses a loopback ws listener already in the kubo config", () => {
        expect(existingLoopbackWsPort({ Addresses: { Swarm: ["/ip4/0.0.0.0/tcp/4001", "/ip4/127.0.0.1/tcp/4002/ws"] } })).toBe(4002);
    });

    it.each([
        ["no config", undefined],
        ["no listener", { Addresses: { Swarm: ["/ip4/0.0.0.0/tcp/4001"] } }],
        ["a public ws listener", { Addresses: { Swarm: ["/ip4/0.0.0.0/tcp/4002/ws"] } }],
        ["a secure one", { Addresses: { Swarm: ["/ip4/127.0.0.1/tcp/4002/tls/ws"] } }]
    ])("finds nothing with %s", (_label, config) => {
        expect(existingLoopbackWsPort(config)).toBeUndefined();
    });
});

describe("a setup run that cannot issue any certificate", () => {
    const HELD_IP = "93.184.216.34";
    const NEW_IP = "93.184.216.35";
    const HELD_ADDRESS = `/ip4/${HELD_IP}/tcp/443/tls/ws`;
    const CADDYFILE = `{\n}\n\nhttps://${HELD_IP} {\n}\n`;
    const servingNode = (overrides: Partial<ReachabilityConfig> = {}): ReachabilityConfig => ({
        version: 1,
        enabled: true,
        mode: "ip",
        wsPort: 4002,
        announce: [HELD_ADDRESS],
        publicIps: [HELD_IP],
        staging: false,
        acmeDirectory: LETS_ENCRYPT_DIRECTORY,
        caddyAdminPort: 2019,
        ...overrides
    });

    const prepare = async (previous?: ReachabilityConfig) => {
        const dataPath = randomDirectory();
        const kuboRepoPath = path.join(dataPath, "repo");
        await fs.mkdir(kuboRepoPath, { recursive: true });
        await fs.mkdir(reachabilityDir(dataPath), { recursive: true });
        await fs.writeFile(path.join(kuboRepoPath, "config"), JSON.stringify({ Addresses: { Swarm: [], AppendAnnounce: [] }, Swarm: {} }));
        if (previous) {
            await applyKuboConfig(previous, { dataPath, kuboRepoPath }, previous.enabled);
            await fs.writeFile(caddyfilePath(dataPath), CADDYFILE);
        }
        const warnings: string[] = [];
        const dialed: string[] = [];
        const options = (overrides: Partial<SetupOptions> = {}): SetupOptions => ({
            dataPath,
            kuboRepoPath,
            kuboRpcUrl: new URL("http://127.0.0.1:1/api/v0"),
            staging: false,
            nonInteractive: true,
            overrides: { publicIps: [NEW_IP] },
            ...overrides
        });
        const deps: SetupDependencies = {
            log: () => {},
            warn: (message) => warnings.push(message),
            platform: process.platform,
            inContainer: false,
            isCi: false,
            kuboBinaryPath: "",
            discoverRouter: async () => undefined,
            probePort: async () => "free",
            findHolder: async () => undefined,
            publicIpsFromInterfaces: () => [],
            lanIpv4: () => undefined,
            // A Caddy that cannot run, which is a real failure on every OS.
            ensureCaddy: async () => path.join(dataPath, "no-such-caddy"),
            resolveDomain: async () => ({ v4: [], v6: [] }),
            dial: async (address) => (dialed.push(address), { peerId: "peer" })
        };
        const snapshot = async () => ({
            config: await readReachabilityConfig(dataPath),
            caddyfile: await fs.readFile(caddyfilePath(dataPath), "utf-8"),
            kubo: await fs.readFile(path.join(kuboRepoPath, "config"), "utf-8")
        });
        return { options, deps, warnings, dialed, snapshot };
    };

    it("leaves a node serving WSS as it was when its address moved", async () => {
        const { options, deps, warnings, snapshot } = await prepare(servingNode());
        const before = await snapshot();
        const result = await runReachabilitySetup(options(), deps);
        expect(await snapshot()).toEqual(before);
        expect(result).toMatchObject({ publicIps: [HELD_IP], announce: [HELD_ADDRESS] });
        expect(warnings.some((warning) => warning.includes("No certificate could be issued") && warning.includes(HELD_ADDRESS))).toBe(true);
    });

    it("stays on the old CA when moving to another one fails", async () => {
        const { options, deps, snapshot } = await prepare(servingNode({ acmeDirectory: LETS_ENCRYPT_STAGING_DIRECTORY, staging: true }));
        const before = await snapshot();
        await runReachabilitySetup(options({ overrides: { publicIps: [HELD_IP] } }), deps);
        expect(await snapshot()).toEqual(before);
    });

    it("refuses --announce rather than dropping the addresses it holds, and changes nothing", async () => {
        const server = http.createServer((_request, response) => response.end(JSON.stringify({ ID: "peer", Addresses: [] })));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const { options, deps, dialed, snapshot } = await prepare(servingNode());
            const before = await snapshot();
            const kuboRpcUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v0`);
            await expect(runReachabilitySetup(options({ kuboRpcUrl, announce: "/dns4/proxy.example/tcp/443/tls/ws" }), deps)).rejects.toBeInstanceOf(SetupRefusedError);
            expect(dialed).toEqual([]);
            expect(await snapshot()).toEqual(before);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    describe("because discovery found no public address", () => {
        const NOTHING_FOUND = { overrides: { publicIps: [] } };

        // A router not answering says nothing about the address, and with no stored IPs the daemon would stop
        // looking at IPs, so this would otherwise end WSS until someone reran setup.
        it("leaves a node serving WSS as it was", async () => {
            const { options, deps, warnings, snapshot } = await prepare(servingNode());
            const before = await snapshot();
            const result = await runReachabilitySetup(options(NOTHING_FOUND), deps);
            expect(await snapshot()).toEqual(before);
            expect(result).toMatchObject({ publicIps: [HELD_IP], announce: [HELD_ADDRESS] });
            expect(warnings.some((warning) => warning.includes("No public address") && warning.includes(HELD_ADDRESS))).toBe(true);
        });

        it("does not read a domain-only node's name as stale, with nothing to compare it to", async () => {
            const domainAddress = "/dns4/node.example/tcp/443/tls/ws";
            const { options, deps, snapshot } = await prepare(servingNode({ mode: "domain", publicIps: [], announce: [domainAddress], domain: "node.example" }));
            const before = await snapshot();
            await runReachabilitySetup(options(NOTHING_FOUND), { ...deps, resolveDomain: async () => ({ v4: [HELD_IP], v6: [] }) });
            expect(await snapshot()).toEqual(before);
        });

        it("refuses --announce rather than dropping the addresses it holds, and changes nothing", async () => {
            const server = http.createServer((_request, response) => response.end(JSON.stringify({ ID: "peer", Addresses: [] })));
            await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
            try {
                const { options, deps, dialed, snapshot } = await prepare(servingNode());
                const before = await snapshot();
                const kuboRpcUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v0`);
                await expect(runReachabilitySetup(options({ ...NOTHING_FOUND, kuboRpcUrl, announce: "/dns4/proxy.example/tcp/443/tls/ws" }), deps)).rejects.toBeInstanceOf(SetupRefusedError);
                expect(dialed).toEqual([]);
                expect(await snapshot()).toEqual(before);
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        });

        it("keeps a proxy-only node's addresses, which never depended on discovery", async () => {
            const proxied = "/dns4/proxy.example/tcp/443/tls/ws";
            const { options, deps } = await prepare(servingNode({ mode: "reverse-proxy", publicIps: [], announce: [proxied], externalAnnounce: [proxied] }));
            expect(await runReachabilitySetup(options(NOTHING_FOUND), deps)).toMatchObject({ mode: "reverse-proxy", announce: [proxied] });
        });

        it("still records the attempt on a first run", async () => {
            const { options, deps } = await prepare();
            expect(await runReachabilitySetup(options(NOTHING_FOUND), deps)).toMatchObject({ enabled: true, serveWss: false, publicIps: [], announce: [] });
        });

        it("still replaces a disabled node", async () => {
            const { options, deps } = await prepare(servingNode({ enabled: false }));
            expect(await runReachabilitySetup(options(NOTHING_FOUND), deps)).toMatchObject({ enabled: true, publicIps: [], announce: [] });
        });
    });

    it("still records the attempt on a first run, when there is nothing to keep", async () => {
        const { options, deps } = await prepare();
        expect(await runReachabilitySetup(options(), deps)).toMatchObject({ enabled: true, serveWss: false, publicIps: [], announce: [] });
    });

    it("still replaces a node that was disabled, which has nothing being served to protect", async () => {
        const { options, deps } = await prepare(servingNode({ enabled: false }));
        expect(await runReachabilitySetup(options(), deps)).toMatchObject({ enabled: true, publicIps: [], announce: [] });
    });
});

describe("a stored domain whose DNS no longer points here", () => {
    const IP = "203.0.113.7";
    const IP_ADDRESS = `/ip4/${IP}/tcp/443/tls/ws`;
    const DOMAIN = "node.example";
    const DOMAIN_ADDRESS = `/dns4/${DOMAIN}/tcp/443/tls/ws`;
    const ELSEWHERE = { v4: ["198.51.100.9"], v6: [] };
    const HERE = { v4: [IP], v6: [] };

    const node = (overrides: Partial<ReachabilityConfig>): ReachabilityConfig => ({
        version: 1,
        enabled: true,
        mode: "ip",
        wsPort: 4002,
        announce: [IP_ADDRESS],
        publicIps: [IP],
        domain: DOMAIN,
        staging: false,
        acmeDirectory: LETS_ENCRYPT_DIRECTORY,
        caddyAdminPort: 2019,
        ...overrides
    });

    // A running Caddy as setup sees it, through its admin API. Together with a certificate already on disk this
    // lets setup succeed on every OS without a real Caddy or CA. Real Caddy is covered by the integration test.
    const prepare = async (previous: ReachabilityConfig, { caddyUp = true, certificate = true } = {}) => {
        const dataPath = randomDirectory();
        const kuboRepoPath = path.join(dataPath, "repo");
        await fs.mkdir(kuboRepoPath, { recursive: true });
        await fs.mkdir(reachabilityDir(dataPath), { recursive: true });
        await fs.writeFile(path.join(kuboRepoPath, "config"), JSON.stringify({ Addresses: { Swarm: [], AppendAnnounce: [] }, Swarm: {} }));
        const admin = http.createServer((request, response) => {
            if (request.url === "/config/") response.end(JSON.stringify({ storage: { root: caddyDataDir(dataPath).replaceAll("\\", "/") } }));
            else response.end();
        });
        await new Promise<void>((resolve) => admin.listen(0, "127.0.0.1", resolve));
        const adminPort = (admin.address() as AddressInfo).port;
        if (!caddyUp) await new Promise((resolve) => admin.close(resolve));
        const config = { ...previous, caddyAdminPort: adminPort };
        await applyKuboConfig(config, { dataPath, kuboRepoPath }, true);
        await fs.writeFile(
            caddyfilePath(dataPath),
            generateCaddyfile({ ips: previous.publicIps, domains: [DOMAIN], wsPort: 4002, adminPort, dataDirectory: caddyDataDir(dataPath), acmeDirectory: LETS_ENCRYPT_DIRECTORY })
        );
        if (certificate) {
            const directory = path.join(caddyDataDir(dataPath), "certificates", "acme-v02.api.letsencrypt.org-directory", IP);
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(path.join(directory, `${IP}.crt`), CERTIFICATE_EXPIRING_2126);
        }
        const options: SetupOptions = { dataPath, kuboRepoPath, kuboRpcUrl: new URL("http://127.0.0.1:1/api/v0"), staging: false, nonInteractive: true, overrides: { publicIps: [IP] } };
        const deps: SetupDependencies = {
            log: () => {},
            warn: () => {},
            confirm: async () => false,
            platform: process.platform,
            inContainer: false,
            isCi: false,
            kuboBinaryPath: "",
            discoverRouter: async () => undefined,
            probePort: async () => "free",
            findHolder: async () => undefined,
            publicIpsFromInterfaces: () => [],
            lanIpv4: () => undefined,
            ensureCaddy: async () => path.join(dataPath, "no-such-caddy"),
            resolveDomain: async () => ELSEWHERE,
            dial: async () => ({ peerId: "peer" }),
            certificateTimeoutMs: 0
        };
        const caddyfile = () => fs.readFile(caddyfilePath(dataPath), "utf-8");
        // The daemon's next check, once the record points here again.
        const dnsRecovers = async () => {
            const runtime = new ReachabilityRuntime({
                dataPath,
                kuboRepoPath,
                kuboRpcUrl: options.kuboRpcUrl,
                log: () => {},
                warn: () => {},
                derivePublicIps: async () => [IP],
                resolveDomain: async () => HERE,
                restartKubo: async () => {},
                caddy: { start: async () => {}, stop: async () => {}, reload: async () => {}, isUp: async () => true }
            });
            await runtime.runChecks();
        };
        return { dataPath, options, deps, caddyfile, dnsRecovers, stopAdmin: () => new Promise((resolve) => admin.close(resolve)) };
    };

    it("after the daemon already dropped it: keeps its site, so browsers get its certificate when the daemon restores it", async () => {
        const { options, deps, dataPath, caddyfile, dnsRecovers, stopAdmin } = await prepare(node({ droppedAnnounce: [DOMAIN_ADDRESS] }));
        try {
            await runReachabilitySetup(options, deps);
            expect(await caddyfile()).toContain(`https://${DOMAIN}`);
            await dnsRecovers();
            expect((await readReachabilityConfig(dataPath))!.announce).toContain(DOMAIN_ADDRESS);
            expect(await caddyfile()).toContain(`https://${DOMAIN}`);
        } finally {
            await stopAdmin();
        }
    });

    it("during a shorter outage: stops announcing it now, and the daemon announces it again on recovery", async () => {
        const { options, deps, dataPath, caddyfile, dnsRecovers, stopAdmin } = await prepare(node({ mode: "ip+domain", announce: [IP_ADDRESS, DOMAIN_ADDRESS] }));
        try {
            const result = await runReachabilitySetup(options, deps);
            expect(result).toMatchObject({ mode: "ip", announce: [IP_ADDRESS], domain: DOMAIN, droppedAnnounce: [DOMAIN_ADDRESS] });
            expect(await caddyfile()).toContain(`https://${DOMAIN}`);
            await dnsRecovers();
            const config = (await readReachabilityConfig(dataPath))!;
            expect(config.announce).toEqual([IP_ADDRESS, DOMAIN_ADDRESS]);
            expect(config.droppedAnnounce).toBeUndefined();
            expect(await caddyfile()).toContain(`https://${DOMAIN}`);
        } finally {
            await stopAdmin();
        }
    });

    it("on a node with nothing else to serve: keeps kubo's listener and the site, so it can come back", async () => {
        const { options, deps, caddyfile, stopAdmin } = await prepare(node({ mode: "webtransport-only", publicIps: [], announce: [], droppedAnnounce: [DOMAIN_ADDRESS] }), { certificate: false });
        try {
            const result = await runReachabilitySetup(options, deps);
            expect(result.serveWss).not.toBe(false);
            expect(result.droppedAnnounce).toEqual([DOMAIN_ADDRESS]);
            expect(await caddyfile()).toContain(`https://${DOMAIN}`);
        } finally {
            await stopAdmin();
        }
    });

    it("keeps nothing for a name that never had an address here", async () => {
        const { options, deps, caddyfile, stopAdmin } = await prepare(node({}));
        try {
            const result = await runReachabilitySetup(options, deps);
            expect(result.droppedAnnounce).toBeUndefined();
            expect(await caddyfile()).not.toContain(`https://${DOMAIN}`);
        } finally {
            await stopAdmin();
        }
    });

    it("keeps no site once another server holds the port, because our Caddy could not start with one", async () => {
        const { options, deps, caddyfile } = await prepare(node({ mode: "ip+domain", announce: [IP_ADDRESS, DOMAIN_ADDRESS] }), { caddyUp: false });
        const result = await runReachabilitySetup(options, { ...deps, probePort: async () => "busy" });
        expect(result.droppedAnnounce).toBeUndefined();
        expect(await caddyfile()).not.toMatch(/^https:\/\//m);
    });
});

const CERTIFICATE_EXPIRING_2126 = `-----BEGIN CERTIFICATE-----
MIIBwTCCAWigAwIBAgIULCKX6LXG4To/wQObUkjGcK75nXswCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRcmVhY2hhYmlsaXR5LXRlc3QwIBcNMjYxMTAyMTI1NzQxWhgP
MjEyNjEwMDkxMjU3NDFaMBwxGjAYBgNVBAMMEXJlYWNoYWJpbGl0eS10ZXN0MFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELndqlPuOzVu5TN+hSkn0IrB98qbFHS7K
iCj2zWR7niAi/octeM1WJe7hMYPSOHLKVeb6l9musqzB+oKJgf6BlqOBhTCBgjAd
BgNVHQ4EFgQU59HJ9KLzGmnyywqsFgO0q+SIQ44wHwYDVR0jBBgwFoAU59HJ9KLz
GmnyywqsFgO0q+SIQ44wDwYDVR0TAQH/BAUwAwEB/zAvBgNVHREEKDAmhwTLAHEH
hxAgAQ24AAAAAAAAAAAAAAAHggxub2RlLmV4YW1wbGUwCgYIKoZIzj0EAwIDRwAw
RAIgY0U1lu/j1wXrOBhZ09CaVWyCrwxwSJ8hIMqO7XAq2SACIFPBLDHJ67dGGXq+
Kd6p8xQWxlusPWNMReJkdwGvoLKZ
-----END CERTIFICATE-----
`;
