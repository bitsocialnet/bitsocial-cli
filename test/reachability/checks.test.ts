import { describe, expect, it } from "vitest";
import { bindPermission, evaluateChecks, hasPublicAddressEvidence, noWssAddressCheck, parseFirewalldState, parseUfwStatus, probeUdpPort, publicAddressAnnouncedCheck, type BindPermissionInput, type CheckFacts } from "../../src/reachability/checks.js";
import dgram from "dgram";

const CAP_NET_BIND = 1n << 10n;
const input = (overrides: Partial<BindPermissionInput> = {}): BindPermissionInput => ({
    platform: "linux",
    port: 443,
    uid: 1000,
    effectiveCapabilities: 0n,
    unprivilegedPortStart: 1024,
    fileCapabilities: "",
    ...overrides
});

describe("bindPermission", () => {
    it("denies a normal Linux user", () => expect(bindPermission(input())).toBe("denied"));
    it("allows root with the capability", () => expect(bindPermission(input({ uid: 0, effectiveCapabilities: CAP_NET_BIND }))).toBe("allowed"));
    it("denies root in a container that dropped the capability", () => expect(bindPermission(input({ uid: 0, effectiveCapabilities: 0n }))).toBe("denied"));
    it("allows through the sysctl", () => expect(bindPermission(input({ unprivilegedPortStart: 443 }))).toBe("allowed"));
    it("allows Docker's default sysctl of 0, as uid 1001", () => expect(bindPermission(input({ uid: 1001, unprivilegedPortStart: 0 }))).toBe("allowed"));
    it("does not accept a sysctl above the port", () => expect(bindPermission(input({ unprivilegedPortStart: 444 }))).toBe("denied"));
    it("allows through setcap on the binary", () => expect(bindPermission(input({ fileCapabilities: "/x/caddy cap_net_bind_service=ep\n" }))).toBe("allowed"));
    it("says unknown when getcap is missing", () => expect(bindPermission(input({ fileCapabilities: undefined }))).toBe("unknown"));
    it.each(["darwin", "win32"])("allows on %s", (platform) => expect(bindPermission(input({ platform }))).toBe("allowed"));
    it("allows any user on a high test port", () => expect(bindPermission(input({ port: 8443 }))).toBe("allowed"));
});

const facts = (overrides: Partial<CheckFacts> = {}): CheckFacts => ({
    platform: "linux",
    inContainer: false,
    enabled: false,
    daemonRunning: false,
    publicIps: ["93.184.216.34"],
    httpsPort: 443,
    wsPort: undefined,
    caddyPath: "/x/caddy",
    kuboPath: "/x/ipfs",
    ourCaddyRunning: false,
    tcp443: "free",
    tcp443Holder: undefined,
    tcp80: "free",
    tcp80Holder: undefined,
    udp443: "free",
    udp443Holder: undefined,
    caddyBind: "allowed",
    kuboBind: "allowed",
    kuboListen: undefined,
    announce: [],
    kuboConfigAnnounce: undefined,
    kuboRunningAnnounce: undefined,
    firewall: undefined,
    certificates: [],
    ...overrides
});
const check = (result: ReturnType<typeof evaluateChecks>, id: string) => result.find((entry) => entry.id === id);

