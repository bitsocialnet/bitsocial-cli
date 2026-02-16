import { Args, Flags, Command } from "@oclif/core";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { finished as streamFinished } from "stream/promises";
import { Readable } from "stream";
import decompress from "decompress";
import defaults from "../../../common-utils/defaults.js";
import {
    ensureNpmAvailable,
    ensureChallengesDir,
    challengeNameToDir,
    readChallengePackageJson,
    runNpmInstall,
    verifyNativeModuleAbi
} from "../../../challenge-packages/challenge-utils.js";

export default class Install extends Command {
    static override description = "Install a challenge package from a URL (.tar.gz archive)";

    static override args = {
        url: Args.string({
            description: "URL to a .tar.gz archive of the challenge package",
            required: true
        })
    };

    static override flags = {
        "plebbitOptions.dataPath": Flags.directory({
            description: "Data path to install the challenge into",
            required: false
        })
    };

    static override examples = [
        "bitsocial challenge install https://example.com/my-challenge-1.0.0.tar.gz",
        "bitsocial challenge install https://example.com/challenge.tar.gz --plebbitOptions.dataPath /custom/data"
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Install);
        const dataPath = flags["plebbitOptions.dataPath"] || defaults.PLEBBIT_DATA_PATH;

        // 1. Check npm is available
        await ensureNpmAvailable();

        // 2. Download the archive to a temp dir
        const tmpDir = path.join(dataPath, ".challenge-install-tmp-" + Date.now());
        await fs.mkdir(tmpDir, { recursive: true });

        try {
            const archivePath = path.join(tmpDir, "challenge.tar.gz");
            const response = await fetch(args.url);
            if (!response.ok || !response.body) {
                this.error(`Failed to download ${args.url}: HTTP ${response.status} ${response.statusText}`);
            }

            const writer = createWriteStream(archivePath);
            await streamFinished(Readable.fromWeb(response.body as any).pipe(writer));
            writer.close();

            // 3. Extract the archive
            const extractDir = path.join(tmpDir, "extracted");
            await decompress(archivePath, extractDir);

            // 4. Find package.json (may be nested one level if archive has a root dir)
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

            // 6. Check not already installed
            const challengesDir = await ensureChallengesDir(dataPath);
            const destDir = challengeNameToDir(challengesDir, pkg.name);
            let alreadyExists = true;
            try {
                await fs.access(destDir);
            } catch {
                alreadyExists = false;
            }
            if (alreadyExists) {
                this.error(`Challenge "${pkg.name}" is already installed. Remove it first with: bitsocial challenge remove ${pkg.name}`);
            }

            // 7. Move to challenges dir
            if (pkg.name.startsWith("@")) {
                // Ensure scope dir exists for scoped packages
                const scopeDir = path.dirname(destDir);
                await fs.mkdir(scopeDir, { recursive: true });
            }
            await fs.rename(pkgDir, destDir);

            // 8. Run npm install
            await runNpmInstall(destDir);

            // 9. Verify native modules are ABI-compatible
            try {
                await verifyNativeModuleAbi(destDir);
            } catch (err) {
                // Roll back the installation on ABI mismatch
                await fs.rm(destDir, { recursive: true, force: true });
                if (pkg.name.startsWith("@")) {
                    const scopeDir = path.dirname(destDir);
                    try {
                        const entries = await fs.readdir(scopeDir);
                        if (entries.length === 0) await fs.rmdir(scopeDir);
                    } catch {
                        // ignore
                    }
                }
                this.error(err instanceof Error ? err.message : String(err));
            }

            // 10. Print success
            const version = pkg.version ? `@${pkg.version}` : "";
            this.log(`Installed challenge '${pkg.name}${version}'`);

            // 11. Best-effort reload via daemon
            try {
                await fetch("http://localhost:9138/api/challenges/reload", { method: "POST" });
            } catch {
                // daemon not running, that's fine
            }
        } finally {
            // 12. Clean up temp dir
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    }
}
