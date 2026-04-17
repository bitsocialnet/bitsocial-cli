import { Args, Flags, Command } from "@oclif/core";
import tcpPortUsed from "tcp-port-used";
import defaults from "../../../common-utils/defaults.js";
import { fetchLatestVersion, installGlobal } from "../../../update/npm-registry.js";
import { compareVersions } from "../../../update/semver.js";

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
        })
    };

    static override examples = [
        "bitsocial update install",
        "bitsocial update install latest",
        "bitsocial update install 0.19.40",
        "bitsocial update install --force"
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Install);

        // Check if daemon is running — refuse to update while it's active
        const rpcPort = Number(defaults.PKC_RPC_URL.port);
        const daemonRunning = await tcpPortUsed.check(rpcPort, "127.0.0.1").catch(() => false);
        if (daemonRunning) {
            this.error(
                `Daemon is running on port ${rpcPort}. Stop it first with Ctrl-C, then run 'bitsocial update install'.`,
                { exit: 1 }
            );
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
            return;
        }

        this.log(`Installing bitsocial-cli@${targetVersion}...`);

        try {
            await installGlobal(targetVersion);
        } catch (err) {
            this.error(`Update failed: ${(err as Error).message}`, { exit: 1 });
        }

        this.log(`Installed bitsocial v${targetVersion} (was v${current}).`);
    }
}
