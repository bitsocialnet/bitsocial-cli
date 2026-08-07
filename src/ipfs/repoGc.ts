import { PKCLogger } from "../util.js";

// GC once the repo is within this fraction of Datastore.StorageMax. kubo's own `--enable-gc`
// makes the same decision from Datastore.StorageGCWatermark (default 90) and so does pkc-js's
// cleanUpIpfsRepoIfDue, so we mirror it rather than invent a third policy.
export const GC_HIGH_WATERMARK = 0.9;

// Matches kubo's default Datastore.GCPeriod. A repo that is over the watermark tends to STAY over
// it (GC only reclaims unpinned blocks), so this interval is the floor between runs, not a promise
// that anything is reclaimed each time.
export const DEFAULT_REPO_GC_INTERVAL_MS = 60 * 60 * 1000;

export type RepoGcOutcome = {
    ran: boolean;
    skippedReason?: "below-watermark" | "repo-stat-failed" | "gc-failed";
    reclaimedCids?: number;
    repoSizeBefore?: number;
    repoSizeAfter?: number;
    storageMax?: number;
};

type FetchLike = (input: string, init?: { method?: string; signal?: AbortSignal }) => Promise<Response>;

// The daemon tracks kubo at its configured bind address, which is routinely a wildcard
// (`http://0.0.0.0:5001/api/v0`). Connecting to 0.0.0.0 fails with EINVAL on macOS, so resolve
// wildcards to loopback the same way daemon.ts does for its port checks.
function toConnectableApiBase(kuboApiUrl: URL | string): string {
    const url = new URL(String(kuboApiUrl));
    if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
    else if (url.hostname === "::" || url.hostname === "[::]") url.hostname = "[::1]";
    return url.toString().replace(/\/+$/, "");
}

async function postRpc(fetchImpl: FetchLike, apiBase: string, pathAndQuery: string, signal?: AbortSignal): Promise<Response> {
    const response = await fetchImpl(`${apiBase}/${pathAndQuery}`, { method: "POST", signal });
    if (!response.ok) throw new Error(`kubo RPC ${pathAndQuery} responded ${response.status} ${response.statusText}`);
    return response;
}

// `size-only` matters: the default repo/stat also counts every object, which walks the entire
// flatfs blockstore. On the repos this feature exists for that is millions of files.
async function readRepoStat(
    fetchImpl: FetchLike,
    apiBase: string,
    signal?: AbortSignal
): Promise<{ repoSize: number; storageMax: number }> {
    const response = await postRpc(fetchImpl, apiBase, "repo/stat?size-only=true", signal);
    const body = (await response.json()) as { RepoSize?: number; StorageMax?: number };
    return { repoSize: Number(body.RepoSize ?? 0), storageMax: Number(body.StorageMax ?? 0) };
}

/**
 * Runs `repo gc` over the kubo RPC API if the repo has crossed the watermark.
 *
 * We drive GC over RPC rather than passing kubo's own `--enable-gc` daemon flag. A kubo daemon
 * started with `--enable-gc` never exits in response to `POST /api/v0/shutdown` — it logs
 * "cannot access config, repo not open" and lingers indefinitely as a half-shutdown zombie
 * (SIGTERM still works; verified permanent past 300s). pkc-js POSTs that exact endpoint when it
 * rewrites the kubo Routing config on first connect and relies on the daemon restarting kubo
 * afterwards, so `--enable-gc` wedges the supervision loop.
 *
 * Reported upstream as ipfs/kubo#11424: `maybeRunGC` gives `PeriodicGC` the command request
 * context, but the shutdown command only calls `nd.Close()`, which cancels the node context — so
 * `gcErrc` never closes and `daemonFunc` blocks forever draining it. Reproduces on 0.24.0, 0.42.0
 * and 0.43.0, which is also why the earlier attempt at the flag (f228d7d, Dec 2023, kubo ~0.24)
 * was reverted two days later. Do not add `--enable-gc` back without re-testing that path.
 *
 * `force` skips the watermark check but is still subject to the caller's interval.
 */
