// The whole path from the daemon: it spawns Caddy from the stored config, a js-libp2p client reaches kubo
// through it, and Caddy comes back if it dies and goes away with the daemon.
import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import net from "net";
import path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, startPkcDaemonWithDynamicPorts, stopPkcDaemon, waitForCondition, type DynamicDaemonResult } from "../helpers/daemon-helpers.js";
import { startPebble, type RunningPebble } from "../helpers/pebble.js";
import { caddyBinaryPath, caddyfilePath, generateCaddyfile } from "../../src/reachability/caddy.js";
import { acmeIssuerKey, caddyDataDir, reachabilityDir, writeReachabilityConfig } from "../../src/reachability/state.js";

const execFileAsync = promisify(execFile);

const dial = async (address: string, issuingRootPath: string): Promise<{ peerId?: string; error?: string }> => {
    const script = `
        import { dialWithLibp2p } from "./dist/reachability/libp2p-dial.js";
        try { console.log(JSON.stringify(await dialWithLibp2p(process.argv[1]))); }
        catch (error) { console.log(JSON.stringify({ error: String(error.message) })); }
        process.exit(0);`;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script, address], {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: issuingRootPath },
        timeout: 60_000
    });
    return JSON.parse(stdout.trim().split("\n").at(-1)!);
};

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

