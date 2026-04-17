import { Command, Flags } from "@oclif/core";
import { fetchAllVersions } from "../../../update/npm-registry.js";

export default class Versions extends Command {
    static override description = "List available bitsocial versions on npm";

    static override flags = {
        limit: Flags.integer({
            description: "Maximum number of versions to display",
            default: 20
        })
    };

    static override examples = ["bitsocial update versions", "bitsocial update versions --limit 5"];

    async run(): Promise<void> {
        const { flags } = await this.parse(Versions);

        let versions: string[];
        try {
            versions = await fetchAllVersions();
        } catch (err) {
            this.error(`Failed to fetch versions: ${(err as Error).message}`, { exit: 1 });
        }

        const current = this.config.version;

        // Show newest first, limited to --limit
        const display = versions.slice(-flags.limit).reverse();

        for (const v of display) {
            const marker = v === current ? "* " : "  ";
            this.log(`${marker}${v}`);
        }
    }
}
