import { spawn } from "child_process";
import { getNpmCliPath, getNpmEnv, ensureNpmAvailable } from "../challenge-packages/challenge-utils.js";

const PACKAGE_NAME = "@bitsocial/bitsocial-cli";

function runNpmView(args: string[]): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        const npmCliPath = await getNpmCliPath();
        const proc = spawn(process.execPath, [npmCliPath, "view", PACKAGE_NAME, ...args, "--json"], {
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
            reject(new Error(`Failed to run npm view: ${err.message}`));
        });
        proc.on("close", (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(`npm view exited with code ${code}: ${stderr.trim()}`));
            }
        });
    });
}

/** Query npm registry for the latest published version. */
export async function fetchLatestVersion(): Promise<string> {
    await ensureNpmAvailable();
    const raw = await runNpmView(["version"]);
    // npm view <pkg> version --json returns a quoted string like "0.19.40"
    return JSON.parse(raw) as string;
}

/** Query npm registry for all published versions (oldest-first). */
export async function fetchAllVersions(): Promise<string[]> {
    await ensureNpmAvailable();
    const raw = await runNpmView(["versions"]);
    return JSON.parse(raw) as string[];
}

/** Install a specific version globally via npm install -g. Streams output to terminal. */
export async function installGlobal(version: string): Promise<void> {
    await ensureNpmAvailable();
    const npmCliPath = await getNpmCliPath();
    return new Promise<void>((resolve, reject) => {
        const proc = spawn(
            process.execPath,
            [npmCliPath, "install", "-g", `${PACKAGE_NAME}@${version}`],
            {
                stdio: ["ignore", "pipe", "pipe"],
                env: getNpmEnv()
            }
        );
        proc.stdout?.pipe(process.stdout);
        proc.stderr?.pipe(process.stderr);
        proc.on("error", (err) => {
            reject(new Error(`Failed to run npm install: ${err.message}`));
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm install -g exited with code ${code}`));
        });
    });
}
