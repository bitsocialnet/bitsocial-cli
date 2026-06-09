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

/**
 * How a daemon's lifecycle is managed by an external supervisor. Recorded at startup so that
 * `update install` restarts the daemon through its supervisor instead of spawning a detached
 * replacement that would compete with the supervisor for the RPC port (issue #82).
 */
export interface DaemonSupervisor {
    /** The supervisor managing this daemon. Only systemd is detected today. */
    type: "systemd";
    /** The unit that owns the daemon, e.g. "bitsocial.service". */
    unit: string;
}

export interface DaemonState {
    pid: number;
    startedAt: string;
    argv: string[];
    pkcRpcUrl: string;
    /** OS-reported process start time, used to detect PID reuse. Absent in legacy state files. */
    procStartTime?: string;
    /** External supervisor managing this daemon, if any. Absent for standalone or legacy daemons. */
    supervisor?: DaemonSupervisor;
}

/**
 * Parse the systemd service unit a process belongs to out of its cgroup contents, or undefined.
 *   cgroup v2: a single line `0::/system.slice/bitsocial.service`
 *   cgroup v1: many `id:controller:/system.slice/bitsocial.service` lines (all point at the same unit)
 * The unit is the leaf of the cgroup path when it ends in `.service`. A user session has a `.scope`
 * leaf (e.g. `…/session-36.scope`) — not a service — so it returns undefined (that daemon is not
 * systemd-supervised even if it happens to live under system.slice somewhere up the tree).
 */
export function parseSystemdUnitFromCgroup(content: string): string | undefined {
    for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        // hierarchy-id:controller-list:cgroup-path — the path is the last colon-separated field
        const cgroupPath = line.slice(line.lastIndexOf(":") + 1);
        const leaf = cgroupPath.slice(cgroupPath.lastIndexOf("/") + 1);
        if (leaf.endsWith(".service")) return leaf;
    }
    return undefined;
}

/** Read the systemd unit owning `pid` (or the current process when "self") from /proc, or undefined. */
export async function readSystemdUnit(pid: number | "self"): Promise<string | undefined> {
    try {
        const content = await fs.readFile(`/proc/${pid}/cgroup`, "utf-8");
        return parseSystemdUnitFromCgroup(content);
    } catch {
        return undefined; // no /proc (non-Linux) or unreadable — treat as unsupervised
    }
}

/**
 * Detect whether THIS process was started by systemd, and under which unit. systemd sets
 * $INVOCATION_ID for every service it spawns; the unit name comes from this process's own cgroup.
 * `env`/`readUnit` are injectable for testing. Returns undefined when not systemd-supervised.
 */
export async function detectSelfSupervisor(
    env: NodeJS.ProcessEnv = process.env,
    readUnit: (pid: number | "self") => Promise<string | undefined> = readSystemdUnit
): Promise<DaemonSupervisor | undefined> {
    if (!env.INVOCATION_ID) return undefined;
    const unit = await readUnit("self");
    return unit ? { type: "systemd", unit } : undefined;
}

/**
 * Resolve the supervisor for a daemon described by `state`. Prefers the `supervisor` it recorded
 * at startup; for legacy daemons that predate that field, falls back to inferring the unit from the
 * live process's cgroup. `readUnit` is injectable for testing.
 */
export async function resolveDaemonSupervisor(
    state: DaemonState,
    readUnit: (pid: number | "self") => Promise<string | undefined> = readSystemdUnit
): Promise<DaemonSupervisor | undefined> {
    if (state.supervisor) return state.supervisor;
    const unit = await readUnit(state.pid);
    return unit ? { type: "systemd", unit } : undefined;
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
