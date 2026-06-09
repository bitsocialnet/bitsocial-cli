import type { DaemonState, DaemonSupervisor } from "../common-utils/daemon-state.js";

// Routes `update install`'s daemon restarts by supervisor (issue #82).
//
// Unsupervised daemons are managed directly by the updater: stopped (SIGINT) before the binary swap
// and re-spawned detached afterwards. Supervised daemons (e.g. systemd) are NOT touched by the
// updater — stopping/respawning one ourselves spawns a process the supervisor does not own, which
// then competes with the supervisor for the RPC port and triggers a restart loop. Instead we leave
// the supervised daemon running across the binary swap and ask its supervisor to restart it.
//
// The logic here is split from the side effects (in install.ts) so it can be unit-tested with a fake
// DaemonLifecycle.

export interface ManagedDaemon {
    daemon: DaemonState;
    supervisor: DaemonSupervisor;
}

export interface DaemonPlan {
    /** Daemons restarted through their supervisor (left running across the binary swap). */
    managed: ManagedDaemon[];
    /** Daemons the updater stops and re-spawns itself. */
    unmanaged: DaemonState[];
}

/** The side effects of restarting daemons; injected so the orchestration is testable. */
export interface DaemonLifecycle {
    /** Take an unsupervised daemon down (SIGINT) and wait for it to fully exit, before the binary swap. */
    stopUnmanaged(daemon: DaemonState): Promise<void>;
    /** Re-spawn an unsupervised daemon as a detached process with its original args, after the binary swap. */
    startUnmanaged(daemon: DaemonState): Promise<void>;
    /** Ask a supervisor to restart its daemon onto the new binary (e.g. `systemctl restart <unit>`). */
    restartManaged(supervisor: DaemonSupervisor): Promise<void>;
}

/** Partition the alive daemons into supervised vs. updater-managed. */
export async function planDaemonRestarts(
    daemons: DaemonState[],
    resolve: (daemon: DaemonState) => Promise<DaemonSupervisor | undefined>
): Promise<DaemonPlan> {
    const managed: ManagedDaemon[] = [];
    const unmanaged: DaemonState[] = [];
    for (const daemon of daemons) {
        const supervisor = await resolve(daemon);
        if (supervisor) managed.push({ daemon, supervisor });
        else unmanaged.push(daemon);
    }
    return { managed, unmanaged };
}

/**
 * Stop the daemons that must come down before the binary swap: only the unsupervised ones.
 * Supervised daemons keep running — their supervisor restarts them after the swap.
 */
export async function stopUnmanagedDaemons(plan: DaemonPlan, lifecycle: DaemonLifecycle): Promise<void> {
    for (const daemon of plan.unmanaged) await lifecycle.stopUnmanaged(daemon);
}

/** Re-spawn the unsupervised daemons that were stopped. Safe to call even after a no-op update. */
export async function startUnmanagedDaemons(plan: DaemonPlan, lifecycle: DaemonLifecycle): Promise<void> {
    for (const daemon of plan.unmanaged) await lifecycle.startUnmanaged(daemon);
}

/**
 * Restart supervised daemons onto the new binary, deduplicated per unit. Call only after a real
 * install — a no-op update shouldn't bounce a supervised service, since it was never stopped.
 */
export async function restartManagedDaemons(plan: DaemonPlan, lifecycle: DaemonLifecycle): Promise<void> {
    const restarted = new Set<string>();
    for (const { supervisor } of plan.managed) {
        const key = `${supervisor.type}:${supervisor.unit}`;
        if (restarted.has(key)) continue;
        restarted.add(key);
        await lifecycle.restartManaged(supervisor);
    }
}
