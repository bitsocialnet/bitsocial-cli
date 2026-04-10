import { Hook } from "@oclif/core";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, join } from "path";

// Get pkc-js version from its package.json
const getPkcJsVersion = (): string => {
    const require = createRequire(import.meta.url);
    // Get path to pkc-js module
    const pkcJsPath = require.resolve("@pkcprotocol/pkc-js");
    // Navigate to package root (pkc-js main export is dist/node/index.js)
    const pkcJsRoot = dirname(dirname(dirname(pkcJsPath)));
    const pkcPkgPath = join(pkcJsRoot, "package.json");
    const pkcPkg = JSON.parse(readFileSync(pkcPkgPath, "utf-8"));
    return pkcPkg.version;
};

// Get commit hash from CLI's package.json dependency URL (if installed from git)
const getPkcJsCommit = (cliRoot: string): string | undefined => {
    try {
        const cliPkgPath = join(cliRoot, "package.json");
        const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf-8"));
        const pkcJsDep = cliPkg.dependencies["@pkcprotocol/pkc-js"];
        // Extract commit hash from URL like "https://github.com/pkcprotocol/pkc-js#542952a1..."
        const match = pkcJsDep?.match(/#([a-f0-9]+)$/);
        return match ? match[1].substring(0, 7) : undefined;
    } catch {
        return undefined;
    }
};

const hook: Hook<"init"> = async function (opts) {
    // Check process.argv because oclif normalizes argv and --version becomes the id, not part of argv
    if (process.argv.includes("--version")) {
        const { config } = opts;
        const pkcJsVersion = getPkcJsVersion();
        const commit = getPkcJsCommit(config.root);
        const commitStr = commit ? ` (${commit})` : "";

        // Output CLI version on first line, pkc-js version + commit on second line
        this.log(`${config.name}/${config.version} ${config.platform}-${config.arch} node-${process.version}`);
        this.log(`pkc-js/${pkcJsVersion}${commitStr}`);
        // Use process.exit to actually stop - this.exit(0) throws an error that gets caught by oclif
        process.exit(0);
    }
};

export default hook;
