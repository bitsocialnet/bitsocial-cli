import { Args, Flags, Command } from "@oclif/core";
import fs from "fs/promises";
import path from "path";
import defaults from "../../../common-utils/defaults.js";
import { getChallengesDir, challengeNameToDir, readChallengePackageJson } from "../../../challenge-packages/challenge-utils.js";

export default class Remove extends Command {
    static override description = "Remove an installed challenge package";

    static override aliases = ["challenge:uninstall", "challenge:rm", "challenge:un"];

    static override args = {
        name: Args.string({
            description: "The challenge package name (e.g., my-challenge or @scope/my-challenge)",
            required: true
        })
    };

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path where challenges are installed",
            required: false
        })
    };

    static override examples = [
        "bitsocial challenge remove my-challenge",
        "bitsocial challenge remove @scope/my-challenge"
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Remove);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;

        const challengesDir = getChallengesDir(dataPath);
        const challengeDir = challengeNameToDir(challengesDir, args.name);

        // Verify the challenge exists
        try {
            await fs.access(challengeDir);
        } catch {
            this.error(`Challenge "${args.name}" is not installed.`);
        }

        // Read the installed version for the success message (best-effort)
        let version = "";
        try {
            const pkg = await readChallengePackageJson(challengeDir);
            if (pkg.version) version = `@${pkg.version}`;
        } catch {
            // unreadable package.json — report the name only
        }

        // Remove the challenge directory
        await fs.rm(challengeDir, { recursive: true, force: true });

        // Clean up empty @scope/ dir for scoped packages
        if (args.name.startsWith("@")) {
            const scopeDir = path.dirname(challengeDir);
            try {
                const entries = await fs.readdir(scopeDir);
                if (entries.length === 0) {
                    await fs.rmdir(scopeDir);
                }
            } catch {
                // ignore
            }
        }

        this.log(`removed ${args.name}${version}`);

        // Best-effort reload via daemon
        try {
            await fetch("http://localhost:9138/api/challenges/reload", { method: "POST" });
        } catch {
            // daemon not running, that's fine
        }
    }
}
