import { PKCLogger } from "../util.js";

// Matches kubo's default Datastore.GCPeriod.
export const DEFAULT_REPO_GC_INTERVAL_MS = 60 * 60 * 1000;

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

/**
 * Runs `repo gc` over the kubo RPC API. GC only ever reclaims unpinned blocks, so this is safe to
 * run unconditionally — kubo decides what is actually collectable.
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
 */
export async function runRepoGc(options: {
    kuboApiUrl: URL | string;
    log?: any;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
}): Promise<{ ran: boolean; reclaimedCids?: number }> {
    const log = options.log ?? PKCLogger("bitsocial-cli:ipfs:repoGc");
    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    const apiBase = toConnectableApiBase(options.kuboApiUrl);

    let reclaimedCids = 0;
    try {
        const response = await fetchImpl(`${apiBase}/repo/gc?quiet=true`, { method: "POST", signal: options.signal });
        if (!response.ok) throw new Error(`kubo RPC repo/gc responded ${response.status} ${response.statusText}`);

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
        return { ran: false };
    }

    log(`GC reclaimed ${reclaimedCids} cids from the IPFS node ${apiBase}`);
    return { ran: true, reclaimedCids };
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
        inFlight = runRepoGc({
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
