import { describe, expect, it } from "vitest";
import { bindPermission, evaluateChecks, parseFirewalldState, parseUfwStatus, probeUdpPort, type BindPermissionInput, type CheckFacts } from "../../src/reachability/checks.js";
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

describe("firewall parsing", () => {
    it("reads inactive ufw", () => expect(parseUfwStatus("Status: inactive\n")!.active).toBe(false));

    it.each(["Anywhere", "Anywhere (v6)"])("counts a blanket %s rule as allowing both protocols", (rule) => {
        const blanket = parseUfwStatus(`Status: active\n\n${rule.padEnd(27)}ALLOW       Anywhere\n`)!;
        expect(blanket).toMatchObject({ allowsTcp443: true, allowsUdp443: true });
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
