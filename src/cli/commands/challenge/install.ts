import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import defaults from "../../../common-utils/defaults.js";
import { validateChallengeFileFactory } from "@pkcprotocol/pkc-js/challenges";
import {
    importPackageFactory,
    installPackage,
    installReloadWarning,
    InvalidPackageArchiveError,
    InvalidPackageNameError,
    type InstallPackageResult
} from "../../../common-utils/package-registry.js";
import { CHALLENGE_PACKAGE_KIND, reloadChallengesInDaemon } from "../../../challenge-packages/challenge-utils.js";

export default class Install extends BaseCommand {
    static override description = "Install a challenge package (npm package name, git URL, tarball URL, or local path)";

    static override aliases = ["challenge:i", "challenge:add"];

    static override args = {
        package: Args.string({
            description: "Package specifier — anything npm can install (name, name@version, git URL, tarball URL, local path)",
            required: true
        })
    };

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path to install the challenge into",
            required: false
        })
    };

    static override examples = [
        "bitsocial challenge install @bitsocial/mintpass-challenge",
        "bitsocial challenge install @bitsocial/mintpass-challenge@1.0.0",
        "bitsocial challenge install github:user/repo",
        "bitsocial challenge install https://example.com/my-challenge-1.0.0.tar.gz",
        "bitsocial challenge install ./my-local-challenge"
    ];

    async run(): Promise<void> {
        const startTime = Date.now();
        const { args, flags } = await this.parse(Install);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;

        let installed: InstallPackageResult;
        try {
            installed = await installPackage(CHALLENGE_PACKAGE_KIND, {
                packageSpec: args.package,
                dataPath,
                // Refuse anything a community would reject (e.g. a page sort package) before it replaces an install
                validate: async (pkgDir, pkg) =>
                    void validateChallengeFileFactory(await importPackageFactory(CHALLENGE_PACKAGE_KIND, pkgDir, pkg), { name: pkg.name })
            });
        } catch (err) {
            if (err instanceof InvalidPackageArchiveError || err instanceof InvalidPackageNameError) this.error(err.message);
            throw err;
        }

        // Print success (npm-style)
        const version = installed.version ? `@${installed.version}` : "";
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        this.log(`${installed.replaced ? "changed" : "added"} ${installed.name}${version} in ${elapsedSeconds}s`);

        // Best-effort reload in the daemon at --pkcRpcUrl, so the install takes effect
        // without a restart. Only claim it when the daemon reports this version loaded.
        const reload = await reloadChallengesInDaemon(flags.pkcRpcUrl);
        const reloadWarning = installReloadWarning(CHALLENGE_PACKAGE_KIND, reload, installed, flags.pkcRpcUrl);
        if (reloadWarning) this.warn(reloadWarning);
        else if (reload.status === "reloaded") this.log(`reloaded ${installed.name}${version} in the daemon at ${flags.pkcRpcUrl}`);
    }
}