describe("evaluateChecks on a node with a verified address it does not manage", () => {
    const wss = "/dns4/node.example/tcp/443/tls/ws";
    const heldByProxy = { tcp443: "busy", tcp443Holder: "caddy", udp443: "busy", udp443Holder: "caddy" } as const;
    const autonat = (fields: { reachable?: string[]; unreachable?: string[]; unknown?: string[] }) => ({ reachable: [], unreachable: [], unknown: [], ...fields });

    it("does not call the proxy holding TCP 443 a problem", () => {
        const tcp = check(evaluateChecks(facts({ ...heldByProxy, verifiedWss: [wss] })), "tcp-443")!;
        expect(tcp.status).toBe("ok");
        expect(tcp.detail).toContain("caddy");
        expect(tcp.detail).toContain(wss);
    });

    it("ignores that address on the port's permission check too, as a non-root user cannot even probe the port", () => {
        expect(check(evaluateChecks(facts({ tcp443: "no-permission", caddyBind: "denied", verifiedWss: [wss] })), "tcp-443")!.status).toBe("ok");
    });

    it("still reports TCP 443 when the verified address uses another port", () => {
        expect(check(evaluateChecks(facts({ ...heldByProxy, verifiedWss: ["/dns4/node.example/tcp/8443/tls/ws"] })), "tcp-443")!.status).toBe("fail");
    });

    it("still reports TCP 443 when nothing was verified", () => {
        expect(check(evaluateChecks(facts({ ...heldByProxy })), "tcp-443")!.status).toBe("fail");
    });

    it("passes UDP 443 when AutoNAT confirmed the fallback UDP port", () => {
        const udp = check(evaluateChecks(facts({ ...heldByProxy, verifiedWss: [wss], kuboAutonat: autonat({ reachable: ["/ip4/93.184.216.34/udp/4001/quic-v1/webtransport/certhash/uEiA"] }) })), "udp-443")!;
        expect(udp.status).toBe("ok");
        expect(udp.detail).toContain("UDP 4001");
        // go-libp2p 0.47+ marks the WebTransport address reachable from QUIC on its port, without a WebTransport dial (#238).
        expect(udp.detail).toContain("AutoNAT reached kubo over QUIC on UDP 4001");
        expect(udp.detail).toContain("should be able to use it unless their network blocks UDP");
    });

    it("does not count plain QUIC as WebTransport on the fallback port", () => {
        const udp = check(evaluateChecks(facts({ ...heldByProxy, verifiedWss: [wss], kuboAutonat: autonat({ reachable: ["/ip4/93.184.216.34/udp/4001/quic-v1"] }) })), "udp-443")!;
        expect(udp.status).toBe("warn");
    });

    it("warns on UDP 443, naming the address, when AutoNAT could not reach the fallback port", () => {
        const address = "/ip4/93.184.216.34/udp/4001/quic-v1/webtransport/certhash/uEiA";
        const udp = check(evaluateChecks(facts({ ...heldByProxy, verifiedWss: [wss], kuboAutonat: autonat({ unreachable: [address] }) })), "udp-443")!;
        expect(udp.status).toBe("warn");
        expect(udp.detail).toContain(address);
    });

    it("warns on UDP 443 when the fallback port has not been tested, including with no AutoNAT answer", () => {
        for (const kuboAutonat of [autonat({ unknown: ["/ip4/93.184.216.34/udp/4001/quic-v1/webtransport/certhash/uEiA"] }), undefined]) {
            const udp = check(evaluateChecks(facts({ ...heldByProxy, verifiedWss: [wss], ...(kuboAutonat ? { kuboAutonat } : {}) })), "udp-443")!;
            expect(udp.status).toBe("warn");
            expect(udp.detail).toMatch(/not (been )?tested/);
        }
    });

    it("warns rather than fails when a non-root kubo may not bind UDP 443, and still says how to fix it", () => {
        const denied = { udp443: "no-permission", kuboBind: "denied" } as const;
        const udp = check(evaluateChecks(facts({ ...denied, verifiedWss: [wss] })), "udp-443")!;
        expect(udp.status).toBe("warn");
        expect(udp.detail).toContain("no permission");
        expect(udp.fix).toContain("setcap");
    });

    it("keeps that a problem without a verified address", () => {
        expect(check(evaluateChecks(facts({ udp443: "no-permission", kuboBind: "denied" })), "udp-443")!.status).toBe("fail");
    });

    it("keeps UDP 443 as a problem without a verified address, and makes no claim about ISPs", () => {
        const udp = check(evaluateChecks(facts({ ...heldByProxy })), "udp-443")!;
        expect(udp.status).toBe("fail");
        expect(`${udp.detail} ${udp.fix}`).not.toMatch(/ISP/);
    });
});

