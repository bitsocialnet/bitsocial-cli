import { Flags, Command } from "@oclif/core";
import { EOL } from "os";
import { printTable } from "@oclif/table";
import defaults from "../../../common-utils/defaults.js";
import { listInstalledChallenges } from "../../../challenge-packages/challenge-utils.js";

export default class List extends Command {
    static override description = "List installed challenge packages";

    static override flags = {
        quiet: Flags.boolean({ char: "q", summary: "Only display challenge names" }),
        "plebbitOptions.dataPath": Flags.directory({
            description: "Data path where challenges are installed",
            required: false
        })
    };

    static override examples = ["bitsocial challenge list", "bitsocial challenge list -q"];

    async run(): Promise<void> {
        const { flags } = await this.parse(List);
        const dataPath = flags["plebbitOptions.dataPath"] || defaults.PLEBBIT_DATA_PATH;

        const challenges = await listInstalledChallenges(dataPath);

        if (challenges.length === 0) {
            this.log("No challenge packages installed.");
            return;
        }

        if (flags.quiet) {
            this.log(challenges.map((c) => c.name).join(EOL));
        } else {
            printTable({
                data: challenges.map((c) => ({
                    name: c.name,
                    version: c.version,
                    description: c.description
                }))
            });
        }
    }
}
