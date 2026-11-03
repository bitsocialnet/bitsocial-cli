// `reachability setup` end to end against a throwaway daemon: Pebble in place of Let's Encrypt, 127.0.0.1
// in place of a public address. Only an env-gated manual run can prove reachability from the internet.
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, killChildProcess, waitForCondition, startPkcDaemonWithDynamicPorts, stopPkcDaemon, type DynamicDaemonResult } from "../helpers/daemon-helpers.js";
import { startPebble, type RunningPebble } from "../helpers/pebble.js";
import { isTcpPortFree } from "../../src/reachability/discovery.js";
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

// These tests stand in 127.0.0.1 for a public address, and a repo created by the daemon hides loopback through
// Addresses.NoAnnounce. A real public address is not filtered, so this removes the stand-in's only obstacle.
const allowLoopbackAnnounce = async (dataPath: string, kuboApiUrl: string) => {
    const configPath = path.join(dataPath, ".bitsocial-cli.ipfs", "config");
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    config.Addresses.NoAnnounce = (config.Addresses.NoAnnounce ?? []).filter((entry: string) => entry !== "/ip4/127.0.0.0/ipcidr/8");
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    const isUp = async () => Boolean((await fetch(`${kuboApiUrl}/id`, { method: "POST" }).catch(() => undefined))?.ok);
    await fetch(`${kuboApiUrl}/shutdown`, { method: "POST" }).catch(() => {});
    await waitForCondition(async () => !(await isUp()), 15_000, 200);
    if (!(await waitForCondition(isUp, 60_000, 500))) throw new Error("kubo did not come back after the restart");
};

