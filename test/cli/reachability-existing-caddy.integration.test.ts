// A real second Caddy on the machine, the operator's own. It must keep running untouched whatever setup does.
import { spawn, type ChildProcess } from "child_process";
import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { allocateFreePort, ensureKuboNodeStopped, killChildProcess, startPkcDaemonWithDynamicPorts, stopPkcDaemon, waitForCondition, type DynamicDaemonResult } from "../helpers/daemon-helpers.js";
import { startPebble, type RunningPebble } from "../helpers/pebble.js";
import { caddyfilePath, ensureCaddyBinary, generateCaddyfile, reloadCaddy, startCaddy, stopCaddy, waitForCertificates } from "../../src/reachability/caddy.js";

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

const adminAlive = async (adminPort: number) => {
    const response = await fetch(`http://127.0.0.1:${adminPort}/config/`, { headers: { Origin: `http://127.0.0.1:${adminPort}` }, signal: AbortSignal.timeout(2000) });
    return response.ok;
};

const startOperatorCaddy = async (caddyfile: string) => {
    const operatorData = randomDirectory();
    await fs.mkdir(path.join(operatorData, "reachability"), { recursive: true });
    await fs.writeFile(caddyfilePath(operatorData), caddyfile);
    return { operatorData, process: startCaddy(operatorData, await ensureCaddyBinary(operatorData)) };
};

