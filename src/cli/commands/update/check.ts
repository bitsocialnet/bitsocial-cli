import { Command } from "@oclif/core";
import { fetchLatestVersion } from "../../../update/npm-registry.js";
import { compareVersions } from "../../../update/semver.js";

export default class Check extends Command {
    static override description = "Check if a newer version of bitsocial is available on npm";

    static override examples = ["bitsocial update check"];

    async run(): Promise<void> {
        let latest: string;
        try {
            latest = await fetchLatestVersion();
        } catch (err) {
            this.error(`Failed to check for updates: ${(err as Error).message}`, { exit: 1 });
        }

        const current = this.config.version;
        const cmp = compareVersions(current, latest);

        if (cmp === 0) {
            this.log(`bitsocial is up-to-date: v${current}`);
        } else if (cmp < 0) {
            this.log(`Update available: v${latest} (current: v${current})`);
            this.log(`Run: bitsocial update install`);
        } else {
            this.log(`bitsocial v${current} is newer than latest published release v${latest}`);
        }
    }
}
