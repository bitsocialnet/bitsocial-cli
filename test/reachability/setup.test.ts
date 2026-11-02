import { describe, expect, it } from "vitest";
import { LETS_ENCRYPT_DIRECTORY, LETS_ENCRYPT_STAGING_DIRECTORY } from "../../src/reachability/caddy.js";
import { bindDeniedGuidance, busyPortMessage, testCommandHint, unreachableStatement, webTransportNotListeningGuidance } from "../../src/reachability/guidance.js";
import { assertAcmeDirectoryAllowed, chooseAcmeDirectory, deriveMode, discoverPublicIps, type SetupDependencies, type SetupOptions } from "../../src/reachability/setup.js";

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
