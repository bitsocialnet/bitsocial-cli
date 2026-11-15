import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import defaults from "../../../common-utils/defaults.js";
import {
    removePackage,
    assertPackageInstalled,
    collectPackageUsages,
    PackageNotInstalledError,
    InvalidPackageNameError,
    assertValidPackageName,
    removeReloadWarning
} from "../../../common-utils/package-registry.js";
import { PAGE_SORT_PACKAGE_KIND, findPageSortUsages, reloadPageSortsInDaemon } from "../../../page-sort-packages/page-sort-utils.js";

export default class Remove extends BaseCommand {
    static override description =
        "Remove an installed page sort package. Refuses while a community's settings.pages still names it, unless --force is passed";

    static override aliases = ["page-sort:uninstall", "page-sort:rm", "page-sort:un"];

    static override args = {
        name: Args.string({
            description: "The page sort package name (e.g., my-page-sort or @scope/my-page-sort)",
            required: true
        })
    };

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path where page sorts are installed",
            required: false
        }),
        force: Flags.boolean({
            description: "Remove without checking whether communities still use it (the daemon is not contacted for the check)",
            default: false
        })
    };

    static override examples = [
        "bitsocial page-sort remove @pkcprotocol/active-page-sort",
        "bitsocial page-sort remove @pkcprotocol/active-page-sort --force"
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Remove);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;

        let removed: { version?: string };
        try {
            assertValidPackageName(args.name);
            // Checked before the daemon, so a misspelled name says so rather than that the daemon is down
            await assertPackageInstalled(PAGE_SORT_PACKAGE_KIND, { name: args.name, dataPath });
            if (!flags.force) await this._refuseIfInUse(args.name, flags.pkcRpcUrl.toString());
            removed = await removePackage(PAGE_SORT_PACKAGE_KIND, { name: args.name, dataPath });
        } catch (err) {
            if (err instanceof PackageNotInstalledError || err instanceof InvalidPackageNameError) this.error(err.message);
            throw err;
        }

        this.log(`removed ${args.name}${removed.version ? `@${removed.version}` : ""}`);
        if (flags.force)
            this.warn(
                `Skipped the in-use check. A community whose settings.pages still names "${args.name}" keeps publishing without this sort.`
            );

        // Best-effort reload in the daemon at --pkcRpcUrl, so the removal takes effect
        // without a restart
        const reload = await reloadPageSortsInDaemon(flags.pkcRpcUrl);
        const reloadWarning = removeReloadWarning(PAGE_SORT_PACKAGE_KIND, reload, args.name, flags.pkcRpcUrl);
        if (reloadWarning) this.warn(reloadWarning);
    }

    // A community whose settings.pages names a removed sort keeps publishing without it (pkc-js skips the entry and
    // reports an error every start), so the board silently loses its sort. Ask the daemon which communities use it.
    private async _refuseIfInUse(name: string, pkcRpcUrl: string): Promise<void> {
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
            findPageSortUsages(settings?.pages, name).map((usage) => `settings.pages.${usage}`)
        );
        if (usages.length === 0) return;
        this.error(
            `Page sort "${name}" is still used by:\n` +
                usages.map((usage) => `  - ${usage}`).join("\n") +
                `\nChange or remove those entries first, e.g. bitsocial community edit <address> --jsonFile <file with the new settings.pages>,` +
                ` or pass --force to remove it anyway (the communities keep publishing without this sort).`
        );
    }
}
