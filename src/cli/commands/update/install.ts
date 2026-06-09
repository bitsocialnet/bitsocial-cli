import { Args, Flags, Command } from "@oclif/core";
import { spawn } from "child_process";
import tcpPortUsed from "tcp-port-used";
import { fetchLatestVersion, installGlobal } from "../../../update/npm-registry.js";
import { fastInstallGlobal } from "../../../update/fast-update.js";
import { compareVersions } from "../../../update/semver.js";
import { systemctlRestart } from "../../../update/systemctl.js";
import {
    getAliveDaemonStates,
    resolveDaemonSupervisor,
    DAEMON_SHUTDOWN_TIMEOUT_MS,
    type DaemonSupervisor
} from "../../../common-utils/daemon-state.js";
import {
    planDaemonRestarts,
    stopUnmanagedDaemons,
    startUnmanagedDaemons,
    restartManagedDaemons,
    type DaemonLifecycle
} from "../../../update/restart-orchestration.js";

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

        // Discover running daemons and split them into supervisor-managed vs. updater-managed (issue #82).
        // Supervised daemons (e.g. systemd) are restarted through their supervisor; spawning a detached
        // replacement ourselves would create a process the supervisor doesn't own that competes with it
        // for the RPC port and triggers a restart loop.
        const aliveDaemons = await getAliveDaemonStates();
        const plan = await planDaemonRestarts(aliveDaemons, (d) => resolveDaemonSupervisor(d));
        const lifecycle = this._daemonLifecycle();

        if (aliveDaemons.length > 0) {
            if (!flags["restart-daemons"]) {
                this.error(`${aliveDaemons.length} daemon(s) running. Stop them first, then retry.`, { exit: 1 });
            }

            // Stop only the unsupervised daemons before the binary swap. Supervised daemons keep running
            // and are restarted by their supervisor afterwards (see _restartViaSupervisor).
            await stopUnmanagedDaemons(plan, lifecycle);
            if (plan.unmanaged.length > 0) this.log("All unsupervised daemons stopped.");
            for (const { daemon, supervisor } of plan.managed) {
                this.log(
                    `Daemon (PID ${daemon.pid}) is managed by ${supervisor.type} (${supervisor.unit}); ` +
                        `it will be restarted by its supervisor.`
                );
            }
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
            // We stopped the unsupervised daemons but aren't updating — bring them back. Supervised daemons
            // were never stopped, so leave them running (no unnecessary service bounce).
            if (flags["restart-daemons"]) await startUnmanagedDaemons(plan, lifecycle);
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

        // Restart daemons with the new binary: re-spawn the unsupervised ones we stopped, and ask each
        // supervisor to restart its daemon onto the new binary.
        if (aliveDaemons.length > 0 && flags["restart-daemons"]) {
            await startUnmanagedDaemons(plan, lifecycle);
            await restartManagedDaemons(plan, lifecycle);
            this.log("To see the daemon logs run `bitsocial logs --stdout`");
            this.log("Check community status with: bitsocial community list");
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

    /** Build the side effects that the restart orchestration drives (split out so the routing is testable). */
    private _daemonLifecycle(): DaemonLifecycle {
        return {
            stopUnmanaged: async (daemon) => {
                this.log(`Stopping daemon (PID ${daemon.pid})...`);
                try {
                    process.kill(daemon.pid, "SIGINT");
                } catch (e) {
                    if ((e as NodeJS.ErrnoException).code === "ESRCH") {
                        this.log(`  PID ${daemon.pid} already exited.`);
                        return;
                    }
                    throw e;
                }

                // Wait for the process to fully exit — NOT just for its RPC port to free. The daemon
                // releases its RPC port (daemonServer.destroy()) before it finishes killing its kubo
                // child, so a port-only wait lets us restart while the old kubo still holds the IPFS API
                // port; the new daemon then dies on "IPFS API port already in use" (issue #70). The
                // daemon's exit hook kills kubo before exiting, so "PID gone" guarantees kubo is free.
                this.log(`Waiting for daemon (PID ${daemon.pid}) to exit...`);
                const exited = await this._waitForProcessExit(daemon.pid, DAEMON_SHUTDOWN_TIMEOUT_MS);
                if (!exited) {
                    this.error(
                        `Daemon (PID ${daemon.pid}) did not shut down within ${DAEMON_SHUTDOWN_TIMEOUT_MS / 1000} seconds.`,
                        { exit: 1 }
                    );
                }
            },
            startUnmanaged: async (daemon) => {
                const argStr = daemon.argv.length > 0 ? daemon.argv.join(" ") : "(defaults)";
                this.log(`Restarting daemon with args: ${argStr}`);

                const child = spawn("bitsocial", ["daemon", ...daemon.argv], {
                    detached: true,
                    stdio: "ignore"
                });
                child.unref();

                if (!child.pid) {
                    this.warn(`Failed to spawn daemon for args: ${argStr}`);
                    return;
                }

                // Wait briefly for the daemon's RPC port to come up
                const port = Number(new URL(daemon.pkcRpcUrl).port);
                const started = await tcpPortUsed.waitUntilUsed(port, 500, 30000).then(() => true).catch(() => false);
                if (started) {
                    this.log(`  Daemon started (port ${port}).`);
                } else {
                    this.warn(`  Daemon may not have started — port ${port} not responding after 30s. Check logs with: bitsocial logs`);
                }
            },
            restartManaged: async (supervisor) => {
                await this._restartViaSupervisor(supervisor);
            }
        };
    }

    /** Restart a supervised daemon onto the new binary by asking its supervisor (e.g. systemd). */
    private async _restartViaSupervisor(supervisor: DaemonSupervisor): Promise<void> {
        this.log(`Restarting ${supervisor.type} unit ${supervisor.unit} so it picks up the new binary...`);
        try {
            await systemctlRestart(supervisor.unit);
            this.log(`  ${supervisor.unit} restarted.`);
        } catch (err) {
            this.error(
                `Updated the binary but failed to restart ${supervisor.type} unit ${supervisor.unit}: ${(err as Error).message}. ` +
                    `Restart it manually, e.g. 'sudo systemctl restart ${supervisor.unit}'.`,
                { exit: 1 }
            );
        }
    }
}
