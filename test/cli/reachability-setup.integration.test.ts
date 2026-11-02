// `reachability setup` end to end against a throwaway daemon: Pebble in place of Let's Encrypt, 127.0.0.1
// in place of a public address. Only an env-gated manual run can prove reachability from the internet.
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, killChildProcess, startPkcDaemonWithDynamicPorts, stopPkcDaemon, type DynamicDaemonResult } from "../helpers/daemon-helpers.js";
import { startPebble, type RunningPebble } from "../helpers/pebble.js";
import { caddyfilePath, ensureCaddyBinary, generateCaddyfile, startCaddy, stopCaddy, waitForCertificates } from "../../src/reachability/caddy.js";

const runCli = (args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        const child = spawn("node", ["./bin/run", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        child.once("error", reject);
        child.once("close", (exitCode) => resolve({ stdout, stderr: stderr.replace(/[\s›]+/g, " "), exitCode }));
    });

describe("bitsocial reachability setup", { timeout: 240_000 }, () => {
    let pebble: RunningPebble;
    let daemon: DynamicDaemonResult;
    let dataPath: string;
    let httpsPort: number;
    let env: Record<string, string>;

    beforeAll(async () => {
        dataPath = randomDirectory();
        pebble = await startPebble(randomDirectory());
        daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl]);
        httpsPort = await allocateFreePort("0.0.0.0");
        env = {
            KUBO_RPC_URL: daemon.kuboRpcUrl,
            IPFS_GATEWAY_URL: daemon.gatewayUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
            BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
            BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT: String(httpsPort),
            BITSOCIAL_TEST_REACHABILITY_HTTP_PORT: String(await allocateFreePort("0.0.0.0"))
        };
    }, 240_000);

    afterAll(async () => {
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
        await pebble?.stop();
    }, 60_000);

    it("issues a certificate, configures kubo and restarts it", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toContain(`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`);
        expect(result.stdout).toContain("Let's Encrypt");
    });

    it("wrote the kubo config, and kubo came back listening on the local ws port", async () => {
        const config = JSON.parse(await fs.readFile(path.join(dataPath, ".bitsocial-cli.ipfs", "config"), "utf-8"));
        expect(config.AutoTLS.Enabled).toBe(false);
        expect(config.Swarm.AddrFilters).not.toContain("/ip4/127.0.0.0/ipcidr/8");
        expect(config.Addresses.AppendAnnounce).toEqual([`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`]);
        const stored = JSON.parse(await fs.readFile(path.join(dataPath, "reachability", "config.json"), "utf-8"));
        const listen = (await (await fetch(`${daemon.kuboApiUrl}/swarm/addrs/listen`, { method: "POST" })).json()) as { Strings: string[] };
        expect(listen.Strings.some((address) => address.includes(`/ip4/127.0.0.1/tcp/${stored.wsPort}/ws`))).toBe(true);
    });

    it("status --json reflects it", async () => {
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        const status = JSON.parse(stdout);
        expect(status).toMatchObject({ configured: true, enabled: true, mode: "ip", addresses: [`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`] });
        expect(status.certificates[0].names).toContain("127.0.0.1");
    });

    it("a rerun neither re-issues nor changes the kubo config", async () => {
        const configPath = path.join(dataPath, ".bitsocial-cli.ipfs", "config");
        const before = await fs.readFile(configPath, "utf-8");
        const status = async () => JSON.parse((await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env)).stdout).certificates;
        const certificatesBefore = await status();
        const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(await fs.readFile(configPath, "utf-8")).toBe(before);
        expect(await status()).toEqual(certificatesBefore);
    });

    it("refuses production Let's Encrypt when CI is set", async () => {
        const { BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: _omit, ...withoutPebble } = env;
        const { BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: _inherited, ...rest } = process.env;
        const child = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
            const proc = spawn("node", ["./bin/run", "reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", randomDirectory()], {
                env: { ...rest, ...withoutPebble, CI: "true" },
                stdio: ["ignore", "ignore", "pipe"]
            });
            let stderr = "";
            proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
            proc.once("close", (code) => resolve({ code, stderr: stderr.replace(/[\s›]+/g, " ") }));
        });
        expect(child.code).not.toBe(0);
        expect(child.stderr).toContain("from CI");
    });

    it("refuses a domain that does not point here, and names the mismatch", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--domain", "does-not-exist.invalid", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("does not point at this machine");
    });

    it("with --force, gets a certificate for the domain and announces it next to the IP", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--force", "--domain", "node.test", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        const status = JSON.parse(stdout);
        expect(status.mode).toBe("ip+domain");
        expect(status.addresses).toEqual([`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`, `/dns4/node.test/tcp/${httpsPort}/tls/ws`]);
        expect(status.certificates.flatMap((certificate: { names: string[] }) => certificate.names).sort()).toEqual(["127.0.0.1", "node.test"]);
    });

    it("a stored domain that went stale does not block repairing the rest", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stderr).toContain("does not point at this machine");
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout)).toMatchObject({ mode: "ip", addresses: [`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`], domain: "node.test" });
    });

    it("rejects an --announce that browsers could not dial", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--announce", "/ip4/127.0.0.1/tcp/4001", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("/tls/ws");
    });
});

