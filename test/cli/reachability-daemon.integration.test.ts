// The whole path from the daemon: it spawns Caddy from the stored config, a js-libp2p client reaches kubo
// through it, and Caddy comes back if it dies and goes away with the daemon.
import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, startPkcDaemonWithDynamicPorts, stopPkcDaemon, waitForCondition, type DynamicDaemonResult } from "../helpers/daemon-helpers.js";
import { startPebble, type RunningPebble } from "../helpers/pebble.js";

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
        child.once("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
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
    const address = () => `/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${peerId}`;

    beforeAll(async () => {
        dataPath = randomDirectory();
        pebble = await startPebble(randomDirectory());
        httpsPort = await allocateFreePort("0.0.0.0");
        env = {
            BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
            BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
            BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT: String(httpsPort),
            BITSOCIAL_TEST_REACHABILITY_HTTP_PORT: String(await allocateFreePort("0.0.0.0"))
        };
        daemon = await startPkcDaemonWithDynamicPorts(
            (e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl],
            () => env
        );
        // The helper stops collecting stdout at the ready banner, and the warning comes right after it.
        daemonStdout = daemon.daemonProcess.capturedStdout!;
        daemon.daemonProcess.stdout!.on("data", (data: Buffer) => (daemonStdout += data.toString()));
    }, 240_000);

    afterAll(async () => {
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
        await pebble?.stop();
    }, 60_000);

    it("says once on stdout at start that browsers cannot reach an unconfigured node", async () => {
        const seen = await waitForCondition(() => daemonStdout.includes("bitsocial reachability setup"), 20_000, 200);
        expect(seen, daemonStdout).toBe(true);
        expect(daemonStdout.match(/Browsers cannot reach this node/g)).toHaveLength(1);
    });

    it("picks up setup on a running daemon and serves a libp2p handshake through its own Caddy", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], { ...env, KUBO_RPC_URL: daemon.kuboRpcUrl, IPFS_GATEWAY_URL: daemon.gatewayUrl });
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
