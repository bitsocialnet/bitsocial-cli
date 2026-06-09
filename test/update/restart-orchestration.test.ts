import { describe, it, expect } from "vitest";
import {
    planDaemonRestarts,
    stopUnmanagedDaemons,
    startUnmanagedDaemons,
    restartManagedDaemons,
    type DaemonLifecycle
} from "../../dist/update/restart-orchestration.js";
import type { DaemonState, DaemonSupervisor } from "../../dist/common-utils/daemon-state.js";

// Restart routing for issue #82: supervised daemons go through their supervisor, unsupervised ones
// are stopped + detached-respawned by the updater. Driven by a recording fake lifecycle.

const mkDaemon = (pid: number, supervisor?: DaemonSupervisor): DaemonState => ({
    pid,
    startedAt: "t",
    argv: [],
    pkcRpcUrl: `ws://localhost:${pid}`,
    ...(supervisor ? { supervisor } : {})
});

const systemd = (unit: string): DaemonSupervisor => ({ type: "systemd", unit });

function recordingLifecycle() {
    const calls: string[] = [];
    const lifecycle: DaemonLifecycle = {
        stopUnmanaged: async (d) => void calls.push(`stop:${d.pid}`),
        startUnmanaged: async (d) => void calls.push(`start:${d.pid}`),
        restartManaged: async (s) => void calls.push(`restart:${s.unit}`)
    };
    return { lifecycle, calls };
}

// Resolver used by planDaemonRestarts in these tests: trust the daemon's own supervisor field.
const resolveByField = async (d: DaemonState) => d.supervisor;

describe("planDaemonRestarts", () => {
    it("partitions daemons into supervised vs. unsupervised", async () => {
        const managedDaemon = mkDaemon(1, systemd("bitsocial.service"));
        const plainDaemon = mkDaemon(2);
        const plan = await planDaemonRestarts([managedDaemon, plainDaemon], resolveByField);

        expect(plan.managed).toEqual([{ daemon: managedDaemon, supervisor: systemd("bitsocial.service") }]);
        expect(plan.unmanaged).toEqual([plainDaemon]);
    });

    it("uses the (possibly async) resolver, not just the field", async () => {
        const legacy = mkDaemon(3); // no supervisor field — resolver infers one (e.g. from cgroup)
        const plan = await planDaemonRestarts([legacy], async () => systemd("inferred.service"));
        expect(plan.managed.map((m) => m.supervisor.unit)).toEqual(["inferred.service"]);
        expect(plan.unmanaged).toEqual([]);
    });
});

describe("stopUnmanagedDaemons", () => {
    it("stops only unsupervised daemons, in order, and never touches supervised ones", async () => {
        const plan = await planDaemonRestarts([mkDaemon(1, systemd("a.service")), mkDaemon(2), mkDaemon(3)], resolveByField);
        const { lifecycle, calls } = recordingLifecycle();
        await stopUnmanagedDaemons(plan, lifecycle);
        expect(calls).toEqual(["stop:2", "stop:3"]);
    });
});

describe("startUnmanagedDaemons", () => {
    it("re-spawns only unsupervised daemons", async () => {
        const plan = await planDaemonRestarts([mkDaemon(1, systemd("a.service")), mkDaemon(2)], resolveByField);
        const { lifecycle, calls } = recordingLifecycle();
        await startUnmanagedDaemons(plan, lifecycle);
        expect(calls).toEqual(["start:2"]);
    });
});

describe("restartManagedDaemons", () => {
    it("restarts each supervised unit and never spawns/stops an unsupervised daemon", async () => {
        const plan = await planDaemonRestarts([mkDaemon(1, systemd("a.service")), mkDaemon(2)], resolveByField);
        const { lifecycle, calls } = recordingLifecycle();
        await restartManagedDaemons(plan, lifecycle);
        expect(calls).toEqual(["restart:a.service"]);
    });

    it("deduplicates by unit so a shared unit is restarted once", async () => {
        const plan = await planDaemonRestarts(
            [mkDaemon(1, systemd("shared.service")), mkDaemon(2, systemd("shared.service")), mkDaemon(3, systemd("other.service"))],
            resolveByField
        );
        const { lifecycle, calls } = recordingLifecycle();
        await restartManagedDaemons(plan, lifecycle);
        expect(calls).toEqual(["restart:shared.service", "restart:other.service"]);
    });
});

describe("full update sequence (mixed daemons)", () => {
    it("stops/respawns the unsupervised daemon but only restarts the supervised one via its supervisor", async () => {
        const managed = mkDaemon(10, systemd("bitsocial.service"));
        const plain = mkDaemon(20);
        const plan = await planDaemonRestarts([managed, plain], resolveByField);
        const { lifecycle, calls } = recordingLifecycle();

        // Mirrors install.ts: stop unsupervised → (binary swap) → respawn unsupervised + restart supervised.
        await stopUnmanagedDaemons(plan, lifecycle);
        await startUnmanagedDaemons(plan, lifecycle);
        await restartManagedDaemons(plan, lifecycle);

        expect(calls).toEqual(["stop:20", "start:20", "restart:bitsocial.service"]);
        // The supervised daemon (pid 10) is never SIGINT'd or detached-spawned — the bug's root cause.
        expect(calls).not.toContain("stop:10");
        expect(calls).not.toContain("start:10");
    });
});