describe("evaluateChecks inbound with AutoNAT results", () => {
    const tcp = "/ip4/93.184.216.34/tcp/4001";
    const inbound = (kuboAutonat: NonNullable<CheckFacts["kuboAutonat"]>) => check(evaluateChecks(facts({ kuboAutonat })), "inbound")!;

    it("is ok once AutoNAT reached an address, and never claims that covers WSS", () => {
        const result = inbound({ reachable: [tcp], unreachable: [], unknown: [] });
        expect(result.status).toBe("ok");
        expect(result.detail).toContain(tcp);
        expect(result.detail).toMatch(/not cover WSS through a reverse proxy/);
    });

    it("warns when AutoNAT could reach nothing it tested", () => {
        expect(inbound({ reachable: [], unreachable: [tcp], unknown: [] }).status).toBe("warn");
    });

    it("stays unknown until AutoNAT has a result", () => {
        expect(inbound({ reachable: [], unreachable: [], unknown: [tcp] }).status).toBe("unknown");
        expect(inbound({ reachable: [], unreachable: [], unknown: [] }).status).toBe("unknown");
    });
});

describe("evaluateChecks", () => {
    it("passes a clean host, but never claims inbound is proven", () => {
        const result = evaluateChecks(facts());
        expect(result.filter((entry) => entry.status !== "ok").map((entry) => entry.id)).toEqual(["inbound"]);
        expect(check(result, "inbound")!.status).toBe("unknown");
    });

    describe("kubo announcing what setup applied (#216)", () => {
        const address = "/ip4/93.184.216.34/tcp/443/tls/ws";
        const peer = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";
        const announceCheck = (overrides: Partial<CheckFacts>) => check(evaluateChecks(facts({ enabled: true, announce: [address], ...overrides })), "kubo-announce");

        it("fails on an address missing from the config", () => {
            expect(announceCheck({ kuboConfigAnnounce: [] })).toMatchObject({ status: "fail", detail: expect.stringContaining(address), fix: expect.stringContaining("reachability enable") });
        });
        it("accepts the address under Announce too", () => {
            expect(announceCheck({ kuboConfigAnnounce: [address] })).toMatchObject({ status: "ok" });
        });
        it("compares running kubo's addresses without their /p2p suffix", () => {
            expect(announceCheck({ kuboConfigAnnounce: [address], kuboRunningAnnounce: [`${address}/p2p/${peer}`] })).toMatchObject({ status: "ok" });
        });
        it("does not take a longer address for the expected one", () => {
            expect(announceCheck({ kuboConfigAnnounce: [address], kuboRunningAnnounce: [`${address}/extra/p2p/${peer}`] })).toMatchObject({ status: "fail" });
        });
        it("fails when running kubo lacks it, and names NoAnnounce for when a restart does not help", () => {
            expect(announceCheck({ kuboConfigAnnounce: [address], kuboRunningAnnounce: [] })).toMatchObject({ status: "fail", fix: expect.stringContaining("NoAnnounce") });
        });
        it("checks running kubo alone when the config file cannot be read", () => {
            expect(announceCheck({ kuboRunningAnnounce: [] })).toMatchObject({ status: "fail" });
        });
        it("reports the config problem first, since a restart alone would not fix it", () => {
            expect(announceCheck({ kuboConfigAnnounce: [], kuboRunningAnnounce: [] })!.detail).toContain("kubo's config");
        });
        it("has nothing to say with nothing to compare, nothing announced, or reachability off", () => {
            expect(announceCheck({})).toBeUndefined();
            expect(announceCheck({ announce: [], kuboConfigAnnounce: [] })).toBeUndefined();
            expect(announceCheck({ enabled: false, kuboConfigAnnounce: [] })).toBeUndefined();
        });
    });

    describe("UDP 443", () => {
        it("fails with the fix when kubo may not bind it, before it silently does not listen", () => {
            const result = check(evaluateChecks(facts({ kuboBind: "denied", udp443: "no-permission" })), "udp-443")!;
            expect(result.status).toBe("fail");
            expect(result.detail).toContain("silently");
            expect(result.fix).toContain("ip_unprivileged_port_start");
            expect(result.fix).toContain('"/x/ipfs"');
        });

        it("in a container points at the capability, not sudo", () => {
            const result = check(evaluateChecks(facts({ inContainer: true, kuboBind: "denied" })), "udp-443")!;
            expect(result.fix).toContain("NET_BIND_SERVICE");
            expect(result.fix).not.toContain("sudo");
        });

        it("names what holds it", () => {
            const result = check(evaluateChecks(facts({ udp443: "busy", udp443Holder: "quic-server" })), "udp-443")!;
            expect(result.status).toBe("fail");
            expect(result.detail).toContain("quic-server");
        });

        it("trusts kubo's real listen addresses above every prediction", () => {
            const listen = ["/ip4/0.0.0.0/udp/443/quic-v1/webtransport/certhash/x"];
            const result = check(evaluateChecks(facts({ kuboBind: "denied", udp443: "busy", kuboListen: listen, daemonRunning: true })), "udp-443")!;
            expect(result.status).toBe("ok");
        });

        it("fails when enabled and kubo should be listening but is not", () => {
            const result = check(evaluateChecks(facts({ enabled: true, daemonRunning: true, kuboListen: [] })), "udp-443")!;
            expect(result.status).toBe("fail");
        });
    });

    describe("TCP 443", () => {
        it("names what holds it and offers the proxy path", () => {
            const result = check(evaluateChecks(facts({ tcp443: "busy", tcp443Holder: "nginx" })), "tcp-443")!;
            expect(result.status).toBe("fail");
            expect(result.detail).toContain("nginx");
            expect(result.fix).toContain("--domain");
        });

        it("fails with the fix when Caddy may not bind it", () => {
            const result = check(evaluateChecks(facts({ caddyBind: "denied" })), "tcp-443")!;
            expect(result.status).toBe("fail");
            expect(result.fix).toContain('"/x/caddy"');
        });

        it("does not count our own Caddy as a conflict", () => {
            expect(check(evaluateChecks(facts({ ourCaddyRunning: true, tcp443: "busy", tcp443Holder: "caddy" })), "tcp-443")!.status).toBe("ok");
        });
    });

    it("TCP 80 busy only warns, since validation still works on 443", () => {
        expect(check(evaluateChecks(facts({ tcp80: "busy", tcp80Holder: "nginx" })), "tcp-80")!.status).toBe("warn");
    });

    it("warns about a firewall closing either protocol and gives the command", () => {
        const result = check(evaluateChecks(facts({ firewall: { name: "ufw", active: true, allowsTcp443: true, allowsUdp443: false } })), "firewall")!;
        expect(result.status).toBe("warn");
        expect(result.detail).toContain("UDP 443");
        expect(result.fix).toBe("sudo ufw allow 443");
    });

    it("warns when no public address is on the interfaces", () => {
        expect(check(evaluateChecks(facts({ publicIps: [] })), "public-address")!.status).toBe("warn");
    });

    it("reports the daemon being down when enabled", () => {
        expect(check(evaluateChecks(facts({ enabled: true })), "daemon")!.status).toBe("warn");
    });

    it("fails when kubo lacks the listener the terminator forwards to", () => {
        expect(check(evaluateChecks(facts({ enabled: true, daemonRunning: true, wsPort: 4002, kuboListen: [] })), "kubo-ws")!.status).toBe("fail");
        expect(check(evaluateChecks(facts({ enabled: true, daemonRunning: true, wsPort: 4002, kuboListen: ["/ip4/127.0.0.1/tcp/4002/ws"] })), "kubo-ws")!.status).toBe("ok");
    });

    it("warns about a certificate near expiry", () => {
        const certificates = [{ issuer: "x", names: ["93.184.216.34"], notAfter: "x", hoursLeft: 5 }];
        expect(check(evaluateChecks(facts({ enabled: true, certificates })), "certificate")!.status).toBe("warn");
    });
});

