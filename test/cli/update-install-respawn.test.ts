// `bitsocial update install` must never exit with the daemons it stopped still down, and must bring each
// one back as it was started.
//
// Once update install stops an unsupervised daemon, that daemon deletes its own state file on shutdown,
// so its args exist only in the updater's memory. Before the fix, the updater stopped the daemons first
// and only then resolved the target version and installed it: an offline registry or a failed
// `npm install -g` exited with the daemons down, and a retry found no state files, so it restarted
// nothing. A run already on the target version also stopped and re-spawned every daemon, though it
// installed nothing.
//
// The respawn tests use `--force`, which skips the fast update and goes straight to `npm install -g`;
// with npm offline it fails, so they drive stop, failed install and respawn without installing anything.
// The one test that needs a successful update points npm at a fake registry on localhost instead.
//
// No real daemon or registry: a dummy long-lived process stands in for the daemon (it dies on SIGINT like
// a real one), its state file is seeded in an isolated state dir, npm runs offline with an empty cache so
// every registry call fails fast, and a `bitsocial` shim on PATH records each respawn instead of
// starting a daemon.
//
// Isolation: HOME/XDG_DATA_HOME are overridden for the seeding helper and update install, so the command
// sees only the dummy daemon and never touches real daemons on the machine.

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { describe, it, expect, afterEach } from "vitest";
import { directory as randomDirectory } from "tempy";
import { readFileSync, realpathSync } from "fs";
import fs from "fs/promises";
import http from "http";
import net from "net";
import path from "path";
import { pathToFileURL } from "url";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "bin", "run");
const CLI_VERSION = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")).version as string;
const PACKAGE_NAME = "@bitsocial/bitsocial-cli";
/** The version the fake registry serves; never published, so nothing real can be installed by mistake. */
const FAKE_VERSION = "0.0.0-respawn-test";
const DAEMON_STATE_MODULE = pathToFileURL(path.join(REPO_ROOT, "dist", "common-utils", "daemon-state.js")).href;

const isPidAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isPidAlive(pid)) return true;
        await new Promise((r) => setTimeout(r, 100));
    }
    return !isPidAlive(pid);
};

interface Harness {
    env: Record<string, string>;
    tmpBin: string;
    respawnMarker: string;
    rpcPort: number;
}

