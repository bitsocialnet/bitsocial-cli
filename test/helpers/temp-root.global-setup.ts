import fs from "fs/promises";
import os from "os";
import path from "path";

// Test files take their data directories from tempy and os.tmpdir(), and nothing removed them: a week of runs left
// 15,000 folders with kubo repos in them and used up a tmpfs's inodes (#248). One directory per run holds them all
// instead, and the teardown removes it. Test workers and every process they start inherit these variables.
const PREFIX = "bsc-test-";
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// Processes the tests started can still hold files for a moment, which on Windows blocks the removal. A directory that
// outlasts the retries is left for a later run to remove, and named here so that it is not left unnoticed.
const remove = (directory: string) =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error) => console.warn(`Could not remove the test temp directory ${directory}:`, String(error)));

// The run directory's name carries the pid of the vitest process that made it. Signal 0 only asks whether that process exists.
function isRunning(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

// A run that was killed never reached its teardown. A day is far longer than any run takes, but a watch session can sit
// idle for longer than that and still be using its directory, so a directory whose process is alive is kept at any age.
export async function removeStaleRuns(tempDirectory: string) {
    for (const name of await fs.readdir(tempDirectory).catch(() => [])) {
        if (!name.startsWith(PREFIX)) continue;
        const directory = path.join(tempDirectory, name);
        const stats = await fs.stat(directory).catch(() => undefined);
        if (!stats || Date.now() - stats.mtimeMs <= STALE_AFTER_MS) continue;
        const pid = /^(\d+)-/.exec(name.slice(PREFIX.length))?.[1];
        if (pid && isRunning(Number(pid))) continue;
        await remove(directory);
    }
}

export default async function setup() {
    const tempDirectory = await fs.realpath(os.tmpdir());
    await removeStaleRuns(tempDirectory);
    const runDirectory = await fs.mkdtemp(path.join(tempDirectory, `${PREFIX}${process.pid}-`));
    // bin/run keeps its compile cache in the temp dir, and a cold one for every run would slow each CLI the tests start.
    process.env["NODE_COMPILE_CACHE"] ??= path.join(tempDirectory, "node-compile-cache");
    for (const variable of ["TMPDIR", "TMP", "TEMP"]) process.env[variable] = runDirectory;
    return () => remove(runDirectory);
}