// Issue #231: a node announcing only loopback and private addresses seeds nothing for anyone.
describe("noWssAddressCheck (#226)", () => {
    const stuck = { announce: [], wsPort: 4002, tcp443: "free" as const, hasPublicAddress: false, forcedDomain: false, otherWssWorks: false, droppedName: false };

    it("points a node setup left without WSS at Tailscale Funnel, with its ws port", () => {
        expect(noWssAddressCheck(stuck)).toMatchObject({ id: "browser-address", status: "warn", fix: expect.stringMatching(/Tailscale Funnel.*127\.0\.0\.1:4002.*docs\/tailscale-funnel\.md/) });
    });

    it.each([
        ["announces a WSS address", { announce: ["/ip4/93.184.216.34/tcp/443/tls/ws"] }],
        ["has a public address and another program on TCP 443, which setup's reverse proxy guidance covers", { tcp443: "busy" as const, hasPublicAddress: true }],
        ["has a forced domain and another program on TCP 443, where setup prints the reverse proxy snippet without a public address", { tcp443: "busy" as const, forcedDomain: true }],
        ["has a working WSS address setup does not manage", { otherWssWorks: true }],
        ["had a working name dropped, whose DNS is what needs fixing", { droppedName: true }]
    ])("says nothing on a node that %s", (_name, change) => expect(noWssAddressCheck({ ...stuck, ...change })).toBeUndefined());

    // setup prints the Funnel steps here too: with no public address, the program on TCP 443 cannot be reached either.
    it("still points at Funnel when another program holds TCP 443 but the node has no public address", () => {
        expect(noWssAddressCheck({ ...stuck, tcp443: "busy" })).toMatchObject({ id: "browser-address", status: "warn", fix: expect.stringContaining("Tailscale Funnel") });
    });

    // Nothing holds the port for a reverse proxy to live in, so setup prints the Funnel steps for a forced name too.
    it("still points at Funnel when a forced domain is stored but TCP 443 is free", () => {
        expect(noWssAddressCheck({ ...stuck, forcedDomain: true })).toMatchObject({ id: "browser-address", status: "warn", fix: expect.stringContaining("Tailscale Funnel") });
    });

    it("points at Funnel on a node with a public address and a free TCP 443, where Let's Encrypt could not reach it", () => {
        expect(noWssAddressCheck({ ...stuck, hasPublicAddress: true })).toMatchObject({ id: "browser-address", status: "warn" });
    });
});