export async function runRepoGcIfDue(options: {
    kuboApiUrl: URL | string;
    log?: any;
    force?: boolean;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
}): Promise<RepoGcOutcome> {
    const log = options.log ?? PKCLogger("bitsocial-cli:ipfs:repoGc");
    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    const apiBase = toConnectableApiBase(options.kuboApiUrl);

    let repoSizeBefore: number | undefined;
    let storageMax: number | undefined;

    if (!options.force) {
        let stat: { repoSize: number; storageMax: number };
        try {
            stat = await readRepoStat(fetchImpl, apiBase, options.signal);
        } catch (error) {
            // A daemon we can't stat is one to back off from, not to blindly GC.
            log.error?.("Skipping repo gc: failed to read repo/stat from the kubo node", apiBase, error);
            return { ran: false, skippedReason: "repo-stat-failed" };
        }
        repoSizeBefore = stat.repoSize;
        storageMax = stat.storageMax;

        // storageMax comes from Datastore.StorageMax. If the daemon reports no ceiling there is
        // nothing to compare against, so fall back to GCing on the interval alone rather than
        // never GCing at all.
        if (stat.storageMax > 0) {
            const threshold = stat.storageMax * GC_HIGH_WATERMARK;
            if (stat.repoSize < threshold) {
                log.trace?.(
                    `Skipping repo gc on ${apiBase} - repo size ${stat.repoSize} is below the ${GC_HIGH_WATERMARK * 100}% watermark ${threshold} of StorageMax ${stat.storageMax}`
                );
                return { ran: false, skippedReason: "below-watermark", repoSizeBefore, storageMax };
            }
        }
    }

    let reclaimedCids = 0;
    try {
        const response = await postRpc(fetchImpl, apiBase, "repo/gc?quiet=true", options.signal);
        // repo/gc streams newline-delimited JSON, one object per reclaimed CID. Draining it fully
        // is what makes this await mean "GC finished" rather than "GC started".
        const text = await response.text();
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const parsed = JSON.parse(trimmed) as { Key?: unknown; Error?: string };
                if (parsed.Error) log.error?.("Failed to GC a block out of the ipfs repo", parsed.Error);
                else if (parsed.Key) reclaimedCids++;
            } catch {
                // A malformed line is not worth aborting a completed GC over.
            }
        }
    } catch (error) {
        log.error?.("Failed to GC ipfs repo", apiBase, error);
        return { ran: false, skippedReason: "gc-failed", repoSizeBefore, storageMax };
    }

    let repoSizeAfter: number | undefined;
    try {
        repoSizeAfter = (await readRepoStat(fetchImpl, apiBase, options.signal)).repoSize;
    } catch (error) {
        log.trace?.("repo gc finished but the follow-up repo/stat failed", error);
    }

    // How much a GC actually reclaims is worth logging rather than assuming: GC never touches
    // pinned data, and a node with thousands of recursive pins can stay over the watermark.
    log(
        `GC reclaimed ${reclaimedCids} cids from the IPFS node ${apiBase} - repo size ${repoSizeBefore ?? "unknown"} -> ${repoSizeAfter ?? "unknown"}`
    );
    return { ran: true, reclaimedCids, repoSizeBefore, repoSizeAfter, storageMax };
}

/**
 * Starts the periodic repo GC. Returns a stop function.
 *
 * The timer is unref'd so it never by itself keeps the daemon process alive, and runs are
 * single-flighted: a GC that outlives its own interval must not have a second one stacked on top
 * of it. Errors are swallowed inside the tick — an interval callback that rejects becomes an
 * unhandledRejection and takes the daemon down (same failure mode as issue #37 bug 3).
 */
export function startRepoGcScheduler(options: {
    kuboApiUrl: URL | string;
    intervalMs?: number;
    log?: any;
    fetchImpl?: FetchLike;
}): () => void {
    const log = options.log ?? PKCLogger("bitsocial-cli:ipfs:repoGc");
    const intervalMs = options.intervalMs ?? DEFAULT_REPO_GC_INTERVAL_MS;
    const abortController = new AbortController();
    let inFlight: Promise<unknown> | undefined;

    const tick = () => {
        if (inFlight) return;
        inFlight = runRepoGcIfDue({
            kuboApiUrl: options.kuboApiUrl,
            log,
            signal: abortController.signal,
            fetchImpl: options.fetchImpl
        })
            .catch((error) => log.error?.("repo gc tick error (will retry next interval)", error))
            .finally(() => {
                inFlight = undefined;
            });
    };

    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    log(`Scheduled IPFS repo GC every ${intervalMs}ms against ${String(options.kuboApiUrl)}`);

    return () => {
        clearInterval(timer);
        abortController.abort();
    };
}
