import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import defaults from "../../../common-utils/defaults.js";
import {
    removePackage,
    assertPackageInstalled,
    collectPackageUsages,
    isBuiltInPackageName,
    PackageNotInstalledError,
    InvalidPackageNameError,
    assertValidPackageName,
    removeReloadWarning
} from "../../../common-utils/package-registry.js";
import { CHALLENGE_PACKAGE_KIND, findChallengeUsages, reloadChallengesInDaemon } from "../../../challenge-packages/challenge-utils.js";

export default class Remove extends BaseCommand {
    static override description =
        "Remove an installed challenge package. Refuses while a community's settings.challenges still names it, unless --force is passed";

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
        }),
        force: Flags.boolean({
            description: "Remove without checking whether communities still use it (the daemon is not contacted for the check)",
            default: false
        })
    };

    static override examples = [
        "bitsocial challenge remove my-challenge",
        "bitsocial challenge remove @scope/my-challenge",
        "bitsocial challenge remove my-challenge --force"
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Remove);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;

        let removed: { version?: string };
        let builtIn: boolean;
        try {
            assertValidPackageName(args.name);
            // Checked before the daemon, so a misspelled name says so rather than that the daemon is down
            await assertPackageInstalled(CHALLENGE_PACKAGE_KIND, { name: args.name, dataPath });
            builtIn = await isBuiltInPackageName(CHALLENGE_PACKAGE_KIND, args.name);
            if (!flags.force) await this._refuseIfInUse(args.name, builtIn, flags.pkcRpcUrl.toString());
            removed = await removePackage(CHALLENGE_PACKAGE_KIND, { name: args.name, dataPath });
        } catch (err) {
            if (err instanceof PackageNotInstalledError || err instanceof InvalidPackageNameError) this.error(err.message);
            throw err;
        }

        this.log(`removed ${args.name}${removed.version ? `@${removed.version}` : ""}`);
        if (flags.force)
            this.warn(
                `Skipped the in-use check. A community whose settings.challenges still names "${args.name}" ` +
                    (builtIn
                        ? `now uses the pkc-js built-in challenge of the same name.`
                        : `rejects every publication and fails to start until that entry is changed.`)
            );

        // Best-effort reload in the daemon at --pkcRpcUrl, so the removal takes effect
        // without a restart
        const reload = await reloadChallengesInDaemon(flags.pkcRpcUrl);
        const reloadWarning = removeReloadWarning(CHALLENGE_PACKAGE_KIND, reload, args.name, flags.pkcRpcUrl);
        if (reloadWarning) this.warn(reloadWarning);
    }

    // A community whose settings.challenges names an unregistered challenge rejects every publication, and pkc-js
    // throws on its next start, so it goes offline (issue #176). A name that shadows a pkc-js built-in falls back to
    // the built-in instead, which still changes how the community moderates. Ask the daemon which communities use it.
    private async _refuseIfInUse(name: string, builtIn: boolean, pkcRpcUrl: string): Promise<void> {
        let pkc: Awaited<ReturnType<typeof this._connectToPkcRpc>>;
        try {
            pkc = await this._connectToPkcRpc(pkcRpcUrl);
        } catch (err) {
            this.error(
                `Could not check whether any community uses "${name}": ${err instanceof Error ? err.message : String(err)}\n` +
                    `Start the daemon and retry, or pass --force to remove it without checking.`
            );
        }
        const usages = await collectPackageUsages(pkc, (settings) =>
            findChallengeUsages(settings?.challenges, name).map((usage) => `settings.${usage}`)
        );
        if (usages.length === 0) return;
        this.error(
            `Challenge "${name}" is still used by:\n` +
                usages.map((usage) => `  - ${usage}`).join("\n") +
                `\nChange or remove those entries first, e.g. bitsocial community edit <address> --jsonFile <file with the new settings.challenges>,` +
                ` or pass --force to remove it anyway ` +
                (builtIn
                    ? `(after removal, "${name}" falls back to the pkc-js built-in challenge of the same name).`
                    : `(those communities reject every publication and fail to start until their settings are fixed).`)
        );
    }
}
