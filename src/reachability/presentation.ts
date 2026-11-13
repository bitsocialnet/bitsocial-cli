// Status-only composition layer (issue #258). It takes the shared check engine's output plus the connectivity
// verdict and turns them into two sections the human-facing `status` command renders: Diagnostics (findings,
// with their fixes stripped off) and Suggestions (the fixes, as ranked actions). `setup` and the daemon keep
// using the raw checks, so none of this ripples into them.
import type { ReachabilityCheck } from "./checks.js";
import type { Connectivity } from "./verdict.js";

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

// Tailscale Funnel is the one action that makes an otherwise-unreachable node reachable, so it always leads.
const rankOf = (id: string) => (id === "browser-address" ? 0 : 1);

export function composeStatus(input: { connectivity: Connectivity; checks: ReachabilityCheck[]; noPeers: boolean; funnelFix?: string }): StatusPresentation {
    const diagnostics = input.checks.map((check) => {
        const finding = input.noPeers && check.id === "inbound" ? { ...check, status: "unknown" as const, detail: NO_PEERS_DIAGNOSTIC } : check;
        // A finding carries no remedy; the remedy moves to Suggestions.
        const { fix, ...rest } = finding;
        void fix;
        return rest;
    });

    const suggestions: Suggestion[] = input.checks.filter((check) => check.fix !== undefined).map((check) => ({ id: check.id, detail: check.fix! }));
    // Undetermined browser reachability still warrants the Funnel suggestion, even though no check failed outright.
    // Promote it only if the checks did not already carry one, so it is never duplicated.
    if (input.connectivity.browsers.status === "unknown" && input.funnelFix !== undefined && !suggestions.some((s) => s.id === "browser-address"))
        suggestions.push({ id: "browser-address", detail: input.funnelFix });

    const ranked = suggestions.map((suggestion, index) => ({ suggestion, index })).sort((a, b) => rankOf(a.suggestion.id) - rankOf(b.suggestion.id) || a.index - b.index);
    return { diagnostics, suggestions: ranked.map(({ suggestion }) => suggestion) };
}