describe("another Caddy already holds the HTTPS port, no domain given", { timeout: 300_000 }, () => {
    let pebble: RunningPebble;
    let daemon: DynamicDaemonResult;
    let dataPath: string;
    let operator: ChildProcess | undefined;
    let operatorData: string;
    let operatorAdmin: number;
    let httpsPort: number;
    let httpPort: number;
    let env: Record<string, string>;
    const repoConfig = async () => JSON.parse(await fs.readFile(path.join(dataPath, ".bitsocial-cli.ipfs", "config"), "utf-8"));
    const operatorCaddyfile = (wsPort: number) =>
        generateCaddyfile({
            ips: ["127.0.0.1"],
            domains: [],
            wsPort,
            adminPort: operatorAdmin,
            httpsPort,
            httpPort,
            dataDirectory: path.join(operatorData, "reachability", "caddy-data"),
            acmeDirectory: pebble.directoryUrl,
            acmeTrustedRootsPath: pebble.listenerRootPath
        });
    let before: any;
    let firstRun: { stdout: string; stderr: string; exitCode: number | null };

    beforeAll(async () => {
        dataPath = randomDirectory();
        pebble = await startPebble(randomDirectory());
        [httpsPort, httpPort, operatorAdmin] = await Promise.all([allocateFreePort("0.0.0.0"), allocateFreePort("0.0.0.0"), allocateFreePort()]);
        operatorData = randomDirectory();
        await fs.mkdir(path.join(operatorData, "reachability"), { recursive: true });
        // Forwards nowhere useful yet: this is the operator's server before they know about kubo.
        await fs.writeFile(caddyfilePath(operatorData), operatorCaddyfile(9));
        operator = startCaddy(operatorData, await ensureCaddyBinary(operatorData));
        expect((await waitForCertificates(operatorData, pebble.directoryUrl, ["127.0.0.1"], 60_000)).missing).toEqual([]);

        daemon = await startPkcDaemonWithDynamicPorts((e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl]);
        env = {
            KUBO_RPC_URL: daemon.kuboRpcUrl,
            IPFS_GATEWAY_URL: daemon.gatewayUrl,
            NODE_EXTRA_CA_CERTS: pebble.issuingRootPath,
            BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
            BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
            BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
            BITSOCIAL_TEST_REACHABILITY_WS_PORT: String(await allocateFreePort()),
            BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT: String(httpsPort),
            BITSOCIAL_TEST_REACHABILITY_HTTP_PORT: String(httpPort)
        };
        before = await repoConfig();
        firstRun = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], env);
    }, 300_000);

    afterAll(async () => {
        if (operatorAdmin) await stopCaddy(operatorAdmin).catch(() => {});
        await killChildProcess(operator);
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
        await pebble?.stop();
    }, 60_000);

    it("exits 2, because the operator has to act, and leaves their Caddy running", async () => {
        expect(firstRun.exitCode, `${firstRun.stdout}\n${firstRun.stderr}`).toBe(2);
        expect(await adminAlive(operatorAdmin)).toBe(true);
    });

    it("says what is true: no WSS yet, WebTransport configured", () => {
        expect(firstRun.stderr).not.toContain("Neither WSS nor WebTransport");
        expect(`${firstRun.stdout} ${firstRun.stderr}`).toContain("WebTransport");
    });

    it("prints a block for the operator's Caddy and how to verify it", async () => {
        const { wsPort } = JSON.parse(await fs.readFile(path.join(dataPath, "reachability", "config.json"), "utf-8"));
        expect(firstRun.stdout).toContain(`reverse_proxy 127.0.0.1:${wsPort}`);
        expect(firstRun.stdout).toContain("--announce /ip4/127.0.0.1/tcp/");
    });

    it("touched only the UDP 443 listeners in kubo", async () => {
        const after = await repoConfig();
        const addedSwarm = after.Addresses.Swarm.filter((address: string) => !before.Addresses.Swarm.includes(address));
        expect(addedSwarm.every((address: string) => address.includes("/udp/443/"))).toBe(true);
        expect(addedSwarm.length).toBeGreaterThan(0);
        expect(after.Swarm.AddrFilters).toEqual(before.Swarm.AddrFilters);
        expect(after.AutoTLS).toEqual(before.AutoTLS);
        expect(after.Addresses.AppendAnnounce).toEqual(before.Addresses.AppendAnnounce);
    });

    it("refuses --announce while the operator's Caddy does not reach kubo, and rolls the WSS edits back", async () => {
        const result = await runCli(["reachability", "setup", "--non-interactive", "--announce", `/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`, "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("libp2p handshake");
        const after = await repoConfig();
        expect(after.Swarm.AddrFilters).toEqual(before.Swarm.AddrFilters);
        expect(after.AutoTLS).toEqual(before.AutoTLS);
        expect(after.Addresses.AppendAnnounce).toEqual(before.Addresses.AppendAnnounce);
    });

    it("announces it once the operator adds the printed forward, with a real handshake through their Caddy", async () => {
        const { wsPort } = JSON.parse(await fs.readFile(path.join(dataPath, "reachability", "config.json"), "utf-8"));
        await reloadCaddy(operatorAdmin, operatorCaddyfile(wsPort));
        const announce = `/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws`;
        const result = await runCli(["reachability", "setup", "--non-interactive", "--announce", announce, "--pkcOptions.dataPath", dataPath], env);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        const status = JSON.parse((await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], env)).stdout);
        expect(status).toMatchObject({ mode: "reverse-proxy", addresses: [announce] });
        const after = await repoConfig();
        expect(after.Addresses.Swarm).toContain(`/ip4/127.0.0.1/tcp/${wsPort}/ws`);
        expect(after.Swarm.AddrFilters).not.toContain("/ip4/127.0.0.0/ipcidr/8");
        expect(await adminAlive(operatorAdmin)).toBe(true);
    });
});

