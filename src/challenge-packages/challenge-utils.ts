import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import defaults from "../common-utils/defaults.js";

export interface InstalledChallenge {
    name: string;
    version: string;
    description: string;
    path: string;
}

export function getChallengesDir(dataPath?: string): string {
    return path.join(dataPath || defaults.PLEBBIT_DATA_PATH, "challenges");
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

    let entries: Awaited<ReturnType<typeof fs.readdir>>;
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
            let scopeEntries: Awaited<ReturnType<typeof fs.readdir>>;
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

function getNpmCliPath(): string {
    // npm-cli.js lives at a standard location relative to the Node binary:
    //   <node-dir>/../lib/node_modules/npm/bin/npm-cli.js
    // This holds for nvm, official installers, and distro packages.
    return path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
}

function getNpmEnv(): NodeJS.ProcessEnv {
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
    const npmCliPath = getNpmCliPath();
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

export async function runNpmInstall(challengeDir: string): Promise<void> {
    const npmCliPath = getNpmCliPath();
    return new Promise<void>((resolve, reject) => {
        // Run npm through our own Node binary to guarantee ABI-compatible
        // native modules — npm's process.execPath and lifecycle scripts
        // will all use the same Node that's running bitsocial-cli
        const proc = spawn(process.execPath, [npmCliPath, "install", "--production"], {
            cwd: challengeDir,
            stdio: "inherit",
            env: getNpmEnv()
        });
        proc.on("error", (err) => {
            reject(new Error(`Failed to run npm install: ${err.message}`));
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm install exited with code ${code}`));
        });
    });
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

export async function loadChallengesIntoPlebbit(dataPath?: string): Promise<string[]> {
    const challenges = await listInstalledChallenges(dataPath);
    if (challenges.length === 0) return [];

    const Plebbit = await import("@plebbit/plebbit-js");
    const loadedNames: string[] = [];

    for (const challenge of challenges) {
        try {
            const pkg = await readChallengePackageJson(challenge.path);
            // Resolve the entry point
            const entryPoint = pkg.main || "index.js";
            const entryPath = path.resolve(challenge.path, entryPoint);
            const imported = await import(entryPath);
            const factory = imported.default || imported;
            (Plebbit.default as any).challenges[challenge.name] = factory;
            loadedNames.push(challenge.name);
        } catch (err) {
            console.error(`Failed to load challenge "${challenge.name}":`, err);
        }
    }

    return loadedNames;
}
