import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression guard for issue #84.
 *
 * pkc-js disables undici's default 5-minute `bodyTimeout` (so idle pubsub long-poll
 * streams are not aborted) via `setGlobalDispatcher(new Agent({ bodyTimeout: MAX }))`,
 * importing the top-level `undici`.
 *
 * undici changed its global-dispatcher symbol between v7 and v8:
 *   - undici 7.x: Symbol.for("undici.globalDispatcher.1")
 *   - undici 8.x: Symbol.for("undici.globalDispatcher.2")  (.1 is legacy only)
 *
 * `setGlobalDispatcher` writes the slot of whichever undici is hoisted to top-level.
 * The idle pubsub stream is dispatched on the undici copy that `@libp2p/http` (pulled by
 * helia) uses, which requires `undici@^8` and therefore reads the `.2` slot. If a `^7`
 * undici wins the top-level hoist, pkc-js writes `.1`, the `@libp2p/http` request reads
 * `.2` (never set), and the stream times out after 5 minutes (UND_ERR_BODY_TIMEOUT) —
 * reproducible in Docker but not on a host install where undici 8.x hoists to top.
 *
 * Invariant: the undici pkc-js patches (top-level) and the undici `@libp2p/http` uses must
 * be the same major (>= 8), so both read/write the same global-dispatcher symbol and the
 * polyfill is effective.
 */
describe("undici global-dispatcher hoisting (issue #84)", () => {
    const projectRoot = process.cwd();
    const majorOf = (pkgJsonPath: string): number => {
        const version: string = JSON.parse(readFileSync(pkgJsonPath, "utf-8")).version;
        return Number(version.split(".")[0]);
    };

    it("hoists undici 8.x to top-level so pkc-js's body-timeout polyfill writes the .2 slot", () => {
        const fromRoot = createRequire(join(projectRoot, "package.json"));
        const topUndiciPkg = fromRoot.resolve("undici/package.json");
        expect(majorOf(topUndiciPkg)).toBeGreaterThanOrEqual(8);
    });

    it("resolves @libp2p/http's undici to the same major as the top-level copy", () => {
        const fromRoot = createRequire(join(projectRoot, "package.json"));
        // Anchor on @libp2p/http's main entry (its exports map blocks ./package.json),
        // then resolve undici from there: a nested copy if hoisting regressed, else top-level.
        const httpMain = fromRoot.resolve("@libp2p/http");
        const httpUndiciPkg = createRequire(httpMain).resolve("undici/package.json");
        const topUndiciPkg = fromRoot.resolve("undici/package.json");

        const httpMajor = majorOf(httpUndiciPkg);
        const topMajor = majorOf(topUndiciPkg);

        expect(httpMajor).toBeGreaterThanOrEqual(8);
        // Same major => same global-dispatcher symbol => pkc-js polyfill governs this path.
        expect(httpMajor).toBe(topMajor);
    });

    it("resolves pkc-js's undici (the copy its polyfill patches) to the same major as @libp2p/http's", () => {
        // Since pkc-js 0.0.132 declares undici@8 itself, the copy its polyfill imports is whatever
        // resolves from inside the pkc-js package dir: a nested copy if this repo's pin drifts to a
        // different 8.x (or lower) than pkc-js wants, else the hoisted top-level one. Either way it
        // must share @libp2p/http's major, or the two sides read different global-dispatcher slots.
        const fromRoot = createRequire(join(projectRoot, "package.json"));
        const pkcMain = fromRoot.resolve("@pkcprotocol/pkc-js");
        const pkcUndiciPkg = createRequire(pkcMain).resolve("undici/package.json");
        const httpMain = fromRoot.resolve("@libp2p/http");
        const httpUndiciPkg = createRequire(httpMain).resolve("undici/package.json");

        expect(majorOf(pkcUndiciPkg)).toBeGreaterThanOrEqual(8);
        expect(majorOf(pkcUndiciPkg)).toBe(majorOf(httpUndiciPkg));
    });
});
