import { Args, Flags, Command } from "@oclif/core";
import path from "path";
import fs from "fs/promises";
import decompress from "decompress";
import defaults from "../../../common-utils/defaults.js";
import {
    ensureNpmAvailable,
    ensureChallengesDir,
    challengeNameToDir,
    readChallengePackageJson,
    runNpmPack,
    runNpmInstall,
    verifyNativeModuleAbi
} from "../../../challenge-packages/challenge-utils.js";

export default class Install extends Command {
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

        // 1. Check npm is available
        await ensureNpmAvailable();

        // 2. Use npm pack to download the package as a tarball
        const tmpDir = path.join(dataPath, ".challenge-install-tmp-" + Date.now());
        await fs.mkdir(tmpDir, { recursive: true });

        try {
            const archivePath = await runNpmPack(args.package, tmpDir);

            // 3. Extract the archive
            const extractDir = path.join(tmpDir, "extracted");
            await decompress(archivePath, extractDir);
            process.stderr.write("[challenge-install] archive extracted\n");

            // 4. Find package.json (npm pack tarballs have a package/ root dir)
            let pkgDir = extractDir;
            try {
                await readChallengePackageJson(pkgDir);
            } catch {
                // Check one level deep
                const entries = await fs.readdir(extractDir, { withFileTypes: true });
                const dirs = entries.filter((e) => e.isDirectory());
                let found = false;
                for (const dir of dirs) {
                    const candidate = path.join(extractDir, dir.name);
                    try {
                        await readChallengePackageJson(candidate);
                        pkgDir = candidate;
                        found = true;
                        break;
                    } catch {
                        // continue
                    }
                }
                if (!found) {
                    this.error("No valid package.json found in the archive. The archive must contain a package.json with a \"name\" field.");
                }
            }

            // 5. Read package info
            const pkg = await readChallengePackageJson(pkgDir);

            // 6. Run npm install in the temp dir, so a failed install never
            //    touches an existing working installation of the same package
            process.stderr.write(`[challenge-install] starting npm install in ${pkgDir}\n`);
            await runNpmInstall(pkgDir);
            process.stderr.write("[challenge-install] npm install completed\n");

            // 7. Verify native modules are ABI-compatible (still in the temp dir,
            //    so failure needs no rollback — the temp dir is cleaned up below)
            await verifyNativeModuleAbi(pkgDir);

            // 8. Swap the verified package into the challenges dir, replacing any
            //    existing installation (idempotent, like npm install)
            const challengesDir = await ensureChallengesDir(dataPath);
            const destDir = challengeNameToDir(challengesDir, pkg.name);
            let alreadyExists = true;
            try {
                await fs.access(destDir);
            } catch {
                alreadyExists = false;
            }

            // Move any existing install aside (same filesystem — tmpDir lives under
            // dataPath) so it can be restored if the final rename fails
            const backupDir = path.join(tmpDir, "previous-install");
            if (alreadyExists) await fs.rename(destDir, backupDir);

            if (pkg.name.startsWith("@")) {
                // Ensure scope dir exists for scoped packages
                const scopeDir = path.dirname(destDir);
                await fs.mkdir(scopeDir, { recursive: true });
            }
            try {
                await fs.rename(pkgDir, destDir);
            } catch (err) {
                // Restore the previous installation before surfacing the error
                if (alreadyExists) await fs.rename(backupDir, destDir);
                throw err;
            }

            // 9. Print success (npm-style)
            const version = pkg.version ? `@${pkg.version}` : "";
            const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
            this.log(`${alreadyExists ? "changed" : "added"} ${pkg.name}${version} in ${elapsedSeconds}s`);

            // 10. Best-effort reload via daemon
            try {
                await fetch("http://localhost:9138/api/challenges/reload", { method: "POST" });
            } catch {
                // daemon not running, that's fine
            }
        } finally {
            // 11. Clean up temp dir (includes the previous-install backup, if any)
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    }
}
