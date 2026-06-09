import { describe, it, expect, afterEach } from "vitest";
import {
    parseSystemdUnitFromCgroup,
    detectSelfSupervisor,
    resolveDaemonSupervisor,
    writeDaemonState,
    readAllDaemonStates,
    deleteDaemonState
} from "../../dist/common-utils/daemon-state.js";
import type { DaemonState, DaemonSupervisor } from "../../dist/common-utils/daemon-state.js";

// Supervisor detection/resolution for issue #82. The parser is pure; detect/resolve take an
// injectable cgroup reader so we never depend on the test runner's own cgroup.

describe("parseSystemdUnitFromCgroup", () => {
    it("extracts the unit from a cgroup v2 service line", () => {
        expect(parseSystemdUnitFromCgroup("0::/system.slice/bitsocial.service")).toBe("bitsocial.service");
    });

    it("returns undefined for a user session scope (not a service)", () => {
        expect(parseSystemdUnitFromCgroup("0::/user.slice/user-0.slice/session-36.scope")).toBeUndefined();
    });

    it("parses a cgroup v1 multi-line file (all controllers point at the same unit)", () => {
        const v1 = ["12:pids:/system.slice/bitsocial.service", "8:memory:/system.slice/bitsocial.service", "1:name=systemd:/system.slice/bitsocial.service"].join("\n");
        expect(parseSystemdUnitFromCgroup(v1)).toBe("bitsocial.service");
    });

    it("handles a templated/instanced unit name", () => {
        expect(parseSystemdUnitFromCgroup("0::/system.slice/system-foo.slice/foo@1.service")).toBe("foo@1.service");
    });

    it("ignores blank lines and trailing newlines", () => {
        expect(parseSystemdUnitFromCgroup("\n0::/system.slice/bitsocial.service\n\n")).toBe("bitsocial.service");
    });

    it("returns undefined for the root cgroup", () => {
        expect(parseSystemdUnitFromCgroup("0::/")).toBeUndefined();
    });

    it("returns undefined for empty content", () => {
        expect(parseSystemdUnitFromCgroup("")).toBeUndefined();
    });
});

describe("detectSelfSupervisor", () => {
    it("returns undefined when INVOCATION_ID is absent (not started by systemd)", async () => {
        const sup = await detectSelfSupervisor({}, async () => "bitsocial.service");
        expect(sup).toBeUndefined();
    });

    it("returns the systemd unit when INVOCATION_ID is set and the cgroup is a service", async () => {
        const sup = await detectSelfSupervisor({ INVOCATION_ID: "abc" }, async () => "bitsocial.service");
        expect(sup).toEqual({ type: "systemd", unit: "bitsocial.service" });
    });

    it("returns undefined when INVOCATION_ID is set but the cgroup is not a service", async () => {
        const sup = await detectSelfSupervisor({ INVOCATION_ID: "abc" }, async () => undefined);
        expect(sup).toBeUndefined();
    });
});

describe("resolveDaemonSupervisor", () => {
    const base: DaemonState = { pid: 4242, startedAt: "t", argv: [], pkcRpcUrl: "ws://localhost:9138" };

    it("prefers the supervisor recorded in the state file (and never reads the cgroup)", async () => {
        const recorded: DaemonSupervisor = { type: "systemd", unit: "recorded.service" };
        const sup = await resolveDaemonSupervisor({ ...base, supervisor: recorded }, async () => {
            throw new Error("readUnit must not be called when the state file already records a supervisor");
        });
        expect(sup).toEqual(recorded);
    });

    it("falls back to the process cgroup for a legacy daemon (no supervisor field)", async () => {
        const sup = await resolveDaemonSupervisor(base, async (pid) => {
            expect(pid).toBe(base.pid);
            return "bitsocial.service";
        });
        expect(sup).toEqual({ type: "systemd", unit: "bitsocial.service" });
    });

    it("returns undefined for a legacy daemon whose cgroup is not a service", async () => {
        const sup = await resolveDaemonSupervisor(base, async () => undefined);
        expect(sup).toBeUndefined();
    });
});

describe("writeDaemonState round-trips the supervisor field", () => {
    const createdPids: number[] = [];
    afterEach(async () => {
        for (const pid of createdPids) await deleteDaemonState(pid);
        createdPids.length = 0;
    });

    it("persists and reads back the supervisor", async () => {
        const pid = 9999700;
        createdPids.push(pid);
        const supervisor: DaemonSupervisor = { type: "systemd", unit: "bitsocial.service" };
        await writeDaemonState({ pid, startedAt: new Date().toISOString(), argv: [], pkcRpcUrl: `ws://localhost:${pid}`, supervisor });

        const found = (await readAllDaemonStates()).find((s) => s.pid === pid);
        expect(found?.supervisor).toEqual(supervisor);
    });

    it("omits the supervisor for an unsupervised daemon", async () => {
        const pid = 9999701;
        createdPids.push(pid);
        await writeDaemonState({ pid, startedAt: new Date().toISOString(), argv: [], pkcRpcUrl: `ws://localhost:${pid}` });

        const found = (await readAllDaemonStates()).find((s) => s.pid === pid);
        expect(found?.supervisor).toBeUndefined();
    });
});