// With Pebble really validating: http-01 on the port the other Caddy holds cannot work, so the certificate
// only exists if validation through the HTTPS port succeeded.
describe("another Caddy holds only the HTTP port", { timeout: 300_000 }, () => {
    let pebble: RunningPebble;
    let daemon: DynamicDaemonResult;
    let dataPath: string;
    let operator: ChildProcess | undefined;
    let operatorAdmin: number;
    let httpPort: number;
    let httpsPort: number;
    let env: Record<string, string>;
    let run: { stdout: string; stderr: string; exitCode: number | null };
    let elapsedMs: number;

    beforeAll(async () => {
        dataPath = randomDirectory();
        daemon = await startPkcDaemonWithDynamicPorts(
            (e) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", e.rpcWsUrl],
            () => ({ BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1" })
        );
        [httpPort, operatorAdmin] = await Promise.all([allocateFreePort("0.0.0.0"), allocateFreePort()]);
        const started = await startOperatorCaddy(
            `{\n\tadmin 127.0.0.1:${operatorAdmin}\n\tpersist_config off\n\tauto_https off\n}\n\nhttp://:${httpPort} {\n\trespond "the operator's site"\n}\n`
        );
        operator = started.process;
        const served = await waitForCondition(async () => {
            try {
                return (await (await fetch(`http://127.0.0.1:${httpPort}/`)).text()).includes("the operator's site");
            } catch {
                return false;
            }
        }, 30_000, 200);
        expect(served, "the operator's Caddy did not start").toBe(true);

        // Other test files' kubos bind random ports, so the HTTPS port can be taken between choosing it and
        // Caddy binding it (see #87). Only that retries; anything else fails the test and shows setup's output.
        for (let attempt = 1; ; attempt++) {
            httpsPort = await allocateFreePort("0.0.0.0");
            pebble = await startPebble(randomDirectory(), { validateOn: { httpPort, tlsPort: httpsPort } });
            env = {
                BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY: pebble.directoryUrl,
                BITSOCIAL_TEST_REACHABILITY_ACME_ROOT: pebble.listenerRootPath,
                BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS: "127.0.0.1",
                BITSOCIAL_TEST_REACHABILITY_WS_PORT: String(await allocateFreePort()),
                BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT: String(httpsPort),
                BITSOCIAL_TEST_REACHABILITY_HTTP_PORT: String(httpPort)
            };
            const startedAt = Date.now();
            run = await runCli(["reachability", "setup", "--non-interactive", "--pkcOptions.dataPath", dataPath], { ...env, KUBO_RPC_URL: daemon.kuboRpcUrl, IPFS_GATEWAY_URL: daemon.gatewayUrl });
            elapsedMs = Date.now() - startedAt;
            if (attempt === 3 || !/address already in use/i.test(`${run.stdout} ${run.stderr}`)) break;
            await pebble.stop();
        }
    }, 300_000);

    afterAll(async () => {
        await stopPkcDaemon(daemon?.daemonProcess);
        if (daemon?.kuboApiUrl) await ensureKuboNodeStopped(daemon.kuboApiUrl);
        if (operatorAdmin) await stopCaddy(operatorAdmin).catch(() => {});
        await killChildProcess(operator);
        await pebble?.stop();
    }, 60_000);

    it("gets a certificate by validating through the HTTPS port", async () => {
        expect(run.exitCode, `${run.stdout}\n${run.stderr}`).toBe(0);
        const status = JSON.parse((await runCli(["reachability", "status", "--json", "--pkcOptions.dataPath", dataPath], { ...env, KUBO_RPC_URL: daemon.kuboRpcUrl })).stdout);
        expect(status.mode, `${run.stdout}\n${run.stderr}`).toBe("ip");
        expect(status.certificates[0].names).toContain("127.0.0.1");
    });

    it("finishes well inside the 90 seconds setup allows", () => {
        expect(elapsedMs, `setup took ${elapsedMs} ms`).toBeLessThan(60_000);
    });

    it("warned that HTTP validation is unavailable", () => {
        expect(run.stderr).toMatch(/TCP \d+ is held by|HTTP validation/);
    });

    it("left the operator's site serving", async () => {
        expect(await (await fetch(`http://127.0.0.1:${httpPort}/`)).text()).toContain("the operator's site");
    });

    it("serves a real libp2p handshake through our own Caddy", async () => {
        const script = `
            import { dialWithLibp2p } from "./dist/reachability/libp2p-dial.js";
            try { console.log(JSON.stringify(await dialWithLibp2p(process.argv[1]))); }
            catch (error) { console.log(JSON.stringify({ error: String(error.message) })); }
            process.exit(0);`;
        const kuboConfig = JSON.parse(await fs.readFile(path.join(dataPath, ".bitsocial-cli.ipfs", "config"), "utf-8"));
        const peerId = kuboConfig.Identity.PeerID;
        let last = "";
        const reached = await waitForCondition(
            () =>
                new Promise<boolean>((resolve) => {
                    const child = spawn(process.execPath, ["--input-type=module", "-e", script, `/ip4/127.0.0.1/tcp/${httpsPort}/tls/ws/p2p/${peerId}`], {
                        env: { ...process.env, NODE_EXTRA_CA_CERTS: pebble.issuingRootPath },
                        stdio: ["ignore", "pipe", "ignore"]
                    });
                    let out = "";
                    child.stdout.on("data", (data: Buffer) => (out += data.toString()));
                    child.once("close", () => {
                        last = out;
                        resolve(out.includes(peerId));
                    });
                }),
            60_000,
            1000
        );
        expect(reached, last).toBe(true);
    });
});