describe("hasPublicAddressEvidence (#226)", () => {
    const peer = "/p2p/12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";

    it("counts a public address on an interface", () => {
        expect(hasPublicAddressEvidence({ publicIps: ["93.184.216.34"], kuboRunningAnnounce: undefined }, [])).toBe(true);
    });

    // A home node behind a UPnP router: setup finds the router's address, so status must not disagree with it.
    it("counts a public address running kubo reports, as setup does, when the interfaces have none", () => {
        expect(hasPublicAddressEvidence({ publicIps: [], kuboRunningAnnounce: [`/ip4/192.168.1.5/tcp/4001${peer}`, `/ip4/93.184.216.34/tcp/4001${peer}`] }, [])).toBe(true);
    });

    it.each([
        ["kubo reports only private addresses", [`/ip4/192.168.1.5/tcp/4001${peer}`, `/ip4/100.64.0.7/udp/4001/quic-v1${peer}`], []],
        ["the only public address is one we told kubo to announce", [`/ip4/93.184.216.34/tcp/443/tls/ws${peer}`], ["/ip4/93.184.216.34/tcp/443/tls/ws"]],
        ["kubo is not running", undefined, []]
    ])("finds none when %s", (_name, kuboRunningAnnounce, ownAnnounce) => {
        expect(hasPublicAddressEvidence({ publicIps: [], kuboRunningAnnounce }, ownAnnounce)).toBe(false);
    });
});