describe.skipIf(process.platform === "win32")("bitsocial update install — re-spawning the daemons it stopped", () => {
    const dummies: ChildProcess[] = [];
    const servers: net.Server[] = [];

    afterEach(async () => {
        for (const dummy of dummies.splice(0)) {
            if (dummy.pid && isPidAlive(dummy.pid)) {
                try {
                    process.kill(dummy.pid, "SIGKILL");
                } catch {
                    /* already gone */
                }
            }
        }
        await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    });

    async function setupHarness(): Promise<Harness> {
        const isolatedHome = randomDirectory();
        const tmpBin = randomDirectory();
        const npmDir = randomDirectory();
        const respawnMarker = path.join(randomDirectory(), "bitsocial.calls");

        // A `bitsocial` shim recording each respawn (args, working directory and the env the daemon reads).
        const shim = path.join(tmpBin, "bitsocial");
        await fs.writeFile(
            shim,
            [
                "#!/bin/sh",
                `{`,
                `  echo "args=$*"`,
                `  echo "cwd=$(pwd -P)"`,
                `  echo "IPFS_PATH=\${IPFS_PATH-<unset>}"`,
                `  echo "KUBO_RPC_URL=\${KUBO_RPC_URL-<unset>}"`,
                `  echo "IPFS_GATEWAY_URL=\${IPFS_GATEWAY_URL-<unset>}"`,
                `} >> "${respawnMarker}"`,
                "exit 0"
            ].join("\n") + "\n"
        );
        await fs.chmod(shim, 0o755);

        // Something listening on the daemon's RPC port, so the respawn's "port came up" wait returns at once.
        const server = net.createServer();
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const rpcPort = (server.address() as net.AddressInfo).port;

        const env: Record<string, string> = {
            HOME: isolatedHome,
            XDG_DATA_HOME: path.join(isolatedHome, ".local", "share"),
            PATH: `${tmpBin}:${process.env["PATH"]}`,
            // Every registry call fails fast and nothing can be installed for real.
            npm_config_offline: "true",
            npm_config_cache: path.join(npmDir, "cache"),
            npm_config_prefix: path.join(npmDir, "prefix"),
            npm_config_update_notifier: "false"
        };
        return { env, tmpBin, respawnMarker, rpcPort };
    }

    /** Start a dummy daemon (no SIGINT handler, so SIGINT kills it) and seed its unsupervised state file. */
    async function startDummyDaemon(h: Harness, extraState: Record<string, unknown> = {}): Promise<number> {
        const dummy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" });
        dummies.push(dummy);
        await new Promise((r) => setTimeout(r, 200));
        const pid = dummy.pid!;
        expect(isPidAlive(pid)).toBe(true);

        const seed = path.join(h.tmpBin, "seed-state.mjs");
        await fs.writeFile(
            seed,
            [
                `const mod = await import(${JSON.stringify(DAEMON_STATE_MODULE)});`,
                `await mod.writeDaemonState(JSON.parse(process.env.SEED_STATE));`
            ].join("\n")
        );
        const seedResult = spawnSync(process.execPath, [seed], {
            env: {
                ...process.env,
                ...h.env,
                SEED_STATE: JSON.stringify({
                    pid,
                    startedAt: new Date().toISOString(),
                    argv: ["--pkcRpcUrl", `ws://localhost:${h.rpcPort}`],
                    pkcRpcUrl: `ws://localhost:${h.rpcPort}`,
                    ...extraState
                })
            },
            encoding: "utf-8"
        });
        expect(seedResult.status, `seed stderr: ${seedResult.stderr}`).toBe(0);
        return pid;
    }

    const runUpdateInstall = (
        args: string[],
        env: Record<string, string>,
        cwd: string = REPO_ROOT
    ): Promise<{ exitCode: number | null; output: string }> =>
        new Promise((resolve, reject) => {
            const proc = spawn(process.execPath, [CLI_PATH, "update", "install", ...args], {
                cwd,
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, ...env }
            });
            let output = "";
            proc.stdout.on("data", (d) => (output += d.toString()));
            proc.stderr.on("data", (d) => (output += d.toString()));
            proc.on("error", reject);
            proc.on("close", (exitCode) => resolve({ exitCode, output }));
        });

    /**
     * A registry on localhost that serves one fake @bitsocial/bitsocial-cli version (a bare package.json),
     * so `npm install -g` succeeds without the network and installs only into the harness's npm prefix.
     */
    async function startFakeRegistry(version: string): Promise<string> {
        const pkgRoot = randomDirectory();
        await fs.mkdir(path.join(pkgRoot, "package"));
        await fs.writeFile(path.join(pkgRoot, "package", "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
        const tarballPath = path.join(pkgRoot, "package.tgz");
        const tar = spawnSync("tar", ["-czf", tarballPath, "-C", pkgRoot, "package"], {
            env: { ...process.env, COPYFILE_DISABLE: "1" },
            encoding: "utf-8"
        });
        expect(tar.status, `tar stderr: ${tar.stderr}`).toBe(0);
        const tarball = await fs.readFile(tarballPath);

        let packument = "";
        const server = http.createServer((req, res) => {
            if (req.url?.endsWith(".tgz")) {
                res.writeHead(200, { "content-type": "application/octet-stream" });
                res.end(tarball);
            } else {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(packument);
            }
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const registry = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;
        packument = JSON.stringify({
            name: PACKAGE_NAME,
            "dist-tags": { latest: version },
            versions: {
                [version]: {
                    name: PACKAGE_NAME,
                    version,
                    dist: {
                        tarball: `${registry}package.tgz`,
                        integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
                        shasum: createHash("sha1").update(tarball).digest("hex")
                    }
                }
            }
        });
        return registry;
    }

    const readRespawns = async (marker: string): Promise<string[]> =>
        (await fs.readFile(marker, "utf-8").catch(() => ""))
            .split("\n")
            .filter((line) => line.startsWith("args="));

    /** The shim runs detached, so it may write its record after update install has exited. */
    const waitForRespawns = async (marker: string, count: number, timeoutMs = 10000): Promise<string[]> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const respawns = await readRespawns(marker);
            if (respawns.length >= count) return respawns;
            await new Promise((r) => setTimeout(r, 100));
        }
        return readRespawns(marker);
    };

    it("does not stop or re-spawn any daemon when already on the target version", { timeout: 60000 }, async () => {
        const h = await setupHarness();
        const pid = await startDummyDaemon(h);

        const result = await runUpdateInstall([CLI_VERSION], h.env);

        expect(result.exitCode, result.output).toBe(0);
        expect(result.output).toContain(`Already on v${CLI_VERSION}`);
        // Before the fix the daemon was SIGINT'd before the version check, then re-spawned: every daemon
        // bounced although nothing was installed.
        expect(result.output).not.toContain("Stopping daemon");
        expect(isPidAlive(pid), result.output).toBe(true);
        expect(await waitForRespawns(h.respawnMarker, 1, 2000)).toEqual([]);
    });

    it("does not stop any daemon when the latest version cannot be resolved (offline registry)", { timeout: 60000 }, async () => {
        const h = await setupHarness();
        const pid = await startDummyDaemon(h);

        const result = await runUpdateInstall([], h.env);

        expect(result.exitCode, result.output).toBe(1);
        expect(result.output).toContain("Failed to fetch latest version");
        // Before the fix the daemon was SIGINT'd before the version lookup and never restarted.
        expect(isPidAlive(pid), result.output).toBe(true);
        expect(await readRespawns(h.respawnMarker)).toEqual([]);
    });

    it("re-spawns the stopped daemons when the install fails", { timeout: 60000 }, async () => {
        const h = await setupHarness();
        const pid = await startDummyDaemon(h);

        // --force skips the fast path and goes straight to `npm install -g`, which fails offline.
        const result = await runUpdateInstall(["0.0.0-nonexistent-test", "--force"], h.env);

        expect(result.exitCode, result.output).toBe(1);
        expect(result.output).toContain("Update failed");
        // The daemon was stopped for the binary swap...
        expect(await waitForExit(pid, 5000)).toBe(true);
        // ...and must have been brought back with its original args before the command failed.
        expect(await waitForRespawns(h.respawnMarker, 1), result.output).toEqual([`args=daemon --pkcRpcUrl ws://localhost:${h.rpcPort}`]);
    });

    // The state file used to record argv only, and the respawn inherited the updater's cwd and env. A
    // daemon started with IPFS_PATH or KUBO_RPC_URL (or a relative --pkcOptions.dataPath) and updated
    // from another shell came back on the default kubo repo or endpoint while the update reported success.
    it("re-spawns the daemon in its recorded working directory and kubo environment, not the updater's", { timeout: 60000 }, async () => {
        const h = await setupHarness();
        const daemonCwd = randomDirectory();
        await startDummyDaemon(h, {
            cwd: daemonCwd,
            env: { IPFS_PATH: path.join(daemonCwd, "ipfs-repo"), KUBO_RPC_URL: "http://127.0.0.1:5001/api/v0" }
        });

        // The updater runs from another directory, with a different kubo endpoint and a gateway the daemon never had.
        const result = await runUpdateInstall(
            [CLI_VERSION, "--force"],
            { ...h.env, KUBO_RPC_URL: "http://127.0.0.1:59999/api/v0", IPFS_GATEWAY_URL: "http://127.0.0.1:58888" },
            randomDirectory()
        );

        expect(result.exitCode, result.output).toBe(1);
        expect(await waitForRespawns(h.respawnMarker, 1), result.output).toHaveLength(1);
        const record = (await fs.readFile(h.respawnMarker, "utf-8")).split("\n");
        expect(record).toContain(`cwd=${realpathSync(daemonCwd)}`);
        expect(record).toContain(`IPFS_PATH=${path.join(daemonCwd, "ipfs-repo")}`);
        expect(record).toContain("KUBO_RPC_URL=http://127.0.0.1:5001/api/v0");
        expect(record).toContain("IPFS_GATEWAY_URL=<unset>");
    });

    // The respawn used to check only `child.pid` and leave the child's 'error' event unhandled. With
    // `bitsocial` missing from PATH it warned for every daemon, then died with an unhandled-error stack
    // trace and exit 1 as soon as the event loop yielded, even after a successful update. Whatever the
    // updater still had to do after that yield, such as a later respawn or a supervisor restart, was cut off.
    it("finishes a successful update with one warning per daemon when `bitsocial` cannot be spawned", { timeout: 60000 }, async () => {
        const h = await setupHarness();
        await startDummyDaemon(h);
        await startDummyDaemon(h);
        const registry = await startFakeRegistry(FAKE_VERSION);

        // --force goes straight to `npm install -g`, which installs the fake package into the harness's npm
        // prefix. No `bitsocial` on PATH: every respawn fails with ENOENT.
        const result = await runUpdateInstall([FAKE_VERSION, "--force"], {
            ...h.env,
            PATH: randomDirectory(),
            npm_config_offline: "false",
            npm_config_registry: registry,
            npm_config_audit: "false",
            npm_config_fund: "false"
        });

        expect(result.output).toContain(`Installed bitsocial v${FAKE_VERSION}`);
        expect(result.output.match(/Failed to spawn daemon/g), result.output).toHaveLength(2);
        // No uncaught spawn error: no stack trace, and the update exits 0.
        expect(result.output).not.toMatch(/^\s+at /m);
        expect(result.exitCode, result.output).toBe(0);
    });
});
