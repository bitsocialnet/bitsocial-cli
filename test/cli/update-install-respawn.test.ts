// `bitsocial update install` must never exit with the daemons it stopped still down.
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
//
// No real daemon or registry: a dummy long-lived process stands in for the daemon (it dies on SIGINT like
// a real one), its state file is seeded in an isolated state dir, npm runs offline with an empty cache so
// every registry call fails fast, and a `bitsocial` shim on PATH records each respawn instead of
// starting a daemon.
//
// Isolation: HOME/XDG_DATA_HOME are overridden for the seeding helper and update install, so the command
// sees only the dummy daemon and never touches real daemons on the machine.

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { describe, it, expect, afterEach } from "vitest";
import { directory as randomDirectory } from "tempy";
import { readFileSync } from "fs";
import fs from "fs/promises";
import net from "net";
import path from "path";
import { pathToFileURL } from "url";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "bin", "run");
const CLI_VERSION = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")).version as string;
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

describe.skipIf(process.platform === "win32")("bitsocial update install — stopped daemons are never left down", () => {
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
});