// Port 443 taken by the operator's own server: nothing of ours binds it, kubo gets its loopback listener,
// and the operator's proxy is announced only after a real handshake through it.
describe("bitsocial reachability setup behind the operator's proxy", { timeout: 240_000 }, () => {
    let pebble: RunningPebble;
    let daemon: DynamicDaemonResult;
    let dataPath: string;
    let proxyPort: number;
    let proxyAdminPort: number;
    let proxy: ChildProcess | undefined;
    let occupier: net.Server;
    let env: Record<string, string>;

    beforeAll(async () => {
        dataPath = randomDirectory();
        pebble = await startPebble(randomDirectory());
        daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl]);
        const busyPort = await allocateFreePort("0.0.0.0");
        occupier = net.createServer();
        await new Promise<void>((resolve) => occupier.listen(busyPort, "0.0.0.0", () => resolve()));
        env = {
            KUBO_RPC_URL: daemon.kuboRpcUrl,
            IPFS_GATEWAY_URL: daemon.gatewayUrl,
            NODE_EXTRA_CA_CERTS: pebble.issuingRootPath,
            BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
            BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
            BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT: String(busyPort),
            BITSOCIAL_TEST_REACHABILITY_HTTP_PORT: String(await allocateFreePort("0.0.0.0"))
        };
    }, 240_000);

    afterAll(async () => {
        if (proxyAdminPort) await stopCaddy(proxyAdminPort).catch(() => {});
        await killChildProcess(proxy);
        await new Promise((resolve) => occupier?.close(resolve));
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
        await pebble?.stop();
    }, 60_000);

    it("prints a proxy snippet and exits 2 when it cannot ask, with kubo already listening", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--force", "--domain", "node.test", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(2);
        const { wsPort } = JSON.parse(await fs.readFile(path.join(dataPath, "reachability", "config.json"), "utf-8"));
        expect(result.stdout).toContain(`127.0.0.1:${wsPort}`);
        expect(result.stdout).toContain("--announce /dns4/node.test/tcp/443/tls/ws");
    });

    it("refuses --announce when the handshake fails, and announces nothing", async () => {
        const closedPort = await allocateFreePort();
        const result = await runCli(["reachability", "setup", "--non-interactive", "--force", "--announce", `/ip4/127.0.0.1/tcp/${closedPort}/tls/ws`, "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("libp2p handshake");
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout).addresses).toEqual([]);
    });

    it("announces the proxy address once a real handshake through it succeeds", async () => {
        const { wsPort } = JSON.parse(await fs.readFile(path.join(dataPath, "reachability", "config.json"), "utf-8"));
        // The operator's server: an unrelated Caddy with its own certificate, forwarding to kubo.
        const proxyDataPath = randomDirectory();
        proxyPort = await allocateFreePort("0.0.0.0");
        proxyAdminPort = await allocateFreePort();
        await fs.mkdir(path.join(proxyDataPath, "reachability"), { recursive: true });
        await fs.writeFile(
            caddyfilePath(proxyDataPath),
            generateCaddyfile({
                ips: ["127.0.0.1"],
                domains: [],
                wsPort,
                adminPort: proxyAdminPort,
                httpsPort: proxyPort,
                httpPort: await allocateFreePort("0.0.0.0"),
                dataDirectory: path.join(proxyDataPath, "reachability", "caddy-data"),
                acmeDirectory: pebble.directoryUrl,
                acmeTrustedRootsPath: pebble.listenerRootPath
            })
        );
        proxy = startCaddy(proxyDataPath, await ensureCaddyBinary(proxyDataPath));
        expect((await waitForCertificates(proxyDataPath, pebble.directoryUrl, ["127.0.0.1"], 60_000)).missing).toEqual([]);

        const announce = `/ip4/127.0.0.1/tcp/${proxyPort}/tls/ws`;
        const result = await runCli(["reachability", "setup", "--non-interactive", "--force", "--announce", announce, "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toContain("libp2p handshake");
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout)).toMatchObject({ mode: "reverse-proxy", addresses: [announce] });
    });

    it("keeps the verified proxy address on a rerun without the flag", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--force", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout).addresses).toEqual([`/ip4/127.0.0.1/tcp/${proxyPort}/tls/ws`]);
    });
});
