import fs from "fs/promises";
import http from "http";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { caddyDataDir } from "../../src/reachability/state.js";
import { directory as randomDirectory } from "tempy";
import {
    CADDY_RELEASE_SHA256,
    caddyBinaryPath,
    caddyReleaseFor,
    ensureCaddyBinary,
    generateCaddyfile,
    isOurCaddyRunning,
    LETS_ENCRYPT_DIRECTORY,
    startCaddy,
    waitForCertificates,
    type CaddyfileSpec
} from "../../src/reachability/caddy.js";

const spec = (overrides: Partial<CaddyfileSpec> = {}): CaddyfileSpec => ({
    ips: ["203.0.113.7", "2001:db8::7"],
    domains: [],
    wsPort: 4002,
    adminPort: 2019,
    dataDirectory: "/data/reachability/caddy-data",
    acmeDirectory: LETS_ENCRYPT_DIRECTORY,
    ...overrides
});

describe("caddy release pinning", () => {
    it("pins a full sha256 for each platform we ship on", () => {
        expect(Object.keys(CADDY_RELEASE_SHA256).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
        for (const sha256 of Object.values(CADDY_RELEASE_SHA256)) expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
        ["linux", "x64", /caddy_[\d.]+_linux_amd64\.tar\.gz$/, "caddy"],
        ["darwin", "arm64", /caddy_[\d.]+_mac_arm64\.tar\.gz$/, "caddy"],
        ["win32", "x64", /caddy_[\d.]+_windows_amd64\.zip$/, "caddy.exe"]
    ])("maps %s-%s to the release file", (platform, arch, pattern, binaryName) => {
        const release = caddyReleaseFor(platform, arch);
        expect(release.url).toMatch(pattern);
        expect(release.url.startsWith("https://github.com/caddyserver/caddy/releases/download/")).toBe(true);
        expect(release.binaryName).toBe(binaryName);
    });

    it("names the supported list for an unsupported platform", () => {
        expect(() => caddyReleaseFor("freebsd", "x64")).toThrow(/freebsd-x64.*linux-x64/);
    });
});

describe("ensureCaddyBinary", () => {
    it("refuses a download whose hash does not match and leaves nothing runnable", async () => {
        const dataPath = randomDirectory();
        const fetchImpl = vi.fn(async () => new Response("not caddy")) as unknown as typeof fetch;
        await expect(ensureCaddyBinary(dataPath, { fetchImpl })).rejects.toThrow(/failed verification/);
        await expect(fs.access(caddyBinaryPath(dataPath))).rejects.toThrow();
    });

    it("does not retry a hash mismatch", async () => {
        const fetchImpl = vi.fn(async () => new Response("not caddy")) as unknown as typeof fetch;
        await expect(ensureCaddyBinary(randomDirectory(), { fetchImpl })).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("does not download again once the binary exists", async () => {
        const dataPath = randomDirectory();
        await fs.mkdir(caddyBinaryPath(dataPath).replace(/[^/\\]+$/, ""), { recursive: true });
        await fs.writeFile(caddyBinaryPath(dataPath), "");
        const fetchImpl = vi.fn() as unknown as typeof fetch;
        expect(await ensureCaddyBinary(dataPath, { fetchImpl })).toBe(caddyBinaryPath(dataPath));
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe("startCaddy", () => {
    it("reports a binary that cannot run as an exit, instead of crashing the process", async () => {
        const dataPath = randomDirectory();
        let output = "";
        const child = startCaddy(dataPath, path.join(dataPath, "no-such-caddy"), (line) => (output += line));
        await new Promise((resolve) => child.once("exit", resolve));
        expect(output).toContain("ENOENT");
    });
});

describe("isOurCaddyRunning", () => {
    const serve = async (body: string) => {
        const server = http.createServer((_request, response) => response.end(body));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        return { server, port: (server.address() as { port: number }).port };
    };

    it("is true only for a Caddy storing in this node's data directory", async () => {
        const dataPath = randomDirectory();
        const { server, port } = await serve(JSON.stringify({ storage: { module: "file_system", root: caddyDataDir(dataPath).replaceAll("\\", "/") } }));
        expect(await isOurCaddyRunning(port, dataPath)).toBe(true);
        expect(await isOurCaddyRunning(port, randomDirectory())).toBe(false);
        server.close();
    });

    it.each(["not json", "{}", "null"])("is false for something else answering on the port: %s", async (body) => {
        const { server, port } = await serve(body);
        expect(await isOurCaddyRunning(port, randomDirectory())).toBe(false);
        server.close();
    });

    it("is false when nothing is listening", async () => {
        const { server, port } = await serve("");
        await new Promise((resolve) => server.close(resolve));
        expect(await isOurCaddyRunning(port, randomDirectory())).toBe(false);
    });
});

describe("waitForCertificates", () => {
    it("stops polling as soon as it is aborted, so a dead Caddy cannot hold the CLI open", async () => {
        const stop = new AbortController();
        const started = Date.now();
        const waiting = waitForCertificates(randomDirectory(), LETS_ENCRYPT_DIRECTORY, ["93.184.216.34"], 60_000, stop.signal);
        stop.abort();
        expect(await waiting).toEqual({ issued: [], missing: ["93.184.216.34"] });
        expect(Date.now() - started).toBeLessThan(5_000);
    });
});

describe("generateCaddyfile", () => {
    it("puts both IPs under one site with the shortlived profile", () => {
        const output = generateCaddyfile(spec());
        expect(output).toContain("https://203.0.113.7, https://[2001:db8::7] {");
        expect(output).toContain("profile shortlived");
        expect(output).toContain("reverse_proxy 127.0.0.1:4002");
    });

    it("gives a domain a normal certificate, without the shortlived profile", () => {
        const output = generateCaddyfile(spec({ ips: [], domains: ["node.example"] }));
        expect(output).toContain("https://node.example {");
        expect(output).not.toContain("profile");
    });

    it("emits IP and domain sites together", () => {
        const output = generateCaddyfile(spec({ domains: ["node.example"] }));
        expect(output).toContain("https://203.0.113.7, https://[2001:db8::7] {");
        expect(output).toContain("https://node.example {");
    });

    it("never enables HTTP/3, which would take kubo's UDP 443", () => {
        expect(generateCaddyfile(spec())).toMatch(/protocols h1 h2\n/);
    });

    it("never binds port 80 for redirects", () => {
        expect(generateCaddyfile(spec())).toContain("auto_https disable_redirects");
    });

    it("keeps the admin API on loopback and asks for no email", () => {
        const output = generateCaddyfile(spec());
        expect(output).toContain("admin 127.0.0.1:2019");
        expect(output).not.toContain("email");
    });

    it("prefers the IPv4 address as default_sni, whatever the order", () => {
        expect(generateCaddyfile(spec({ ips: ["2001:db8::7", "203.0.113.7"] }))).toContain("default_sni 203.0.113.7");
        expect(generateCaddyfile(spec({ ips: ["2001:db8::7"] }))).toContain("default_sni 2001:db8::7");
    });

    it("uses the given ACME directory", () => {
        expect(generateCaddyfile(spec({ acmeDirectory: "https://127.0.0.1:1/dir" }))).toContain("dir https://127.0.0.1:1/dir");
    });

    it("quotes data paths and normalises Windows separators", () => {
        const output = generateCaddyfile(spec({ dataDirectory: "C:\\Users\\some one\\caddy-data" }));
        expect(output).toContain('storage file_system "C:/Users/some one/caddy-data"');
    });

    it.each([
        "node.example {\n\tmalicious\n}",
        "node.example other.example",
        "node.example\nadmin 0.0.0.0:2019",
        "*.example.com",
        "localhost",
        "-bad.example",
        "",
        "a".repeat(254) + ".example"
    ])("rejects %j as a domain", (domain) => {
        expect(() => generateCaddyfile(spec({ domains: [domain] }))).toThrow(/Not a valid domain/);
    });

    it("rejects a non-IP in the IP list", () => {
        expect(() => generateCaddyfile(spec({ ips: ["203.0.113.7 { }"] }))).toThrow(/Not an IP/);
    });

    it("rejects a path that would break out of its quotes", () => {
        expect(() => generateCaddyfile(spec({ dataDirectory: 'x"\nadmin off' }))).toThrow(/cannot be used/);
    });

    it("rejects invalid ports", () => {
        expect(() => generateCaddyfile(spec({ wsPort: 0 }))).toThrow(/wsPort/);
        expect(() => generateCaddyfile(spec({ adminPort: 70000 }))).toThrow(/adminPort/);
    });
});
