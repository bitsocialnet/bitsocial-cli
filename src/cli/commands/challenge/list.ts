import { Flags, Command } from "@oclif/core";
import { EOL } from "os";
import path from "path";
import defaults from "../../../common-utils/defaults.js";
import { getChallengesDir, listInstalledChallenges, formatChallengeNameVersion } from "../../../challenge-packages/challenge-utils.js";

export default class List extends Command {
    static override description = "List installed challenge packages";

    static override aliases = ["challenge:ls"];

    static override flags = {
        quiet: Flags.boolean({ char: "q", summary: "Only display challenge names" }),
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path where challenges are installed",
            required: false
        })
    };

    static override examples = ["bitsocial challenge list", "bitsocial challenge list -q"];

    async run(): Promise<void> {
        const { flags } = await this.parse(List);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;

        // Sort alphabetically like npm ls (readdir order is filesystem-dependent)
        const challenges = (await listInstalledChallenges(dataPath)).sort((a, b) => a.name.localeCompare(b.name));

        if (challenges.length === 0) {
            this.log("No challenge packages installed.");
            return;
        }

        if (flags.quiet) {
            this.log(challenges.map((c) => c.name).join(EOL));
        } else {
            // npm-ls-style tree: challenges dir header, then name@version entries
            this.log(path.resolve(getChallengesDir(dataPath)));
            challenges.forEach((c, i) => {
                const branch = i === challenges.length - 1 ? "└── " : "├── ";
                this.log(`${branch}${formatChallengeNameVersion(c)}`);
            });
        }
    }
}
