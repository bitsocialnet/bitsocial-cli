import path from "path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "fs/promises";
import type { Dirent } from "fs";
import { execFileSync, spawn } from "child_process";
import defaults from "../common-utils/defaults.js";
import { migrateDataDirectory } from "../common-utils/data-migration.js";

export interface InstalledChallenge {
    name: string;
    version: string;
    description: string;
    path: string;
}

export function getChallengesDir(dataPath?: string): string {
    return path.join(dataPath || defaults.PKC_DATA_PATH, "challenges");
}

export async function ensureChallengesDir(dataPath?: string): Promise<string> {
    const dir = getChallengesDir(dataPath);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

export function challengeNameToDir(challengesDir: string, name: string): string {
    // Handles both scoped (@org/pkg) and unscoped (pkg) names
    return path.join(challengesDir, ...name.split("/"));
}

export async function readChallengePackageJson(challengeDir: string): Promise<{ name: string; version?: string; description?: string; main?: string; exports?: any }> {
    const pkgPath = path.join(challengeDir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    if (!pkg.name || typeof pkg.name !== "string") {
        throw new Error(`Invalid package.json in ${challengeDir}: missing "name" field`);
    }
    return pkg;
}

export async function listInstalledChallenges(dataPath?: string): Promise<InstalledChallenge[]> {
    const challengesDir = getChallengesDir(dataPath);
    const results: InstalledChallenge[] = [];

    let entries: Dirent[];
    try {
        entries = await fs.readdir(challengesDir, { withFileTypes: true });
    } catch {
        return results; // dir doesn't exist = no challenges
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        if (entry.name.startsWith("@")) {
            // Scoped package: read @scope/*/package.json
            const scopeDir = path.join(challengesDir, entry.name);
            let scopeEntries: Dirent[];
            try {
                scopeEntries = await fs.readdir(scopeDir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const scopeEntry of scopeEntries) {
                if (!scopeEntry.isDirectory()) continue;
                const pkgDir = path.join(scopeDir, scopeEntry.name);
                try {
                    const pkg = await readChallengePackageJson(pkgDir);
                    results.push({
                        name: pkg.name,
                        version: pkg.version || "unknown",
                        description: pkg.description || "",
                        path: pkgDir
                    });
                } catch {
                    // skip invalid entries
                }
            }
        } else {
            // Unscoped package
            const pkgDir = path.join(challengesDir, entry.name);
            try {
                const pkg = await readChallengePackageJson(pkgDir);
                results.push({
                    name: pkg.name,
                    version: pkg.version || "unknown",
                    description: pkg.description || "",
                    path: pkgDir
                });
            } catch {
                // skip invalid entries
            }
        }
    }

    return results;
}

function getNpmCliPathRelative(nodeExecPath: string): string {
    // npm-cli.js lives at a standard location relative to a Node binary.
    const nodeDir = path.dirname(nodeExecPath);
    if (process.platform === "win32") {
        // Windows: <node-dir>/node_modules/npm/bin/npm-cli.js
        return path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
    }
    // Unix (nvm, official installers, distro packages):
    //   <node-dir>/../lib/node_modules/npm/bin/npm-cli.js
    return path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
}

export async function getNpmCliPath(): Promise<string> {
    // 1. Try relative to our own Node binary (works for nvm / system Node)
    const relativePath = getNpmCliPathRelative(process.execPath);
    try {
        await fs.access(relativePath);
        return relativePath;
    } catch {
        // Not found relative to process.execPath (e.g. oclif-bundled Node without npm)
    }

    // 2. Fall back to the system npm found on PATH
    try {
        const cmd = process.platform === "win32" ? "where.exe" : "which";
        const npmBin = execFileSync(cmd, ["npm"], { encoding: "utf8" }).trim().split("\n")[0].trim();
        // npmBin is a symlink or script; resolve to the real path, then derive npm-cli.js
        // For most installs: npm -> <prefix>/lib/node_modules/npm/bin/npm-cli.js
        const realNpmBin = await fs.realpath(npmBin);
        // If realpath leads directly to npm-cli.js, use it
        if (realNpmBin.endsWith("npm-cli.js")) {
            return realNpmBin;
        }
        // Otherwise, the system npm binary lives beside a Node that has npm installed —
        // derive npm-cli.js relative to that Node
        const systemNodeDir = path.dirname(realNpmBin);
        const systemNpmCli = process.platform === "win32"
            ? path.join(systemNodeDir, "node_modules", "npm", "bin", "npm-cli.js")
            : path.join(systemNodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
        await fs.access(systemNpmCli);
        return systemNpmCli;
    } catch {
        // Could not locate npm on PATH either
    }

    // Return the original relative path so callers get the familiar error message
    return relativePath;
}

export function getNpmEnv(): NodeJS.ProcessEnv {
    // Prepend our Node's directory to PATH so that npm subprocesses
    // (node-gyp, lifecycle scripts) also use the same Node binary
    const nodeDir = path.dirname(process.execPath);
    const pathSep = process.platform === "win32" ? ";" : ":";
    return {
        ...process.env,
        PATH: nodeDir + pathSep + (process.env["PATH"] || "")
    };
}

const npmErrorMessage =
    `npm is required to install challenge packages but was not found at the expected location ` +
    `relative to Node ${process.version} (${process.execPath}).\n` +
    `Install Node.js ${process.version} from https://nodejs.org/ (npm is included with Node.js) and retry.`;

export async function ensureNpmAvailable(): Promise<void> {
    const npmCliPath = await getNpmCliPath();
    try {
        await fs.access(npmCliPath);
    } catch {
        throw new Error(npmErrorMessage);
    }

    return new Promise<void>((resolve, reject) => {
        // Run npm through our own Node binary so process.execPath is correct
        const proc = spawn(process.execPath, [npmCliPath, "--version"], { stdio: "ignore", env: getNpmEnv() });
        proc.on("error", () => {
            reject(new Error(npmErrorMessage));
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(npmErrorMessage));
        });
    });
}

export async function runNpmPack(packageSpec: string, destDir: string): Promise<string> {
    const npmCliPath = await getNpmCliPath();
    return new Promise<string>((resolve, reject) => {
        const proc = spawn(process.execPath, [npmCliPath, "pack", packageSpec, "--pack-destination", destDir], {
            stdio: ["ignore", "pipe", "pipe"],
            env: getNpmEnv()
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });
        proc.on("error", (err) => {
            reject(new Error(`Failed to run npm pack: ${err.message}`));
        });
        proc.on("close", (code) => {
            if (code === 0) {
                // npm pack prints the tarball filename on the last non-empty line of stdout
                const filename = stdout.trim().split("\n").pop()?.trim();
                if (!filename) {
                    reject(new Error("npm pack succeeded but produced no output"));
                    return;
                }
                resolve(path.join(destDir, filename));
            } else {
                reject(new Error(`npm pack exited with code ${code}: ${stderr.trim()}`));
            }
        });
    });
}

export async function runNpmInstall(challengeDir: string): Promise<void> {
    const npmCliPath = await getNpmCliPath();

    // Strip devDependencies from the manifest before running npm install.
    // npm's Arborist resolves ALL declared deps (including dev) during tree
    // building even with --omit=dev — unresolvable devDep versions cause
    // ETARGET failures before the omit filter applies.  Removing them from
    // the manifest prevents Arborist from creating those edges at all.
    // The original package.json is restored after install (byte-identical).
    const pkgJsonPath = path.join(challengeDir, "package.json");
    const originalContent = await fs.readFile(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(originalContent);
    const hadDevDeps = pkg.devDependencies !== undefined;
    const hadScripts = pkg.scripts !== undefined;

    if (hadDevDeps || hadScripts) {
        const stripped = { ...pkg };
        delete stripped.devDependencies;
        delete stripped.scripts;
        await fs.writeFile(pkgJsonPath, JSON.stringify(stripped, null, 2) + "\n");
    }

    try {
        await new Promise<void>((resolve, reject) => {
            // Run npm through our own Node binary to guarantee ABI-compatible
            // native modules — npm's process.execPath and lifecycle scripts
            // will all use the same Node that's running bitsocial-cli.
            // Use piped stdio and forward explicitly so output is visible even
            // when the parent process has piped stdio (e.g. spawned by tests).
            const args = [npmCliPath, "install", "--omit=dev", "--no-audit", "--no-fund"];
            if (process.platform === "win32") {
                args.push("--legacy-peer-deps");
            }
            const proc = spawn(process.execPath, args, {
                cwd: challengeDir,
                stdio: ["ignore", "pipe", "pipe"],
                env: getNpmEnv()
            });
            proc.stdout?.pipe(process.stdout);
            proc.stderr?.pipe(process.stderr);
            proc.on("error", (err) => {
                reject(new Error(`Failed to run npm install: ${err.message}`));
            });
            proc.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`npm install exited with code ${code}`));
            });
        });
    } finally {
        if (hadDevDeps || hadScripts) {
            await fs.writeFile(pkgJsonPath, originalContent);
        }
    }
}

