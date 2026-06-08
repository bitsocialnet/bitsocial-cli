import { Args, Flags, Command } from "@oclif/core";
import { spawn } from "child_process";
import tcpPortUsed from "tcp-port-used";
import { fetchLatestVersion, installGlobal } from "../../../update/npm-registry.js";
import { fastInstallGlobal } from "../../../update/fast-update.js";
import { compareVersions } from "../../../update/semver.js";
import { getAliveDaemonStates, DAEMON_SHUTDOWN_TIMEOUT_MS, type DaemonState } from "../../../common-utils/daemon-state.js";

export default class Install extends Command {
    static override description = "Install a specific version of bitsocial from npm";

    static override args = {
        version: Args.string({
            description: 'Version to install (e.g. "0.19.40" or "latest")',
            required: false,
            default: "latest"
        })
    };

    static override flags = {
        force: Flags.boolean({
            description: "Reinstall even if already on the requested version",
            default: false
        }),
        "restart-daemons": Flags.boolean({
            description: "Stop all running daemons, update, and restart them with the same settings",
            default: true,
            allowNo: true
        })
    };

    static override examples = [
        "bitsocial update install",
        "bitsocial update install latest",
        "bitsocial update install 0.19.40",
        "bitsocial update install --force",
        "bitsocial update install --no-restart-daemons"
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Install);

        // Check for running daemons via state files
        const aliveDaemons = await getAliveDaemonStates();

        if (aliveDaemons.length > 0) {
            if (!flags["restart-daemons"]) {
                this.error(
                    `${aliveDaemons.length} daemon(s) running. Stop them first, then retry.`,
                    { exit: 1 }
                );
            }

            // Stop all running daemons
            for (const d of aliveDaemons) {
                this.log(`Stopping daemon (PID ${d.pid})...`);
                try {
                    process.kill(d.pid, "SIGINT");
                } catch (e) {
                    if ((e as NodeJS.ErrnoException).code === "ESRCH") {
                        this.log(`  PID ${d.pid} already exited.`);
                        continue;
                    }
                    throw e;
                }
            }

            // Wait for each daemon process to fully exit — NOT just for its RPC port to free.
            // The daemon releases its RPC port (daemonServer.destroy()) before it finishes killing
            // its kubo child, so a port-only wait lets us restart while the old kubo still holds the
            // IPFS API port; the new daemon then dies on startup with "IPFS API port already in use"
            // (issue #70). The daemon's exit hook kills kubo before the process exits, so waiting for
            // the PID to disappear guarantees the kubo port is free before we restart.
            for (const d of aliveDaemons) {
                this.log(`Waiting for daemon (PID ${d.pid}) to exit...`);
                const exited = await this._waitForProcessExit(d.pid, DAEMON_SHUTDOWN_TIMEOUT_MS);
                if (!exited) {
                    this.error(
                        `Daemon (PID ${d.pid}) did not shut down within ${DAEMON_SHUTDOWN_TIMEOUT_MS / 1000} seconds.`,
                        { exit: 1 }
                    );
                }
            }
            this.log("All daemons stopped.");
        }

        // Resolve the target version
        let targetVersion: string;
        if (!args.version || args.version === "latest") {
            try {
                targetVersion = await fetchLatestVersion();
            } catch (err) {
                this.error(`Failed to fetch latest version: ${(err as Error).message}`, { exit: 1 });
            }
        } else {
            targetVersion = args.version.replace(/^v/i, "");
        }

        const current = this.config.version;

        // Skip if already on this version (unless --force)
        if (compareVersions(current, targetVersion) === 0 && !flags.force) {
            this.log(`Already on v${current}. Use --force to reinstall.`);
            if (aliveDaemons.length > 0 && flags["restart-daemons"]) {
                // We stopped daemons but don't need to update — restart them
                await this._restartDaemons(aliveDaemons);
            }
            return;
        }

        this.log(`Installing bitsocial-cli@${targetVersion}...`);

        let installed = false;
        if (!flags.force) {
            try {
                installed = await fastInstallGlobal(targetVersion, this.config.root, (msg: string) => this.log(msg));
            } catch {
                installed = false;
            }
        }

        if (!installed) {
            if (!flags.force) {
                this.log("Falling back to full install...");
            }
            try {
                await installGlobal(targetVersion);
            } catch (err) {
                this.error(`Update failed: ${(err as Error).message}`, { exit: 1 });
            }
        }

        this.log(`Installed bitsocial v${targetVersion} (was v${current}).`);

        // Restart daemons with the new binary
        if (aliveDaemons.length > 0 && flags["restart-daemons"]) {
            await this._restartDaemons(aliveDaemons);
            this.log("To see the daemon logs run `bitsocial logs --stdout`");
        }
    }

    /**
     * Poll until the given PID no longer exists (signal 0 throws ESRCH), or the timeout elapses.
     * Returns true if the process exited, false on timeout. EPERM means the process is still alive
     * but owned by another user, so we keep waiting.
     */
    private async _waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                process.kill(pid, 0);
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code === "ESRCH") return true; // no such process — it exited
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        // Final check so a process that exits in the last interval isn't reported as a timeout
        try {
            process.kill(pid, 0);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ESRCH") return true;
        }
        return false;
    }

    private async _restartDaemons(daemons: DaemonState[]): Promise<void> {
        this.log(`Restarting ${daemons.length} daemon(s)...`);

        for (const d of daemons) {
            const argStr = d.argv.length > 0 ? d.argv.join(" ") : "(defaults)";
            this.log(`  Starting daemon with args: ${argStr}`);

            const child = spawn("bitsocial", ["daemon", ...d.argv], {
                detached: true,
                stdio: "ignore"
            });
            child.unref();

            if (!child.pid) {
                this.warn(`Failed to spawn daemon for args: ${argStr}`);
                continue;
            }

            // Wait briefly for the daemon's RPC port to come up
            const url = new URL(d.pkcRpcUrl);
            const port = Number(url.port);
            const started = await tcpPortUsed.waitUntilUsed(port, 500, 30000).then(() => true).catch(() => false);
            if (started) {
                this.log(`  Daemon started (port ${port}).`);
            } else {
                this.warn(`  Daemon may not have started — port ${port} not responding after 30s. Check logs with: bitsocial logs`);
            }
        }

        this.log("Check community status with: bitsocial community list");
        this.log("Check logs with: bitsocial logs");
    }
}
