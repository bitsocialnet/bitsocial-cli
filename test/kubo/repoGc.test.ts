import { describe, it, expect, vi } from "vitest";
import { runRepoGcIfDue, startRepoGcScheduler, GC_HIGH_WATERMARK, DEFAULT_REPO_GC_INTERVAL_MS } from "../../src/ipfs/repoGc.js";

const STORAGE_MAX = 10_000_000_000;

const silentLog: any = Object.assign(() => {}, { error: () => {}, trace: () => {} });

// Minimal kubo RPC stub: repo/stat answers with the sizes the case needs, repo/gc streams one
// newline-delimited JSON object per reclaimed CID exactly like the real endpoint.
const makeKuboStub = (options: {
    repoSizes: number[];
    storageMax?: number;
    gcCids?: string[];
    statStatus?: number;
    gcStatus?: number;
}) => {
    const calls: string[] = [];
    let statCall = 0;
    const fetchImpl = vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("repo/stat")) {
            if (options.statStatus && options.statStatus >= 400)
                return new Response("nope", { status: options.statStatus, statusText: "Server Error" });
            const size = options.repoSizes[Math.min(statCall++, options.repoSizes.length - 1)];
            return new Response(JSON.stringify({ RepoSize: size, StorageMax: options.storageMax ?? STORAGE_MAX }), { status: 200 });
        }
        if (url.includes("repo/gc")) {
            if (options.gcStatus && options.gcStatus >= 400)
                return new Response("nope", { status: options.gcStatus, statusText: "Server Error" });
            const body = (options.gcCids ?? []).map((cid) => JSON.stringify({ Key: { "/": cid }, Error: "" })).join("\n");
            return new Response(body, { status: 200 });
        }
        throw new Error(`unexpected kubo RPC call ${url}`);
    });
    return { fetchImpl, calls };
};

describe("runRepoGcIfDue (issue #119)", () => {
    it("skips GC when the repo is below the 90% StorageMax watermark", async () => {
        const { fetchImpl, calls } = makeKuboStub({ repoSizes: [STORAGE_MAX * 0.5] });
        const outcome = await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(false);
        expect(outcome.skippedReason).toBe("below-watermark");
        expect(calls.some((url) => url.includes("repo/gc"))).toBe(false);
    });

    it("runs GC once the repo crosses the watermark, and reports what it reclaimed", async () => {
        const before = STORAGE_MAX * GC_HIGH_WATERMARK + 1;
        const { fetchImpl, calls } = makeKuboStub({ repoSizes: [before, 1_000], gcCids: ["QmA", "QmB", "QmC"] });
        const outcome = await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(true);
        expect(outcome.reclaimedCids).toBe(3);
        expect(outcome.repoSizeBefore).toBe(before);
        expect(outcome.repoSizeAfter).toBe(1_000);
        expect(calls.some((url) => url.includes("repo/gc"))).toBe(true);
    });

    it("asks for size-only repo stats so it does not walk the whole blockstore", async () => {
        const { fetchImpl, calls } = makeKuboStub({ repoSizes: [1] });
        await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(calls[0]).toContain("size-only=true");
    });

    it("GCs on the interval alone when the daemon reports no StorageMax ceiling", async () => {
        const { fetchImpl } = makeKuboStub({ repoSizes: [1_000, 500], storageMax: 0, gcCids: ["QmA"] });
        const outcome = await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(true);
    });

    it("skips the watermark check when forced", async () => {
        const { fetchImpl, calls } = makeKuboStub({ repoSizes: [1_000], gcCids: ["QmA"] });
        const outcome = await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, force: true, fetchImpl });

        expect(outcome.ran).toBe(true);
        // Goes straight to repo/gc — the only repo/stat is the follow-up that measures what was
        // reclaimed, never a pre-GC watermark check.
        expect(calls[0]).toContain("repo/gc");
        expect(calls.filter((url) => url.includes("repo/stat")).length).toBe(1);
    });

    it("backs off instead of blindly GCing when repo/stat fails", async () => {
        const { fetchImpl, calls } = makeKuboStub({ repoSizes: [1], statStatus: 500 });
        const outcome = await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(false);
        expect(outcome.skippedReason).toBe("repo-stat-failed");
        expect(calls.some((url) => url.includes("repo/gc"))).toBe(false);
    });

    it("resolves rather than throws when repo/gc itself fails", async () => {
        const { fetchImpl } = makeKuboStub({ repoSizes: [STORAGE_MAX], gcStatus: 500 });
        const outcome = await runRepoGcIfDue({ kuboApiUrl: "http://127.0.0.1:5001/api/v0", log: silentLog, fetchImpl });

        expect(outcome.ran).toBe(false);
        expect(outcome.skippedReason).toBe("gc-failed");
    });

    // The daemon tracks kubo at its configured bind address, which is routinely a wildcard.
    // Connecting to 0.0.0.0 fails with EINVAL on macOS.
    it("rewrites a wildcard bind address to loopback before connecting", async () => {
        const { fetchImpl, calls } = makeKuboStub({ repoSizes: [1] });
        await runRepoGcIfDue({ kuboApiUrl: "http://0.0.0.0:5001/api/v0", log: silentLog, fetchImpl });

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
            const { fetchImpl, calls } = makeKuboStub({ repoSizes: [STORAGE_MAX], gcCids: ["QmA"] });
            const stop = startRepoGcScheduler({
                kuboApiUrl: "http://127.0.0.1:5001/api/v0",
                intervalMs: 1000,
                log: silentLog,
                fetchImpl
            });

            expect(calls.length).toBe(0); // nothing on construction

            await vi.advanceTimersByTimeAsync(1000);
            expect(calls.some((url) => url.includes("repo/gc"))).toBe(true);
            const afterFirstTick = calls.length;

            stop();
            await vi.advanceTimersByTimeAsync(5000);
            expect(calls.length).toBe(afterFirstTick); // no further ticks after stop
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
            const fetchImpl = vi.fn(async (url: string) => {
                if (url.includes("repo/stat")) return new Response(JSON.stringify({ RepoSize: STORAGE_MAX, StorageMax: STORAGE_MAX }));
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