describe("the daemon keeps a configured node reachable", { timeout: 240_000 }, () => {
    let pebble: RunningPebble;
    let daemon: DynamicDaemonResult;
    let dataPath: string;
    let httpsPort: number;
    let adminPort: number;
    let peerId: string;
    let env: Record<string, string>;
    let daemonStdout = "";
    let touchedBeforeSetup = "";
    const address = () => `/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${peerId}`;

    beforeAll(async () => {
        dataPath = randomDirectory();
        pebble = await startPebble(randomDirectory());
        daemon = await startPkcDaemonWithDynamicPorts(
            (e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl],
            () => ({ BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1" })
        );
        // Chosen after the slow daemon start, to leave other test files' kubos little time to take them (#87).
        httpsPort = await allocateFreePort("0.0.0.0");
        env = {
            BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
            BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
            BITSOCIAL_TEST_REACHABILITY_WS_PORT: String(await allocateFreePort()),
            BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT: String(httpsPort),
            BITSOCIAL_TEST_REACHABILITY_HTTP_PORT: String(await allocateFreePort("0.0.0.0"))
        };
        // The helper stops collecting stdout at the ready banner, and the warning comes right after it.
        daemonStdout = daemon.daemonProcess.capturedStdout!;
        daemon.daemonProcess.stdout!.on("data", (data: Buffer) => (daemonStdout += data.toString()));
    }, 240_000);

    afterAll(async () => {
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
        await pebble?.stop();
    }, 60_000);

    it("says once on stdout at start that AutoTLS may still be coming, rather than that browsers cannot reach the node", async () => {
        const seen = await waitForCondition(() => daemonStdout.includes("AutoTLS may still be getting a certificate"), 20_000, 200);
        expect(seen, daemonStdout).toBe(true);
        expect(daemonStdout.match(/AutoTLS may still be getting a certificate/g)).toHaveLength(1);
        expect(daemonStdout).not.toContain("Browsers cannot reach this node");
    });

    it("picks up setup on a running daemon and serves a libp2p handshake through its own Caddy", async () => {
        const before = JSON.parse(await fs.readFile(path.join(dataPath, ".bitsocial-cli.ipfs", "config"), "utf-8"));
        touchedBeforeSetup = JSON.stringify({ Swarm: before.Addresses.Swarm, AppendAnnounce: before.Addresses.AppendAnnounce, AddrFilters: before.Swarm.AddrFilters, AutoTLS: before.AutoTLS });
        const runSetup = () => runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], { ...env, KUBO_RPC_URL: daemon.kuboRpcUrl, IPFS_GATEWAY_URL: daemon.gatewayUrl });
        let result = await runSetup();
        // Another test file's kubo can take the chosen port before Caddy binds it (see #87). Only that retries.
        for (let attempt = 1; attempt < 3 && /holding TCP 443|address already in use/i.test(`${result.stdout} ${result.stderr}`); attempt++) {
            httpsPort = await allocateFreePort("0.0.0.0");
            env["BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT"] = String(httpsPort);
            result = await runSetup();
        }
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        const stored = JSON.parse(await fs.readFile(path.join(dataPath, "reachability", "config.json"), "utf-8"));
        adminPort = stored.caddyAdminPort;
        const kuboConfig = JSON.parse(await fs.readFile(path.join(dataPath, ".bitsocial-cli.ipfs", "config"), "utf-8"));
        peerId = kuboConfig.Identity.PeerID;

        let outcome: { peerId?: string; error?: string } = {};
        const reached = await waitForCondition(async () => {
            outcome = await dial(address(), pebble.issuingRootPath);
            return outcome.peerId === peerId;
        }, 60_000, 1000);
        expect(reached, JSON.stringify(outcome)).toBe(true);
    });

    it("brings Caddy back when it stops, the same way as kubo", async () => {
        const stop = await fetch(`http://127.0.0.1:${adminPort}/stop`, { method: "POST", headers: { Origin: `http://127.0.0.1:${adminPort}` } });
        expect(stop.ok).toBe(true);
        let outcome: { peerId?: string; error?: string } = {};
        const reached = await waitForCondition(async () => {
            outcome = await dial(address(), pebble.issuingRootPath);
            return outcome.peerId === peerId;
        }, 60_000, 1000);
        expect(reached, JSON.stringify(outcome)).toBe(true);
    });

    it("disable stops serving and restores exactly the kubo fields it touched, and enable brings it back", async () => {
        const cliEnv = { ...env, KUBO_RPC_URL: daemon.kuboRpcUrl, IPFS_GATEWAY_URL: daemon.gatewayUrl };
        const kuboConfigPath = path.join(dataPath, ".bitsocial-cli.ipfs", "config");
        const touched = async () => {
            const { Addresses, Swarm, AutoTLS } = JSON.parse(await fs.readFile(kuboConfigPath, "utf-8"));
            return JSON.stringify({ Swarm: Addresses.Swarm, AppendAnnounce: Addresses.AppendAnnounce, AddrFilters: Swarm.AddrFilters, AutoTLS });
        };
        const whileEnabled = await touched();

        const disabled = await runCli(["reachability", "disable", "--pkcOptions.dataPath", dataPath], cliEnv);
        expect(disabled.exitCode, `${disabled.stdout}\n${disabled.stderr}`).toBe(0);
        expect(await touched()).toBe(touchedBeforeSetup);
        const caddyGone = await waitForCondition(async () => (await dial(address(), pebble.issuingRootPath)).error !== undefined, 30_000, 1000);
        expect(caddyGone).toBe(true);
        const status = JSON.parse((await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], cliEnv)).stdout);
        expect(status).toMatchObject({ configured: true, enabled: false, addresses: [] });
        expect(status.certificates).toHaveLength(1);

        const certificatesBefore = status.certificates;
        const enabled = await runCli(["reachability", "enable", "--pkcOptions.dataPath", dataPath], cliEnv);
        expect(enabled.exitCode, `${enabled.stdout}\n${enabled.stderr}`).toBe(0);
        expect(await touched()).toBe(whileEnabled);
        const statusAfter = JSON.parse((await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], cliEnv)).stdout);
        expect(statusAfter.certificates, "enable must reuse the certificate, not spend rate limit").toEqual(certificatesBefore);
        let outcome: { peerId?: string; error?: string } = {};
        const reached = await waitForCondition(async () => {
            outcome = await dial(address(), pebble.issuingRootPath);
            return outcome.peerId === peerId;
        }, 60_000, 1000);
        expect(reached, JSON.stringify(outcome)).toBe(true);
    });

    // A reload keeps serving the old CA's cached certificate and orders nothing, as a live move from
    // Let's Encrypt staging to production showed. Moving CA has to restart Caddy.
    it("moving to another CA on a running daemon obtains a certificate from it", async () => {
        const secondCa = await startPebble(randomDirectory());
        try {
            const cliEnv = { ...env, KUBO_RPC_URL: daemon.kuboRpcUrl, IPFS_GATEWAY_URL: daemon.gatewayUrl, BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: secondCa.directoryUrl };
            const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], cliEnv);
            expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
            const status = JSON.parse((await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], cliEnv)).stdout);
            expect(status.addresses, `${result.stdout}\n${result.stderr}`).toEqual([`/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`]);
            expect(status.certificates.map((certificate: { issuer: string }) => certificate.issuer)).toEqual([acmeIssuerKey(secondCa.directoryUrl)]);
            let outcome: { peerId?: string; error?: string } = {};
            const reached = await waitForCondition(async () => {
                outcome = await dial(address(), secondCa.issuingRootPath);
                return outcome.peerId === peerId;
            }, 60_000, 1000);
            expect(reached, JSON.stringify(outcome)).toBe(true);
        } finally {
            await secondCa.stop();
        }
    });

    it("stops Caddy when the daemon shuts down", async () => {
        await stopPkcDaemon(daemon.daemonProcess);
        const gone = await waitForCondition(async () => {
            try {
                await fetch(`http://127.0.0.1:${adminPort}/config/`, { headers: { Origin: `http://127.0.0.1:${adminPort}` }, signal: AbortSignal.timeout(1000) });
                return false;
            } catch {
                return true;
            }
        }, 20_000, 250);
        expect(gone).toBe(true);
    });
});

