// The real chain, on every OS CI runs: Caddy downloaded and hash-checked for this platform, a certificate
// for 127.0.0.1 from Pebble, and a js-libp2p client completing its handshake with kubo through Caddy.
import { execFile, spawn, type ChildProcess } from "child_process";
import { X509Certificate } from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { path as resolveKuboBinary } from "kubo";
import { allocateFreePort, killChildProcess, waitForCondition } from "../helpers/daemon-helpers.js";
import { preInitKuboWithEphemeralSwarm } from "../helpers/kubo-helpers.js";
import { startPebble, type RunningPebble } from "../helpers/pebble.js";
import { caddyfilePath, ensureCaddyBinary, generateCaddyfile, reloadCaddy, startCaddy, stopCaddy, waitForCertificates } from "../../src/reachability/caddy.js";
import { computeKuboConfig } from "../../src/reachability/kubo-config.js";
import { caddyDataDir, readIssuedCertificates, reachabilityDir } from "../../src/reachability/state.js";

const execFileAsync = promisify(execFile);

// A separate process, because NODE_EXTRA_CA_CERTS is read at startup and this is the way to make the
// global WebSocket that libp2p uses trust Pebble. It runs the same dial code setup will run.
const dialInChildProcess = async (address: string, issuingRootPath?: string): Promise<{ peerId?: string; error?: string }> => {
    const script = `
        import { dialWithLibp2p } from "./dist/reachability/libp2p-dial.js";
        try { console.log(JSON.stringify(await dialWithLibp2p(process.argv[1]))); }
        catch (error) { console.log(JSON.stringify({ error: String(error.message) })); }
        process.exit(0);`;
    const { NODE_EXTRA_CA_CERTS: _unset, ...baseEnv } = process.env;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script, address], {
        env: { ...baseEnv, ...(issuingRootPath ? { NODE_EXTRA_CA_CERTS: issuingRootPath } : {}) },
        timeout: 60_000
    });
    return JSON.parse(stdout.trim().split("\n").at(-1)!);
};

