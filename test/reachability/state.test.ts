import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import {
    caddyDataDir,
    readIssuedCertificates,
    readReachabilityConfig,
    readReachabilityStatus,
    reachabilityConfigPath,
    reachabilityRuntimeStatusPath,
    writeReachabilityConfig,
    writeReachabilityRuntimeStatus,
    type ReachabilityConfig
} from "../../src/reachability/state.js";

// Self-signed, SANs IP:203.0.113.7, IP:2001:db8::7, DNS:node.example, expires 2126-10-09.
const CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
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

const validConfig = (): ReachabilityConfig => ({
    version: 1,
    enabled: true,
    mode: "ip",
    wsPort: 4002,
    announce: ["/ip4/203.0.113.7/tcp/443/tls/ws"],
    publicIps: ["203.0.113.7"],
    staging: false
});

const writeRawConfig = async (dataPath: string, content: string) => {
    await fs.mkdir(path.dirname(reachabilityConfigPath(dataPath)), { recursive: true });
    await fs.writeFile(reachabilityConfigPath(dataPath), content);
};

const installCertificate = async (dataPath: string, name = "203.0.113.7", issuer = "acme-v02.api.letsencrypt.org-directory") => {
    const directory = path.join(caddyDataDir(dataPath), "certificates", issuer, name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${name}.crt`), CERTIFICATE_PEM);
    await fs.writeFile(path.join(directory, `${name}.key`), "not a certificate");
};

describe("reachability config file", () => {
    it("returns undefined when nothing is configured", async () => {
        expect(await readReachabilityConfig(randomDirectory())).toBeUndefined();
    });

    it("round-trips and creates the directory", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, validConfig());
        expect(await readReachabilityConfig(dataPath)).toEqual(validConfig());
    });

    it("leaves no temp file behind", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, validConfig());
        expect(await fs.readdir(path.dirname(reachabilityConfigPath(dataPath)))).toEqual(["config.json"]);
    });

    it("refuses a config from a newer version instead of dropping its fields", async () => {
        const dataPath = randomDirectory();
        await writeRawConfig(dataPath, JSON.stringify({ ...validConfig(), version: 2 }));
        await expect(readReachabilityConfig(dataPath)).rejects.toThrow(/newer bitsocial-cli/);
    });

    it("names the file when the JSON is corrupt", async () => {
        const dataPath = randomDirectory();
        await writeRawConfig(dataPath, "{ not json");
        await expect(readReachabilityConfig(dataPath)).rejects.toThrow(reachabilityConfigPath(dataPath));
    });

    it.each([
        ["no version", { version: undefined }],
        ["version 0", { version: 0 }],
        ["enabled not boolean", { enabled: "yes" }],
        ["unknown mode", { mode: "relay" }],
        ["port out of range", { wsPort: 70000 }],
        ["announce not a list", { announce: "/ip4/1.1.1.1" }],
        ["publicIps holding a number", { publicIps: [1] }],
        ["domain not a string", { domain: 5 }],
        ["staging missing", { staging: undefined }]
    ])("rejects %s", async (_label, overrides) => {
        const dataPath = randomDirectory();
        await writeRawConfig(dataPath, JSON.stringify({ ...validConfig(), ...overrides }));
        await expect(readReachabilityConfig(dataPath)).rejects.toThrow(/Invalid reachability config/);
    });
});

describe("issued certificates", () => {
    it("returns nothing before Caddy has a data directory", async () => {
        expect(await readIssuedCertificates(randomDirectory())).toEqual([]);
    });

    it("reads names, expiry and the CA from Caddy's layout", async () => {
        const dataPath = randomDirectory();
        await installCertificate(dataPath);
        const [certificate] = await readIssuedCertificates(dataPath, new Date("2126-10-09T00:00:00Z"));
        expect(certificate).toEqual({
            issuer: "acme-v02.api.letsencrypt.org-directory",
            names: ["203.0.113.7", "2001:DB8:0:0:0:0:0:7", "node.example"],
            notAfter: "2126-10-09T12:57:41.000Z",
            hoursLeft: 12
        });
    });

    it("skips an unreadable certificate instead of failing", async () => {
        const dataPath = randomDirectory();
        await installCertificate(dataPath);
        const brokenDirectory = path.join(caddyDataDir(dataPath), "certificates", "ca", "broken");
        await fs.mkdir(brokenDirectory, { recursive: true });
        await fs.writeFile(path.join(brokenDirectory, "broken.crt"), "half written");
        expect(await readIssuedCertificates(dataPath)).toHaveLength(1);
    });
});

describe("reachability status", () => {
    it("reports not configured", async () => {
        expect(await readReachabilityStatus(randomDirectory())).toEqual({
            configured: false,
            enabled: false,
            mode: null,
            addresses: [],
            wsPort: null,
            domain: null,
            staging: false,
            certificates: [],
            lastChecks: null
        });
    });

    it("announces nothing while disabled, but keeps the stored mode", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, { ...validConfig(), enabled: false });
        const status = await readReachabilityStatus(dataPath);
        expect(status).toMatchObject({ configured: true, enabled: false, mode: "ip", addresses: [] });
    });

    it("includes the daemon's last checks", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, validConfig());
        const lastChecks = { updatedAt: "2026-11-02T00:00:00.000Z", lastIpCheck: { at: "2026-11-02T00:00:00.000Z", publicIps: ["203.0.113.7"] } };
        await writeReachabilityRuntimeStatus(dataPath, lastChecks);
        expect((await readReachabilityStatus(dataPath)).lastChecks).toEqual(lastChecks);
    });

    it("survives a damaged runtime status file", async () => {
        const dataPath = randomDirectory();
        await writeReachabilityConfig(dataPath, validConfig());
        await fs.writeFile(reachabilityRuntimeStatusPath(dataPath), "{ broken");
        expect((await readReachabilityStatus(dataPath)).lastChecks).toBeNull();
    });
});
