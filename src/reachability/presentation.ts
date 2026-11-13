// Status-only composition layer (issue #258). It takes the shared check engine's output and turns it into two
// sections the human-facing `status` command renders: Diagnostics (findings, with their fixes stripped off) and
// Suggestions (the fixes, as ranked actions). `setup` and the daemon keep using the raw checks, so none of this
// ripples into them.
import type { ReachabilityCheck } from "./checks.js";

export interface Suggestion {
    // The id of the diagnostic this suggestion resolves, so a reader (and JSON consumers) can tie the two together.
    id: string;
    detail: string;
}

export interface StatusPresentation {
    diagnostics: ReachabilityCheck[];
    suggestions: Suggestion[];
}

// What a node with no peers shows instead of the ~10-address "not tested yet" wall. A node that has not been asked
// to fetch or publish anything has not dialled out, so having no peers is the normal idle state, not a failure:
// AutoNAT simply has nobody to test through yet, and can once the node has activity.
export const NO_PEERS_DIAGNOSTIC =
    "AutoNAT has not tested reachability yet: kubo has no peers. This is normal for an idle node — it connects once it fetches or publishes, and AutoNAT can test then";

// The browser-address check carries the Tailscale Funnel advice, and it fires exactly when setup could not give the
// node a WSS address — the one case where Funnel is the right lead. So rank it first; every other fix keeps its order.
// Reachability can be undetermined for other reasons (daemon stopped, disabled, a WSS address that could not be tested
// from here), where Funnel is the wrong advice, so this does not synthesize a Funnel suggestion from the verdict alone.
const rankOf = (id: string) => (id === "browser-address" ? 0 : 1);

export function composeStatus(input: { checks: ReachabilityCheck[]; noPeers: boolean }): StatusPresentation {
    const diagnostics = input.checks.map((check) => {
        // Reframe only an inbound check that is itself unknown. A completed AutoNAT result (ok/warn) must stand even
        // if the peer count read just afterwards is 0, or the verdict and this diagnostic would contradict each other.
        const finding = input.noPeers && check.id === "inbound" && check.status === "unknown" ? { ...check, detail: NO_PEERS_DIAGNOSTIC } : check;
        // A finding carries no remedy; the remedy moves to Suggestions.
        const { fix, ...rest } = finding;
        void fix;
        return rest;
    });

    const suggestions: Suggestion[] = input.checks.filter((check) => check.fix !== undefined).map((check) => ({ id: check.id, detail: check.fix! }));
    const ranked = suggestions.map((suggestion, index) => ({ suggestion, index })).sort((a, b) => rankOf(a.suggestion.id) - rankOf(b.suggestion.id) || a.index - b.index);
    return { diagnostics, suggestions: ranked.map(({ suggestion }) => suggestion) };
}