describe("Caddy, Pebble and kubo", { timeout: 240_000 }, () => {
    let pebble: RunningPebble;
    let caddy: ChildProcess | undefined;
    let kubo: ChildProcess | undefined;
    let dataPath: string;
    let adminPort: number;
    let httpsPort: number;
    let wsPort: number;
    let kuboApiUrl: string;
    let peerId: string;
    let caddyOutput = "";
    let caddyfile: string;

    beforeAll(async () => {
        dataPath = randomDirectory();
        pebble = await startPebble(randomDirectory());
        [adminPort, httpsPort, wsPort] = await Promise.all([allocateFreePort(), allocateFreePort("0.0.0.0"), allocateFreePort()]);
        const [apiPort, gatewayPort] = await Promise.all([allocateFreePort(), allocateFreePort()]);
        kuboApiUrl = `http://127.0.0.1:${apiPort}/api/v0`;

        const repo = path.join(dataPath, ".bitsocial-cli.ipfs");
        await preInitKuboWithEphemeralSwarm(repo, new URL(kuboApiUrl), new URL(`http://127.0.0.1:${gatewayPort}`));
        const configPath = path.join(repo, "config");
        const edited = computeKuboConfig(JSON.parse(await fs.readFile(configPath, "utf-8")), { wsPort, announce: [] }, true);
        // Only the loopback ws listener: the shared UDP 443 ones cannot bind unprivileged on Linux CI.
        edited.Addresses.Swarm = [`/ip4/127.0.0.1/tcp/${wsPort}/ws`];
        await fs.writeFile(configPath, JSON.stringify(edited, null, 4));
        peerId = edited.Identity.PeerID;
        kubo = spawn(await resolveKuboBinary(), ["daemon"], { env: { ...process.env, IPFS_PATH: repo }, stdio: "ignore" });
        const kuboUp = await waitForCondition(async () => {
            try {
                return (await fetch(`${kuboApiUrl}/id`, { method: "POST" })).ok;
            } catch {
                return false;
            }
        }, 60_000, 250);
        expect(kuboUp, "kubo did not start").toBe(true);

        const binaryPath = await ensureCaddyBinary(dataPath);
        caddyfile = generateCaddyfile({
            ips: ["127.0.0.1"],
            domains: [],
            wsPort,
            adminPort,
            httpsPort,
            httpPort: await allocateFreePort("0.0.0.0"),
            dataDirectory: caddyDataDir(dataPath),
            acmeDirectory: pebble.directoryUrl,
            acmeTrustedRootsPath: pebble.listenerRootPath
        });
        await fs.mkdir(reachabilityDir(dataPath), { recursive: true });
        await fs.writeFile(caddyfilePath(dataPath), caddyfile);
        caddy = startCaddy(dataPath, binaryPath, (line) => (caddyOutput += line));
    }, 240_000);

    afterAll(async () => {
        if (adminPort) await stopCaddy(adminPort).catch(() => {});
        await killChildProcess(caddy);
        if (kuboApiUrl) await fetch(`${kuboApiUrl}/shutdown`, { method: "POST" }).catch(() => {});
        await killChildProcess(kubo);
        await pebble?.stop();
    }, 60_000);

    it("issues a shortlived certificate covering 127.0.0.1", async () => {
        const result = await waitForCertificates(dataPath, ["127.0.0.1"], 60_000);
        expect(result.missing, caddyOutput).toEqual([]);
        const [certificate] = await readIssuedCertificates(dataPath);
        expect(certificate!.names).toContain("127.0.0.1");
        expect(certificate!.hoursLeft).toBeGreaterThan(100);
        expect(certificate!.hoursLeft).toBeLessThanOrEqual(160);
    });

    it("stored a parseable certificate, not only the status summary", async () => {
        const entries = await fs.readdir(path.join(caddyDataDir(dataPath), "certificates"), { recursive: true, withFileTypes: true });
        const file = entries.find((entry) => entry.name.endsWith(".crt"))!;
        const certificate = new X509Certificate(await fs.readFile(path.join(file.parentPath, file.name)));
        expect(certificate.checkIP("127.0.0.1")).toBe("127.0.0.1");
    });

    it("completes a js-libp2p handshake with kubo through Caddy", async () => {
        const result = await dialInChildProcess(`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${peerId}`, pebble.issuingRootPath);
        expect(result, caddyOutput).toEqual({ peerId });
    });

    it("refuses the dial when the certificate's CA is not trusted", async () => {
        const result = await dialInChildProcess(`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${peerId}`);
        expect(result.error).toBeTruthy();
    });

    it("refuses the dial when the node is not the peer we expected", async () => {
        const someoneElse = "12D3KooWHFrmLWTTDD4NodngtRMEVYgxrLDNS3uwHkpTKm5PkvY7";
        const result = await dialInChildProcess(`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${someoneElse}`, pebble.issuingRootPath);
        expect(result.error).toBeTruthy();
    });

    it("binds no UDP socket on the HTTPS port, which kubo needs for WebTransport", async () => {
        const dgram = await import("dgram");
        const socket = dgram.createSocket("udp4");
        await new Promise<void>((resolve, reject) => {
            socket.once("error", reject);
            socket.bind(httpsPort, "0.0.0.0", () => resolve());
        });
        await new Promise<void>((resolve) => socket.close(() => resolve()));
    });

    it("reloads through the admin API without re-issuing", async () => {
        const before = await readIssuedCertificates(dataPath);
        await reloadCaddy(adminPort, caddyfile);
        expect(await readIssuedCertificates(dataPath)).toEqual(before);
        const result = await dialInChildProcess(`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${peerId}`, pebble.issuingRootPath);
        expect(result, caddyOutput).toEqual({ peerId });
    });

    it("stops through the admin API", async () => {
        await stopCaddy(adminPort);
        const exited = await waitForCondition(() => caddy!.exitCode !== null || caddy!.signalCode !== null, 15_000, 100);
        expect(exited).toBe(true);
    });
});
