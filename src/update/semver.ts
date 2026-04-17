/**
 * Minimal semver comparison. Strips leading "v", splits on ".",
 * compares each segment numerically left-to-right.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
    const normalize = (v: string) => v.replace(/^v/i, "");
    const partsA = normalize(a).split(".").map(Number);
    const partsB = normalize(b).split(".").map(Number);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const na = partsA[i] ?? 0;
        const nb = partsB[i] ?? 0;
        if (Number.isNaN(na) || Number.isNaN(nb)) {
            // Fall back to string compare for non-numeric segments
            const sa = String(partsA[i] ?? "");
            const sb = String(partsB[i] ?? "");
            if (sa < sb) return -1;
            if (sa > sb) return 1;
            continue;
        }
        if (na < nb) return -1;
        if (na > nb) return 1;
    }
    return 0;
}
