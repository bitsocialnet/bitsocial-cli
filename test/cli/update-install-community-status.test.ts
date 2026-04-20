import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EventEmitter from "events";

vi.mock("@pkcprotocol/pkc-js", () => ({
    default: vi.fn()
}));

vi.mock("tcp-port-used", () => ({
    default: {
        waitUntilFree: vi.fn().mockResolvedValue(undefined),
        waitUntilUsed: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock("child_process", async () => {
    const actual = await vi.importActual<typeof import("child_process")>("child_process");
    return {
        ...actual,
        spawn: vi.fn(() => ({ pid: 99999, unref: vi.fn() }))
    };
});

vi.mock("../../src/common-utils/daemon-state.js", () => ({
    getAliveDaemonStates: vi.fn().mockResolvedValue([])
}));

vi.mock("../../src/update/npm-registry.js", () => ({
    fetchLatestVersion: vi.fn().mockResolvedValue("99.99.99"),
    installGlobal: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../src/update/semver.js", () => ({
    compareVersions: vi.fn().mockReturnValue(-1)
}));

describe("update install — community status reporting", () => {
    let logOutput: string[];
    let warnOutput: string[];

    beforeEach(() => {
        vi.useFakeTimers();
        logOutput = [];
        warnOutput = [];
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    async function createInstallCommand() {
        const mod = await import("../../src/cli/commands/update/install.js");
        const Install = mod.default;
        const cmd = new Install([], { version: "0.0.1" } as any) as any;
        cmd.log = (...args: any[]) => logOutput.push(args.join(" "));
        cmd.warn = (...args: any[]) => warnOutput.push(args.join(" "));
        cmd.parse = vi.fn().mockResolvedValue({
            args: { version: "latest" },
            flags: { force: false, "restart-daemons": true }
        });
        cmd.error = vi.fn((msg: string) => {
            throw new Error(msg);
        });
        return cmd;
    }

    function setupOneDaemon() {
        return import("../../src/common-utils/daemon-state.js").then(({ getAliveDaemonStates }) => {
            vi.mocked(getAliveDaemonStates).mockResolvedValue([
                { pid: 12345, startedAt: "2026-01-01", argv: [], pkcRpcUrl: "ws://localhost:39123" }
            ]);
        });
    }

    function setupPkcMock(fakePkc: any) {
        return import("@pkcprotocol/pkc-js").then(({ default: PKCMock }) => {
            vi.mocked(PKCMock).mockImplementation(async () => {
                setTimeout(() => {
                    fakePkc.emit("communitieschange");
                    fakePkc.communities = fakePkc._communities;
                    fakePkc.emit("communitieschange");
                }, 0);
                return fakePkc as any;
            });
        });
    }

    it("prints all started when all communities are started on first poll", async () => {
        await setupOneDaemon();

        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            _communities: ["community1.bso", "community2.bso"],
            createCommunity: vi.fn().mockResolvedValue({ started: true }),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        await setupPkcMock(fakePkc);

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        // Flush microtasks to let communitieschange fire and polling start
        await vi.advanceTimersByTimeAsync(0);
        await runPromise;

        const joined = logOutput.join("\n");
        expect(joined).toContain("All 2 communities started");
    });

    it("waits and shows progress as communities start progressively", async () => {
        await setupOneDaemon();

        const communityObjs = [
            { started: false },
            { started: false },
            { started: false }
        ];
        let callIdx = 0;
        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            _communities: ["c1.bso", "c2.bso", "c3.bso"],
            createCommunity: vi.fn().mockImplementation(async () => communityObjs[callIdx++]),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        await setupPkcMock(fakePkc);

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        // Flush microtasks — first poll sees 0 started
        await vi.advanceTimersByTimeAsync(0);

        // After first poll interval, 1 community starts
        communityObjs[0].started = true;
        await vi.advanceTimersByTimeAsync(2000);

        // After second poll interval, all 3 start
        communityObjs[1].started = true;
        communityObjs[2].started = true;
        await vi.advanceTimersByTimeAsync(2000);

        await runPromise;

        const joined = logOutput.join("\n");
        expect(joined).toContain("1 of 3 communities started...");
        expect(joined).toContain("All 3 communities started");
    });

    it("reports partial status when timeout is reached with some started", async () => {
        await setupOneDaemon();

        const communityObjs = [
            { started: true },
            { started: false },
            { started: false }
        ];
        let callIdx = 0;
        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            _communities: ["c1.bso", "c2.bso", "c3.bso"],
            createCommunity: vi.fn().mockImplementation(async () => communityObjs[callIdx++]),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        await setupPkcMock(fakePkc);

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        // Flush microtasks
        await vi.advanceTimersByTimeAsync(0);

        // Advance past the 120s timeout
        await vi.advanceTimersByTimeAsync(120_000);

        await runPromise;

        const joined = logOutput.join("\n");
        expect(joined).toContain("1 of 3 communities started (remaining still loading)");
    });

    it("reports still loading when timeout is reached with none started", async () => {
        await setupOneDaemon();

        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            _communities: ["community1.bso", "community2.bso"],
            createCommunity: vi.fn().mockResolvedValue({ started: false }),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        await setupPkcMock(fakePkc);

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        // Flush microtasks
        await vi.advanceTimersByTimeAsync(0);

        // Advance past timeout
        await vi.advanceTimersByTimeAsync(120_000);

        await runPromise;

        const joined = logOutput.join("\n");
        expect(joined).toContain("2 communities in data path (still loading)");
        expect(joined).toContain("bitsocial community list");
    });

    it("prints nothing when there are no communities", async () => {
        await setupOneDaemon();

        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            createCommunity: vi.fn(),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        // Use the test override to skip the 20s timeout for the no-communities case
        const globalWithOverride = globalThis as { __PKC_RPC_CONNECT_OVERRIDE?: any };
        globalWithOverride.__PKC_RPC_CONNECT_OVERRIDE = async () => fakePkc;
        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        vi.mocked(PKCMock).mockImplementation(async () => {
            return fakePkc as any;
        });

        const cmd = await createInstallCommand();
        try {
            await cmd.run();
        } finally {
            delete globalWithOverride.__PKC_RPC_CONNECT_OVERRIDE;
        }

        const joined = logOutput.join("\n");
        expect(joined).not.toContain("communities");
        expect(joined).not.toContain("community");
    });

    it("warns but does not crash when RPC connection fails", async () => {
        await setupOneDaemon();

        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        vi.mocked(PKCMock).mockRejectedValue(new Error("Connection refused"));

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        // Advance timers to flush the _connectToRpc timeout
        await vi.advanceTimersByTimeAsync(20_000);

        await runPromise;

        const joinedWarns = warnOutput.join("\n");
        expect(joinedWarns).toContain("Could not check community status");
    });

    it("prints singular 'community' for a single community", async () => {
        await setupOneDaemon();

        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            _communities: ["community1.bso"],
            createCommunity: vi.fn().mockResolvedValue({ started: true }),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        await setupPkcMock(fakePkc);

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        await vi.advanceTimersByTimeAsync(0);
        await runPromise;

        const joined = logOutput.join("\n");
        expect(joined).toContain("All 1 community started");
        expect(joined).not.toContain("communities started");
    });

    it("does not emit duplicate progress lines when count is unchanged", async () => {
        await setupOneDaemon();

        const communityObjs = [
            { started: false },
            { started: false },
            { started: false }
        ];
        let callIdx = 0;
        const fakePkc = Object.assign(new EventEmitter(), {
            communities: [] as string[],
            _communities: ["c1.bso", "c2.bso", "c3.bso"],
            createCommunity: vi.fn().mockImplementation(async () => communityObjs[callIdx++]),
            destroy: vi.fn().mockResolvedValue(undefined)
        });
        await setupPkcMock(fakePkc);

        const cmd = await createInstallCommand();
        const runPromise = cmd.run();

        // Flush microtasks — first poll sees 0 started
        await vi.advanceTimersByTimeAsync(0);

        // 1 community starts
        communityObjs[0].started = true;
        await vi.advanceTimersByTimeAsync(2000);

        // Still 1 started on next poll — no duplicate line
        await vi.advanceTimersByTimeAsync(2000);

        // All 3 start
        communityObjs[1].started = true;
        communityObjs[2].started = true;
        await vi.advanceTimersByTimeAsync(2000);

        await runPromise;

        const joined = logOutput.join("\n");
        // "1 of 3" should appear exactly once
        const matches = joined.match(/1 of 3 communities started\.\.\./g);
        expect(matches).toHaveLength(1);
        expect(joined).toContain("All 3 communities started");
    });
});