it("--announce with no daemon running is refused before anything changes", { timeout: 60_000 }, async () => {
    const dataPath = randomDirectory();
    const repo = path.join(dataPath, ".bitsocial-cli.ipfs");
    await fs.mkdir(repo, { recursive: true });
    const original = JSON.stringify({ Addresses: { Swarm: [] }, Swarm: { AddrFilters: [] }, AutoTLS: { Enabled: true } });
    await fs.writeFile(path.join(repo, "config"), original);
    const result = await runCli(["reachability", "setup", "--non-interactive", "--announce", "/ip4/93.184.216.34/tcp/443/tls/ws", "--pkcOptions.dataPath", dataPath], {
        KUBO_RPC_URL: `http://127.0.0.1:${await allocateFreePort()}/api/v0`,
        BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: "https://127.0.0.1:9/dir",
        BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1"
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("daemon must be running");
    expect(await fs.readFile(path.join(repo, "config"), "utf-8")).toBe(original);
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
        await allowLoopbackAnnounce(dataPath, daemon.kuboApiUrl);
        httpsPort = await allocateFreePort("0.0.0.0");
        env = {
            KUBO_RPC_URL: daemon.kuboRpcUrl,
            IPFS_GATEWAY_URL: daemon.gatewayUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
            BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
            BITSOCIAL_TEST_REACHABILITY_WS_PORT: String(await allocateFreePort()),
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
        let result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        // Another test file's kubo can take the chosen port before Caddy binds it (see #87). Only that retries.
        for (let attempt = 1; attempt < 3 && /holding TCP 443|address already in use/i.test(`${result.stdout} ${result.stderr}`); attempt++) {
            httpsPort = await allocateFreePort("0.0.0.0");
            env["BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT"] = String(httpsPort);
            result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        }
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

    // Issue #216. These run against real kubo, because /id decides what the check sees.
    describe("when kubo does not announce what setup applied", () => {
        const kuboConfigPath = () => path.join(dataPath, ".bitsocial-cli.ipfs", "config");
        const address = () => `/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`;
        const editKuboConfig = async (edit: (addresses: any) => void) => {
            const config = JSON.parse(await fs.readFile(kuboConfigPath(), "utf-8"));
            edit(config.Addresses);
            await fs.writeFile(kuboConfigPath(), JSON.stringify(config, null, 2));
        };
        const announcedByKubo = async () => {
            const response = await fetch(`${daemon.kuboApiUrl}/id`, { method: "POST" }).catch(() => undefined);
            return response?.ok ? ((await response.json()) as { Addresses: string[] | null }).Addresses ?? [] : undefined;
        };
        const isAnnounced = async () => (await announcedByKubo())?.some((announced) => announced.startsWith(`${address()}/p2p/`)) === true;
        const announceCheck = async () => {
            const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
            return JSON.parse(stdout).checks.find((check: { id: string }) => check.id === "kubo-announce");
        };
        // The daemon's watchdog brings kubo back and it loads the file as it stands now.
        const restartKubo = async () => {
            await fetch(`${daemon.kuboApiUrl}/shutdown`, { method: "POST" }).catch(() => {});
            await waitForCondition(async () => (await announcedByKubo()) === undefined, 15_000, 200);
            expect(await waitForCondition(async () => (await announcedByKubo()) !== undefined, 60_000, 500), "kubo did not come back").toBe(true);
        };
        const enable = async () => {
            const result = await runCli(["reachability", "enable", "--pkcOptions.dataPath", dataPath], env);
            expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
            return result;
        };

        it("real kubo's /id shows the address, and status agrees", async () => {
            expect(await isAnnounced()).toBe(true);
            expect(await announceCheck()).toMatchObject({ status: "ok" });
        });

        it("status fails, and enable repairs, an address removed from kubo's config", async () => {
            await editKuboConfig((addresses) => (addresses.AppendAnnounce = []));
            expect(await announceCheck()).toMatchObject({ status: "fail", fix: expect.stringContaining("reachability enable") });
            await enable();
            expect(JSON.parse(await fs.readFile(kuboConfigPath(), "utf-8")).Addresses.AppendAnnounce).toEqual([address()]);
            expect(await waitForCondition(isAnnounced, 60_000, 500)).toBe(true);
            expect(await announceCheck()).toMatchObject({ status: "ok" });
        });

        it("status fails, and enable restarts kubo, when the config is right but kubo has not loaded it", async () => {
            await editKuboConfig((addresses) => (addresses.AppendAnnounce = []));
            await restartKubo();
            expect(await isAnnounced()).toBe(false);
            await editKuboConfig((addresses) => (addresses.AppendAnnounce = [address()]));
            expect(await announceCheck()).toMatchObject({ status: "fail", fix: expect.stringContaining("reachability enable") });
            await enable();
            expect(await waitForCondition(isAnnounced, 60_000, 500), "enable left kubo running without the address").toBe(true);
            expect(await announceCheck()).toMatchObject({ status: "ok" });
        });

        it("enable says so when kubo still does not announce it, because NoAnnounce hides it", async () => {
            await editKuboConfig((addresses) => (addresses.NoAnnounce = [...(addresses.NoAnnounce ?? []), address()]));
            await restartKubo();
            const { stdout, stderr } = await enable();
            expect(`${stdout} ${stderr}`).toContain("NoAnnounce");
            expect(await announceCheck()).toMatchObject({ status: "fail", fix: expect.stringContaining("NoAnnounce") });
            await editKuboConfig((addresses) => (addresses.NoAnnounce = addresses.NoAnnounce.filter((entry: string) => entry !== address())));
            await enable();
            expect(await waitForCondition(isAnnounced, 60_000, 500)).toBe(true);
        });
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

    it("real kubo announces a domain address the way status expects, so there is no false alarm", async () => {
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        const status = JSON.parse(stdout);
        expect(status.addresses.some((address: string) => address.startsWith("/dns"))).toBe(true);
        expect(status.checks.find((check: { id: string }) => check.id === "kubo-announce")).toMatchObject({ status: "ok" });
    });

    it("a rerun keeps a domain that was forced, since a proxy answers for it", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout).mode).toBe("ip+domain");
    });

    it("a stored domain that went stale does not block repairing the rest", async () => {
        const configPath = path.join(dataPath, "reachability", "config.json");
        const { domainForced: _forced, ...notForced } = JSON.parse(await fs.readFile(configPath, "utf-8"));
        await fs.writeFile(configPath, JSON.stringify(notForced));
        const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stderr).toContain("does not point at this machine");
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout)).toMatchObject({ mode: "ip", addresses: [`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`], domain: "node.test" });
    });

    it("drops our sites from the Caddyfile once another server takes the HTTPS port", async () => {
        // The daemon's own Caddy holds the port until it is disabled.
        expect((await runCli(["reachability", "disable", "--pkcOptions.dataPath", dataPath], env)).exitCode).toBe(0);
        const freed = await waitForCondition(() => isTcpPortFree(httpsPort, "0.0.0.0"), 30_000, 250);
        expect(freed, "the daemon's Caddy did not stop").toBe(true);
        const occupier = net.createServer();
        await new Promise<void>((resolve, reject) => {
            occupier.once("error", reject);
            occupier.listen(httpsPort, "0.0.0.0", () => resolve());
        });
        try {
            const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
            expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(2);
            expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).not.toMatch(/^https:\/\//m);
        } finally {
            await new Promise((resolve) => occupier.close(resolve));
        }
        const restored = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
        expect(restored.exitCode, `${restored.stdout}\n${restored.stderr}`).toBe(0);
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
        await allowLoopbackAnnounce(dataPath, daemon.kuboApiUrl);
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
            BITSOCIAL_TEST_REACHABILITY_WS_PORT: String(await allocateFreePort()),
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