export async function verifyNativeModuleAbi(challengeDir: string): Promise<void> {
    // Scan for .node files (native addons) and try to dlopen each one.
    // Node checks NODE_MODULE_VERSION before calling any init code,
    // so this safely catches ABI mismatches without side effects.
    const entries = await fs.readdir(challengeDir, { recursive: true });
    const nodeFiles = entries.filter((entry) => typeof entry === "string" && entry.endsWith(".node"));
    if (nodeFiles.length === 0) return;

    const mismatched: string[] = [];
    for (const file of nodeFiles) {
        const filePath = path.join(challengeDir, file);
        const mod = { exports: {} };
        try {
            (process as any).dlopen(mod, filePath);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("NODE_MODULE_VERSION") || msg.includes("was compiled against a different")) {
                mismatched.push(file);
            }
            // Other errors (missing dependencies, etc.) are fine at this stage —
            // the module might still work once the full package is loaded
        }
    }

    if (mismatched.length > 0) {
        throw new Error(
            `ABI mismatch: the following native modules were compiled for a different Node.js version:\n` +
                mismatched.map((f) => `  - ${f}`).join("\n") +
                `\nThe running Node.js is ${process.version} (modules ABI ${process.versions.modules}).\n` +
                `Ensure the challenge package was built for this Node.js version.`
        );
    }
}