// GitHub being slow or unreachable must not cost the node its kubo watchdog: the first Caddy start can spend up
// to 15 minutes downloading after an upgrade that changes CADDY_VERSION.
it("keeps kubo up while the Caddy download is stalled", { timeout: 180_000 }, async () => {
    const dataPath = randomDirectory();
    const adminPort = await allocateFreePort();
    const acmeDirectory = "https://127.0.0.1:9/dir";
    await fs.mkdir(reachabilityDir(dataPath), { recursive: true });
    await writeReachabilityConfig(dataPath, { version: 1, enabled: true, mode: "ip", wsPort: await allocateFreePort(), announce: [], publicIps: ["127.0.0.1"], staging: false, acmeDirectory, caddyAdminPort: adminPort });
    await fs.writeFile(caddyfilePath(dataPath), generateCaddyfile({ ips: ["127.0.0.1"], domains: [], wsPort: 4002, adminPort, dataDirectory: caddyDataDir(dataPath), acmeDirectory }));
    // In a data: URL because NODE_OPTIONS splits on spaces and a file path can hold one.
    const stallCaddyDownload = `const real = globalThis.fetch; globalThis.fetch = (url, init) => String(url).includes("caddyserver/caddy/releases") ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))) : real(url, init);`;
    let daemon: DynamicDaemonResult | undefined;
    try {
        daemon = await startPkcDaemonWithDynamicPorts(
            (e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl],
            () => ({ NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(stallCaddyDownload)}` })
        );
        const { kuboApiUrl, kuboPort } = daemon;
        const kuboAnswers = () => fetch(`${kuboApiUrl}/bitswap/stat`, { method: "POST" }).then((response) => response.ok, () => false);
        expect(await waitForCondition(kuboAnswers, 45_000, 250), "kubo did not start").toBe(true);
        await fetch(`${kuboApiUrl}/shutdown`, { method: "POST" }).catch(() => {});
        expect(await waitForCondition(async () => !(await kuboAnswers()), 10_000, 100), "kubo did not stop").toBe(true);
        // Makes the restart on kubo's exit fail, so that only the watchdog interval can bring it back.
        const blocker = net.createServer((socket) => socket.destroy());
        await new Promise<void>((resolve, reject) => {
            blocker.once("error", reject);
            blocker.listen(kuboPort, "127.0.0.1", () => resolve());
        });
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await new Promise((resolve) => blocker.close(resolve));

        expect(await waitForCondition(kuboAnswers, 30_000, 500), "the daemon did not bring kubo back").toBe(true);
        await expect(fs.access(caddyBinaryPath(dataPath)), "the download was meant to still be stalled").rejects.toThrow();

        // A clean stop, which must not wait for the download either. The helper below would force it after 5 s.
        daemon.daemonProcess.kill();
        const exited = await waitForCondition(() => daemon!.daemonProcess.exitCode !== null || daemon!.daemonProcess.signalCode !== null, 30_000, 250);
        expect(exited, "the daemon did not stop while the download was stalled").toBe(true);
    } finally {
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
    }
});

describe("reachability enable and disable without a daemon", { timeout: 120_000 }, () => {
    const dataPathWithConfig = async (announce: string[]) => {
        const dataPath = randomDirectory();
        const repo = path.join(dataPath, ".bitsocial-cli.ipfs");
        await fs.mkdir(repo, { recursive: true });
        await fs.writeFile(path.join(repo, "config"), JSON.stringify({ Addresses: { Swarm: [] }, Swarm: { AddrFilters: [] }, AutoTLS: { Enabled: true } }));
        await fs.mkdir(path.join(dataPath, "reachability"), { recursive: true });
        await fs.writeFile(
            path.join(dataPath, "reachability", "config.json"),
            JSON.stringify({ version: 1, enabled: true, mode: "ip", wsPort: 4002, announce, publicIps: [], staging: false, acmeDirectory: "https://acme-staging-v02.api.letsencrypt.org/directory", caddyAdminPort: await allocateFreePort() })
        );
        return dataPath;
    };
    // A dead port, so these commands cannot find or touch any kubo that is running on this machine.
    const offlineEnv = async () => ({ KUBO_RPC_URL: `http://127.0.0.1:${await allocateFreePort()}/api/v0` });

    it("enable refuses before setup, and names the command", async () => {
        const result = await runCli(["reachability", "enable", "--pkcOptions.dataPath", randomDirectory()], await offlineEnv());
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("has not been set up");
    });

    it("disable says there is nothing to do before setup", async () => {
        const result = await runCli(["reachability", "disable", "--pkcOptions.dataPath", randomDirectory()], await offlineEnv());
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Nothing to disable");
    });

    it("disable twice is safe", async () => {
        const dataPath = await dataPathWithConfig([]);
        const env = await offlineEnv();
        expect((await runCli(["reachability", "disable", "--pkcOptions.dataPath", dataPath], env)).exitCode).toBe(0);
        const again = await runCli(["reachability", "disable", "--pkcOptions.dataPath", dataPath], env);
        expect(again.exitCode).toBe(0);
        expect(again.stdout).toContain("already disabled");
    });

    it("--purge moves the state, including the ACME account, to a timestamped backup", async () => {
        const dataPath = await dataPathWithConfig([]);
        const account = path.join(dataPath, "reachability", "caddy-data", "acme", "account.key");
        await fs.mkdir(path.dirname(account), { recursive: true });
        await fs.writeFile(account, "account");
        const env = await offlineEnv();
        const result = await runCli(["reachability", "disable", "--purge", "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        const entries = await fs.readdir(dataPath);
        expect(entries).not.toContain("reachability");
        const backup = entries.find((entry) => entry.startsWith("reachability.bak-"));
        expect(backup, entries.join()).toMatch(/^reachability\.bak-\d{4}-\d{2}-\d{2}T[\d-]+Z$/);
        expect(await fs.readFile(path.join(dataPath, backup!, "caddy-data", "acme", "account.key"), "utf-8")).toBe("account");
        const { stdout } = await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env);
        expect(JSON.parse(stdout).configured).toBe(false);
    });
});