describe("publicAddressAnnouncedCheck", () => {
    const peerId = "12D3KooWKWyr2rBUftSL2mq8ESvrXCAoB12AFMeqfRskkn7dP6J2";
    const qemuVm = [
        "/ip4/127.0.0.1/tcp/4001",
        "/ip6/::1/tcp/4001",
        "/ip4/10.0.2.15/udp/4001/quic-v1",
        "/ip6/fec0::5054:ff:fe12:3456/udp/4001/quic-v1"
    ].map((address) => `${address}/p2p/${peerId}`);

    it("fails when kubo announces only loopback and private addresses, naming them and the fix", () => {
        const check = publicAddressAnnouncedCheck({ running: qemuVm, inContainer: false });
        expect(check).toMatchObject({ id: "public-address-announced", status: "fail" });
        expect(check.detail).toContain(
            "announces no public address, so other nodes and browsers cannot reach it and it seeds nothing for them"
        );
        expect(check.detail).toContain("/ip6/fec0::5054:ff:fe12:3456/udp/4001/quic-v1");
        expect(check.detail).not.toContain(peerId);
        expect(check.fix).toMatch(/UPnP/);
        expect(check.fix).toMatch(/bridged networking/);
        expect(check.fix).toMatch(/bitsocial reachability setup/);
        expect(check.fix).not.toMatch(/Docker/);
    });

    it("fails when kubo announces nothing at all", () => {
        expect(publicAddressAnnouncedCheck({ running: [], inContainer: false })).toMatchObject({
            status: "fail",
            detail: expect.stringContaining("announces no address at all")
        });
    });

    it("adds what to do in Docker inside a container", () => {
        expect(publicAddressAnnouncedCheck({ running: qemuVm, inContainer: true }).fix).toMatch(
            /--network host or publish 4001\/udp and 4001\/tcp/
        );
    });

    it.each([
        ["a public IPv4", "/ip4/93.184.216.34/udp/4001/quic-v1"],
        ["a global IPv6", "/ip6/2606:4700::1/tcp/4001"],
        ["an AutoTLS name", "/dns4/93-184-216-34.k51.libp2p.direct/tcp/4001/tls/ws"],
        ["a relay", `/ip4/93.184.216.34/tcp/4001/p2p/${peerId}/p2p-circuit`]
    ])("passes with %s among them", (_name, address) => {
        const check = publicAddressAnnouncedCheck({ running: [...qemuVm, `${address}/p2p/${peerId}`], inContainer: false });
        expect(check.status).toBe("ok");
        expect(check.detail).toContain(address);
    });

    it("is unknown while kubo is down", () =>
        expect(publicAddressAnnouncedCheck({ running: undefined, inContainer: false }).status).toBe("unknown"));

    it("counts what the test hook treats as public", () => {
        expect(
            publicAddressAnnouncedCheck({ running: ["/ip4/127.0.0.1/tcp/4001"], inContainer: false, treatAsPublic: ["127.0.0.1"] }).status
        ).toBe("ok");
    });
});

