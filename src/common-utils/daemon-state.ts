import defaults from "./defaults.js";
import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DAEMON_STATES_DIR = path.join(defaults.PKC_DATA_PATH, ".daemon_states");

/**
 * Maximum time a daemon is allowed to shut down its kubo + RPC server during its
 * async exit hook. The `update install --restart-daemons` orchestrator must wait at
 * least this long for a stopped daemon's PID to disappear before giving up — otherwise
 * a slow-but-valid shutdown (within the daemon's own contract) aborts the update midway.
 */
export const DAEMON_SHUTDOWN_TIMEOUT_MS = 120000;

export interface DaemonState {
    pid: number;
    startedAt: string;
    argv: string[];
    pkcRpcUrl: string;
    /** OS-reported process start time, used to detect PID reuse. Absent in legacy state files. */
    procStartTime?: string;
}

function stateFilePath(pid: number): string {
    return path.join(DAEMON_STATES_DIR, `${pid}-daemon.state`);
}

/**
 * OS-reported start time of a process, used as an identity token: if a state file's PID
 * was reused by an unrelated process, its start time won't match the recorded one.
 * Linux: starttime (field 22) of /proc/<pid>/stat, in clock ticks since boot.
 * Other unix: `ps -o lstart=` output. Returns undefined when it can't be determined.
 */
async function getProcessStartTime(pid: number): Promise<string | undefined> {
    try {
        const stat = await fs.readFile(`/proc/${pid}/stat`, "utf-8");
        // comm (field 2) may contain spaces/parens — real fields resume after the last ')'
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        return fields[19]; // field 22 (starttime), offset by the 3 fields before the split
    } catch {
        try {
            const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]);
            return stdout.trim() || undefined;
        } catch {
            return undefined;
        }
    }
}

/** Full command line of a process, or undefined when it can't be determined. */
async function getProcessCommandLine(pid: number): Promise<string | undefined> {
    try {
        // An empty /proc cmdline is meaningful (kernel thread — not a daemon), so keep it
        const raw = await fs.readFile(`/proc/${pid}/cmdline`, "utf-8");
        return raw.split("\0").join(" ").trim();
    } catch {
        try {
            const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "args="]);
            return stdout.trim() || undefined;
        } catch {
            return undefined;
        }
    }
}

/** Write a daemon state file atomically (write to .tmp then rename). */
export async function writeDaemonState(state: DaemonState): Promise<void> {
    if (state.procStartTime === undefined) {
        const procStartTime = await getProcessStartTime(state.pid);
        if (procStartTime !== undefined) state = { ...state, procStartTime };
    }
    await fs.mkdir(DAEMON_STATES_DIR, { recursive: true });
    const dest = stateFilePath(state.pid);
    const tmp = dest + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, dest);
}

/** Read all state files from the daemon states directory. */
export async function readAllDaemonStates(): Promise<DaemonState[]> {
    let entries: string[];
    try {
        entries = await fs.readdir(DAEMON_STATES_DIR);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
    }

    const states: DaemonState[] = [];
    for (const entry of entries) {
        if (!entry.endsWith("-daemon.state")) continue;
        try {
            const content = await fs.readFile(path.join(DAEMON_STATES_DIR, entry), "utf-8");
            states.push(JSON.parse(content) as DaemonState);
        } catch {
            // Corrupted or partially written — skip
        }
    }
    return states;
}

/** Delete a specific daemon's state file. Ignores ENOENT. */
export async function deleteDaemonState(pid: number): Promise<void> {
    try {
        await fs.unlink(stateFilePath(pid));
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
}

/** Check whether a PID is alive. */
function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EPERM") return true; // alive but owned by another user
        return false; // ESRCH — no such process
    }
}

/**
 * Check whether the daemon that wrote `state` is still the process running under its PID.
 * A bare liveness check is not enough: a stale state file's PID may have been reused by an
 * unrelated process (e.g. a state file written inside a Docker container whose PID maps to
 * a kernel thread on the host — issue #66).
 */
async function isDaemonStateAlive(state: DaemonState): Promise<boolean> {
    if (!isPidAlive(state.pid)) return false;
    if (state.procStartTime !== undefined) {
        const current = await getProcessStartTime(state.pid);
        if (current !== undefined) return current === state.procStartTime; // mismatch — PID was reused
        return true; // identity undeterminable — fall back to liveness only
    }
    // Legacy state file without procStartTime — heuristic: the command line must reference bitsocial
    const cmdline = await getProcessCommandLine(state.pid);
    if (cmdline === undefined) return true; // identity undeterminable — fall back to liveness only
    return cmdline.includes("bitsocial");
}

/** Delete state files for dead or reused PIDs from disk. */
export async function pruneStaleStates(): Promise<void> {
    await getAliveDaemonStates();
}

/** Read all states, delete stale files (dead or reused PIDs) from disk, return only alive ones. */
export async function getAliveDaemonStates(): Promise<DaemonState[]> {
    const states = await readAllDaemonStates();
    const alive: DaemonState[] = [];
    for (const state of states) {
        if (await isDaemonStateAlive(state)) {
            alive.push(state);
        } else {
            await deleteDaemonState(state.pid);
        }
    }
    return alive;
}
