import { describe, it, expect, vi } from "vitest";
import { runRepoGc, startRepoGcScheduler, DEFAULT_REPO_GC_INTERVAL_MS } from "../../src/ipfs/repoGc.js";

const silentLog: any = Object.assign(() => {}, { error: () => {}, trace: () => {} });

// Minimal kubo RPC stub: repo/gc streams one newline-delimited JSON object per reclaimed CID,
// exactly like the real endpoint.
const makeKuboStub = (options: { gcCids?: string[]; gcStatus?: number; gcErrors?: string[] } = {}) => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
        calls.push(url);
        if (!url.includes("repo/gc")) throw new Error(`unexpected kubo RPC call ${url}`);
        if (options.gcStatus && options.gcStatus >= 400)
            return new Response("nope", { status: options.gcStatus, statusText: "Server Error" });
        const lines = [
            ...(options.gcCids ?? []).map((cid) => JSON.stringify({ Key: { "/": cid }, Error: "" })),
            ...(options.gcErrors ?? []).map((err) => JSON.stringify({ Error: err }))
        ];
        return new Response(lines.join("\n"), { status: 200 });
    });
    return { fetchImpl, calls };
};

describe("runRepoGc (issue #119)", () => {
    it("GCs unconditionally — no repo/stat, no watermark check", async () => {
        const { fetchImpl, calls } = makeKuboStub({ gcCids: ["QmA", "QmB", "QmC"] });
        const outcome = await runRepoGc({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(true);
        expect(outcome.reclaimedCids).toBe(3);
        expect(calls.length).toBe(1);
        expect(calls[0]).toContain("repo/gc");
        expect(calls.some((url) => url.includes("repo/stat"))).toBe(false);
    });

    it("still reports success when kubo had nothing to collect", async () => {
        const { fetchImpl } = makeKuboStub({ gcCids: [] });
        const outcome = await runRepoGc({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(true);
        expect(outcome.reclaimedCids).toBe(0);
    });

    it("counts only reclaimed keys, not per-block errors in the stream", async () => {
        const { fetchImpl } = makeKuboStub({ gcCids: ["QmA"], gcErrors: ["could not remove QmZ"] });
        const outcome = await runRepoGc({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(true);
        expect(outcome.reclaimedCids).toBe(1);
    });

    it("resolves rather than throws when repo/gc fails", async () => {
        const { fetchImpl } = makeKuboStub({ gcStatus: 500 });
        const outcome = await runRepoGc({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(false);
    });

    // The daemon tracks kubo at its configured bind address, which is routinely a wildcard.
    // Connecting to 0.0.0.0 fails with EINVAL on macOS.
    it("rewrites a wildcard bind address to loopback before connecting", async () => {
        const { fetchImpl, calls } = makeKuboStub({ gcCids: [] });
        await runRepoGc({ kuboApiUrl: "http://0.0.0.0:5001/api/v0", log: silentLog, fetchImpl });

        expect(calls[0]).toContain("127.0.0.1");
        expect(calls[0]).not.toContain("0.0.0.0");
    });
});

describe("startRepoGcScheduler (issue #119)", () => {
    it("defaults to kubo's own 1h GC period", () => {
        expect(DEFAULT_REPO_GC_INTERVAL_MS).toBe(60 * 60 * 1000);
    });

    it("GCs on each interval tick and stops when told to", async () => {
        vi.useFakeTimers();
        try {
            const { fetchImpl, calls } = makeKuboStub({ gcCids: ["QmA"] });
            const stop = startRepoGcScheduler({
                kuboApiUrl: "http://127.0.0.1:5001/api/v0",
                intervalMs: 1000,
                log: silentLog,
                fetchImpl
            });

            expect(calls.length).toBe(0); // nothing on construction

            await vi.advanceTimersByTimeAsync(1000);
            expect(calls.length).toBe(1);

            await vi.advanceTimersByTimeAsync(2000);
            expect(calls.length).toBe(3); // one GC per interval

            stop();
            await vi.advanceTimersByTimeAsync(5000);
            expect(calls.length).toBe(3); // no further ticks after stop
        } finally {
            vi.useRealTimers();
        }
    });

    // A GC that outlives its own interval must not have a second one stacked on top of it — both
    // would contend for kubo's GC lock.
    it("does not stack a second GC on top of one still running", async () => {
        vi.useFakeTimers();
        try {
            let releaseGc: (() => void) | undefined;
            const gcStarted: number[] = [];
            const fetchImpl = vi.fn(async () => {
                gcStarted.push(1);
                await new Promise<void>((resolve) => (releaseGc = resolve));
                return new Response("");
            });

            const stop = startRepoGcScheduler({
                kuboApiUrl: "http://127.0.0.1:5001/api/v0",
                intervalMs: 1000,
                log: silentLog,
                fetchImpl: fetchImpl as any
            });

            await vi.advanceTimersByTimeAsync(1000);
            expect(gcStarted.length).toBe(1);

            // Three more intervals elapse while the first GC is still streaming.
            await vi.advanceTimersByTimeAsync(3000);
            expect(gcStarted.length).toBe(1);

            releaseGc?.();
            stop();
        } finally {
            vi.useRealTimers();
        }
    });

    // An interval callback that rejects becomes an unhandledRejection and takes the daemon down.
    it("does not emit an unhandledRejection when the kubo node is unreachable", async () => {
        vi.useFakeTimers();
        const unhandled: unknown[] = [];
        const handler = (err: unknown) => unhandled.push(err);
        process.on("unhandledRejection", handler);
        try {
            const fetchImpl = vi.fn(async () => {
                throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
            });
            const stop = startRepoGcScheduler({
                kuboApiUrl: "http://127.0.0.1:5001/api/v0",
                intervalMs: 1000,
                log: silentLog,
                fetchImpl: fetchImpl as any
            });

            await vi.advanceTimersByTimeAsync(3000);
            stop();
            await vi.advanceTimersByTimeAsync(0);
        } finally {
            process.off("unhandledRejection", handler);
            vi.useRealTimers();
        }
        expect(unhandled).toEqual([]);
    });
});