describe("firewall parsing", () => {
    it("reads inactive ufw", () => expect(parseUfwStatus("Status: inactive\n")!.active).toBe(false));

    it.each(["Anywhere", "Anywhere (v6)"])("counts a blanket %s rule as allowing both protocols", (rule) => {
        const blanket = parseUfwStatus(`Status: active\n\n${rule.padEnd(27)}ALLOW       Anywhere\n`)!;
        expect(blanket).toMatchObject({ allowsTcp443: true, allowsUdp443: true });
    });

    it.each([
        ["80,443/tcp", true, false],
        ["443,8443/udp", false, true],
        ["443:444/udp", false, true],
        ["400:500/tcp", true, false],
        ["80,400:500/tcp", true, false],
        ["80,443/tcp (v6)", true, false],
        ["Anywhere/udp", false, true]
    ])("reads the ufw rule %s", (rule, tcp, udp) => {
        expect(parseUfwStatus(`Status: active\n\n${rule.padEnd(27)}ALLOW       Anywhere\n`)).toMatchObject({ allowsTcp443: tcp, allowsUdp443: udp });
    });

    it.each(["80,8443/tcp", "444:500/tcp", "1:442/udp", "4430", "1443/tcp"])("does not take the ufw rule %s to include 443", (rule) => {
        expect(parseUfwStatus(`Status: active\n\n${rule.padEnd(27)}ALLOW       Anywhere\n`)).toMatchObject({ allowsTcp443: false, allowsUdp443: false });
    });

    it.each(["443", "80,443/tcp", "Anywhere", "Nginx Full"])("does not count an outgoing or denying %s rule as opening the port", (rule) => {
        for (const action of ["ALLOW OUT", "DENY", "REJECT"]) expect(parseUfwStatus(`Status: active\n\n${rule.padEnd(27)}${action.padEnd(12)}Anywhere\n`)).toMatchObject({ allowsTcp443: false, allowsUdp443: false });
    });

    it("does not count a ufw app profile as allowing UDP, since those only open TCP", () => {
        expect(parseUfwStatus("Status: active\n\nNginx Full                 ALLOW       Anywhere\n")!.allowsUdp443).toBe(false);
    });

    it("reads ufw rules per protocol", () => {
        const tcpOnly = parseUfwStatus("Status: active\n\nTo                         Action      From\n--                         ------      ----\n443/tcp                    ALLOW       Anywhere\n")!;
        expect(tcpOnly).toMatchObject({ active: true, allowsTcp443: true, allowsUdp443: false });
        const both = parseUfwStatus("Status: active\n\n443                        ALLOW       Anywhere\n")!;
        expect(both).toMatchObject({ allowsTcp443: true, allowsUdp443: true });
        const neither = parseUfwStatus("Status: active\n\n22/tcp                     ALLOW       Anywhere\n")!;
        expect(neither).toMatchObject({ allowsTcp443: false, allowsUdp443: false });
    });

    it.each([
        ["Nginx Full", true],
        ["Nginx HTTPS", true],
        ["Apache Full", true],
        ["Apache Secure", true],
        ["Caddy", true],
        ["Nginx HTTP", false],
        ["Apache", false]
    ])("knows whether the ufw app profile %s opens TCP 443", (profile, opens) => {
        expect(parseUfwStatus(`Status: active\n\n${profile.padEnd(27)}ALLOW       Anywhere\n`)!.allowsTcp443).toBe(opens);
        expect(parseUfwStatus(`Status: active\n\n${`${profile} (v6)`.padEnd(27)}ALLOW       Anywhere (v6)\n`)!.allowsTcp443).toBe(opens);
    });

    it("does not read 8443 as 443", () => {
        expect(parseUfwStatus("Status: active\n\n8443/tcp                   ALLOW       Anywhere\n")!.allowsTcp443).toBe(false);
    });

    it("reads firewalld", () => {
        expect(parseFirewalldState("running\n", "443/tcp 443/udp\n", "ssh\n")).toMatchObject({ active: true, allowsTcp443: true, allowsUdp443: true });
        expect(parseFirewalldState("running\n", "", "https ssh\n")).toMatchObject({ allowsTcp443: true, allowsUdp443: false });
        expect(parseFirewalldState("not running\n", "", "")).toMatchObject({ active: false });
    });
});

describe("probeUdpPort", () => {
    it("sees a held port as busy and a free one as free", async () => {
        const socket = dgram.createSocket("udp4");
        const port = await new Promise<number>((resolve) => socket.bind(0, "127.0.0.1", () => resolve(socket.address().port)));
        expect(await probeUdpPort(port, "127.0.0.1")).toBe("busy");
        await new Promise<void>((resolve) => socket.close(() => resolve()));
        expect(await probeUdpPort(port, "127.0.0.1")).toBe("free");
    });
});
