// The only code that decides what `bitsocial reachability` changes in the kubo config. Everything
// here is pure so the disable/enable byte-for-byte round trip can be tested as a property.

// The `server` kubo profile adds this filter, and its connection gater then rejects every connection
// whose remote address is loopback, which is exactly what a local TLS terminator produces.
export const LOOPBACK_ADDR_FILTER = "/ip4/127.0.0.0/ipcidr/8";

export const WEBTRANSPORT_SWARM_ADDRESSES = [
    "/ip4/0.0.0.0/udp/443/quic-v1",
    "/ip4/0.0.0.0/udp/443/quic-v1/webtransport",
    "/ip6/::/udp/443/quic-v1",
    "/ip6/::/udp/443/quic-v1/webtransport"
] as const;

export const localWsSwarmAddress = (wsPort: number) => `/ip4/127.0.0.1/tcp/${wsPort}/ws`;

// A field's shape before we touched it. kubo writes `null` and `[]` for empty lists depending on
// version and profile, and restoring the wrong one would break the byte-exact round trip.
type OriginalShape = "absent" | "null" | "present";

// What the last apply changed. Stored in reachability/config.json; only this tells our entries apart
// from identical ones the operator wrote, and names the old addresses to remove after an IP change.
export interface KuboEditRecord {
    addressesShape: OriginalShape;
    swarmListShape: OriginalShape;
    appendAnnounceListShape: OriginalShape;
    addedSwarm: string[];
    addedAppendAnnounce: string[];
    removedAddrFilters: { entry: string; index: number }[];
    autoTls: { sectionShape: OriginalShape; enabledShape: OriginalShape; enabled?: unknown };
}

export interface ReachabilityKuboInput {
    wsPort: number;
    announce: string[];
    kuboEdits?: KuboEditRecord;
}

const shapeOf = (value: unknown): OriginalShape => (value === undefined ? "absent" : value === null ? "null" : "present");

const withoutEntries = (list: unknown, entries: string[]) => (Array.isArray(list) ? list.filter((entry) => !entries.includes(entry)) : list);

// Puts an emptied list or section back the way we found it. A list the operator has since added to stays.
const restoreShape = (parent: any, key: string, shape: OriginalShape) => {
    const value = parent[key];
    const isEmpty =
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
    if (!isEmpty || shape === "present") return;
    if (shape === "absent") delete parent[key];
    else parent[key] = null;
};

function undoListEdits(config: any, edits: KuboEditRecord) {
    if (config.Addresses) {
        config.Addresses.Swarm = withoutEntries(config.Addresses.Swarm, edits.addedSwarm);
        config.Addresses.AppendAnnounce = withoutEntries(config.Addresses.AppendAnnounce, edits.addedAppendAnnounce);
        restoreShape(config.Addresses, "Swarm", edits.swarmListShape);
        restoreShape(config.Addresses, "AppendAnnounce", edits.appendAnnounceListShape);
        restoreShape(config, "Addresses", edits.addressesShape);
    }
    if (edits.removedAddrFilters.length > 0 && config.Swarm) {
        const restored = edits.removedAddrFilters.map(({ entry }) => entry);
        const filters: unknown[] = Array.isArray(config.Swarm.AddrFilters) ? withoutEntries(config.Swarm.AddrFilters, restored) as unknown[] : [];
        for (const { entry, index } of edits.removedAddrFilters) filters.splice(Math.min(index, filters.length), 0, entry);
        config.Swarm.AddrFilters = filters;
    }
}

// Runs only on disable. If AutoTLS is no longer false the operator flipped it by hand, and we leave
// their choice alone.
function restoreAutoTls(config: any, autoTls: KuboEditRecord["autoTls"]) {
    if (config.AutoTLS?.Enabled !== false) return;
    if (autoTls.enabledShape === "absent") delete config.AutoTLS.Enabled;
    else config.AutoTLS.Enabled = autoTls.enabled;
    restoreShape(config, "AutoTLS", autoTls.sectionShape);
}

const appendMissing = (existing: string[], entries: string[]) => {
    const added: string[] = [];
    for (const entry of entries) {
        if (existing.includes(entry) || added.includes(entry)) continue;
        added.push(entry);
    }
    existing.push(...added);
    return added;
};

// Returns the new kubo config and the edit record the caller must persist with it. Applying is always
// undo-then-redo against the operator's baseline, so repeated applies and IP changes cannot pile up.
export function planKuboConfig(
    currentKuboConfig: any,
    reachabilityConfig: ReachabilityKuboInput,
    enabled: boolean
): { kuboConfig: any; kuboEdits: KuboEditRecord | undefined } {
    const config = structuredClone(currentKuboConfig ?? {});
    const previousEdits = reachabilityConfig.kuboEdits;
    if (previousEdits) undoListEdits(config, previousEdits);

    if (!enabled) {
        if (previousEdits) restoreAutoTls(config, previousEdits.autoTls);
        return { kuboConfig: config, kuboEdits: undefined };
    }

    const addressesShape = previousEdits?.addressesShape ?? shapeOf(config.Addresses);
    config.Addresses ??= {};
    const swarmListShape = previousEdits?.swarmListShape ?? shapeOf(config.Addresses.Swarm);
    const appendAnnounceListShape = previousEdits?.appendAnnounceListShape ?? shapeOf(config.Addresses.AppendAnnounce);
    config.Addresses.Swarm ??= [];
    config.Addresses.AppendAnnounce ??= [];

    const addedSwarm = appendMissing(config.Addresses.Swarm, [localWsSwarmAddress(reachabilityConfig.wsPort), ...WEBTRANSPORT_SWARM_ADDRESSES]);
    const addedAppendAnnounce = appendMissing(config.Addresses.AppendAnnounce, reachabilityConfig.announce);

    const removedAddrFilters: KuboEditRecord["removedAddrFilters"] = [];
    if (Array.isArray(config.Swarm?.AddrFilters)) {
        config.Swarm.AddrFilters.forEach((entry: unknown, index: number) => {
            if (entry === LOOPBACK_ADDR_FILTER) removedAddrFilters.push({ entry, index });
        });
        config.Swarm.AddrFilters = withoutEntries(config.Swarm.AddrFilters, [LOOPBACK_ADDR_FILTER]);
    }

    // Set once per enable. A later repair or IP change must not undo an operator flipping it back on.
    let autoTls = previousEdits?.autoTls;
    if (!autoTls) {
        autoTls = {
            sectionShape: shapeOf(config.AutoTLS),
            enabledShape: shapeOf(config.AutoTLS?.Enabled),
            ...(config.AutoTLS?.Enabled !== undefined ? { enabled: config.AutoTLS.Enabled } : {})
        };
        config.AutoTLS = { ...(config.AutoTLS ?? {}), Enabled: false };
    }

    return {
        kuboConfig: config,
        kuboEdits: {
            addressesShape,
            swarmListShape,
            appendAnnounceListShape,
            addedSwarm,
            addedAppendAnnounce,
            removedAddrFilters,
            autoTls
        }
    };
}

export function computeKuboConfig(currentKuboConfig: any, reachabilityConfig: ReachabilityKuboInput, enabled: boolean): any {
    return planKuboConfig(currentKuboConfig, reachabilityConfig, enabled).kuboConfig;
}