export function formatChallengeNameVersion(challenge: Pick<InstalledChallenge, "name" | "version">): string {
    return challenge.version && challenge.version !== "unknown" ? `${challenge.name}@${challenge.version}` : challenge.name;
}

/**
 * HTTP url of a daemon's challenge-reload endpoint, derived from its --pkcRpcUrl. The endpoint
 * is served by the same http server as the RPC socket, and its local-only variant requires the
 * request to come from the loopback interface — so a wildcard bind is dialed as loopback rather
 * than as 0.0.0.0.
 */
export function challengeReloadUrlFromPkcRpcUrl(pkcRpcUrl: string): string | undefined {
    let url: URL;
    try {
        url = new URL(pkcRpcUrl);
    } catch {
        return undefined;
    }
    if (!url.port) return undefined;
    // URL.hostname keeps the brackets around an IPv6 literal — strip them so the host can be
    // compared and re-bracketed exactly once
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const host = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
    return `http://${host.includes(":") ? `[${host}]` : host}:${url.port}/api/challenges/reload`;
}

/**
 * Ask the daemon at `pkcRpcUrl` to reload its challenge packages, so an install/remove takes
 * effect without a restart. Returns whether a daemon actually reloaded — best-effort, since
 * no daemon running is not an error.
 */
export async function reloadChallengesInDaemon(pkcRpcUrl: string | URL): Promise<boolean> {
    const reloadUrl = challengeReloadUrlFromPkcRpcUrl(pkcRpcUrl.toString());
    if (!reloadUrl) return false;
    try {
        const res = await fetch(reloadUrl, { method: "POST" });
        return res.ok;
    } catch {
        return false; // daemon not running, that's fine
    }
}

// Hash of a challenge package's own source, used as the import cache key (see
// loadChallengesIntoPKC).  node_modules and dot-entries are skipped: dependencies are
// pinned by the install that produced this package dir, and hashing them would make
// every reload walk the entire dependency tree.
async function hashChallengePackageContents(challengeDir: string): Promise<string> {
    const hash = createHash("sha256");

    const walk = async (dir: string, relativeDir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Sort so the digest does not depend on readdir order
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const absolutePath = path.join(dir, entry.name);
            const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolutePath, relativePath);
            } else if (entry.isFile()) {
                hash.update(relativePath);
                hash.update(await fs.readFile(absolutePath));
            }
        }
    };

    await walk(challengeDir, "");
    return hash.digest("hex").slice(0, 16);
}

export async function loadChallengesIntoPKC(dataPath?: string): Promise<InstalledChallenge[]> {
    const challenges = await listInstalledChallenges(dataPath);
    if (challenges.length === 0) return [];

    const PKC = await import("@pkcprotocol/pkc-js");
    const loaded: InstalledChallenge[] = [];

    for (const challenge of challenges) {
        try {
            const pkg = await readChallengePackageJson(challenge.path);
            // Resolve the entry point
            const entryPoint = pkg.main || "index.js";
            const entryPath = path.resolve(challenge.path, entryPoint);

            // Node caches ESM modules by URL, and `challenge install` swaps a new build onto
            // the same destination path.  Importing the bare path would therefore hand back
            // the module evaluated before the upgrade, so the registry would keep serving the
            // old factory while metadata reports the new version (issue #124).  Keying the URL
            // on the package contents re-evaluates the entry whenever the package changes and
            // stays byte-identical (so cached, so factory-identical) when it does not.
            //
            // Only the entry module is re-evaluated: relative imports inside the package do not
            // inherit the query, so a multi-file package graph would keep its stale submodules.
            // Challenge packages are expected to ship a bundled entry point.
            const entryUrl = pathToFileURL(entryPath);
            entryUrl.searchParams.set("bitsocialChallengeContent", await hashChallengePackageContents(challenge.path));

            const imported = await import(entryUrl.href);
            const factory = imported.default || imported;
            (PKC.default as any).challenges[challenge.name] = factory;
            loaded.push(challenge);
        } catch (err) {
            console.error(`Failed to load challenge "${challenge.name}":`, err);
        }
    }

    return loaded;
}
