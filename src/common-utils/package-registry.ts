import path from "path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import fs from "fs/promises";
import type { Dirent } from "fs";
import decompress from "decompress";
import defaults from "./defaults.js";
import { ensureNpmAvailable, runNpmInstall, runNpmPack, verifyNativeModuleAbi } from "./npm.js";

// npm packages that plug into one of pkc-js's registries (PKC.challenges, PKC.pageSorts). Every kind installs the
// same way: `npm pack` + extract + `npm install` into ${dataPath}/<subdir>/<name>, loaded into the registry under
// the package name when the daemon starts, and reloaded over HTTP when an install/remove happens while it runs.

export interface PackageKind {
    /** Directory under the data path, and the HTTP reload route segment */
    subdir: string;
    /** pkc-js registry the default exports are registered into */
    registryKey: "challenges" | "pageSorts";
    /** Query parameter that keys the import URL on the package contents (see loadPackagesIntoPKC) */
    cacheBustParam: string;
    /** Singular noun for messages, e.g. "challenge" */
    label: string;
}

export interface InstalledPackage {
    name: string;
    version: string;
    description: string;
    path: string;
}

export function getPackagesDir(kind: PackageKind, dataPath?: string): string {
    return path.join(dataPath || defaults.PKC_DATA_PATH, kind.subdir);
}

export async function ensurePackagesDir(kind: PackageKind, dataPath?: string): Promise<string> {
    const dir = getPackagesDir(kind, dataPath);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

export class InvalidPackageNameError extends Error {}

// One segment of an npm package name, as far as it matters for a path: url-safe characters, no leading dot or
// underscore. That rules out "." and ".." and any separator, so a name can never leave the packages dir.
const PACKAGE_NAME_SEGMENT = /^[a-zA-Z0-9~-][a-zA-Z0-9._~-]*$/;

/** Throw unless `name` is an npm package name: `pkg` or `@scope/pkg`. */
export function assertValidPackageName(name: string): void {
    const segments = name.split("/");
    const valid =
        segments.length === 1
            ? PACKAGE_NAME_SEGMENT.test(segments[0])
            : segments.length === 2 &&
              segments[0].startsWith("@") &&
              PACKAGE_NAME_SEGMENT.test(segments[0].slice(1)) &&
              PACKAGE_NAME_SEGMENT.test(segments[1]);
    if (!valid) {
        throw new InvalidPackageNameError(`Invalid package name "${name}": expected an npm package name such as my-package or @scope/my-package`);
    }
}

export function packageNameToDir(packagesDir: string, name: string): string {
    // Handles both scoped (@org/pkg) and unscoped (pkg) names. The name comes from the command line (remove) or
    // from the package's own package.json (install), so it is validated before it becomes a path: without that,
    // `remove ../communities` resolved to ${dataPath}/communities and deleted every community.
    assertValidPackageName(name);
    const dir = path.join(packagesDir, ...name.split("/"));
    const relative = path.relative(packagesDir, dir);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new InvalidPackageNameError(`Invalid package name "${name}": resolves outside ${packagesDir}`);
    }
    return dir;
}

export async function readPackageJson(packageDir: string): Promise<{ name: string; version?: string; description?: string; main?: string; exports?: any }> {
    const pkgPath = path.join(packageDir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    if (!pkg.name || typeof pkg.name !== "string") {
        throw new Error(`Invalid package.json in ${packageDir}: missing "name" field`);
    }
    return pkg;
}

export async function listInstalledPackages(kind: PackageKind, dataPath?: string): Promise<InstalledPackage[]> {
    const packagesDir = getPackagesDir(kind, dataPath);
    const results: InstalledPackage[] = [];

    let entries: Dirent[];
    try {
        entries = await fs.readdir(packagesDir, { withFileTypes: true });
    } catch {
        return results; // dir doesn't exist = nothing installed
    }

    const pushIfValid = async (pkgDir: string) => {
        try {
            const pkg = await readPackageJson(pkgDir);
            results.push({
                name: pkg.name,
                version: pkg.version || "unknown",
                description: pkg.description || "",
                path: pkgDir
            });
        } catch {
            // skip invalid entries
        }
    };

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        if (entry.name.startsWith("@")) {
            // Scoped package: read @scope/*/package.json
            const scopeDir = path.join(packagesDir, entry.name);
            let scopeEntries: Dirent[];
            try {
                scopeEntries = await fs.readdir(scopeDir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const scopeEntry of scopeEntries) {
                if (!scopeEntry.isDirectory()) continue;
                await pushIfValid(path.join(scopeDir, scopeEntry.name));
            }
        } else {
            // Unscoped package
            await pushIfValid(path.join(packagesDir, entry.name));
        }
    }

    return results;
}

export function formatPackageNameVersion(pkg: Pick<InstalledPackage, "name" | "version">): string {
    return pkg.version && pkg.version !== "unknown" ? `${pkg.name}@${pkg.version}` : pkg.name;
}

/** The archive npm packed has no package.json with a "name" field. */
export class InvalidPackageArchiveError extends Error {}

export interface InstallPackageResult {
    name: string;
    version?: string;
    /** Whether an installation of the same package was replaced */
    replaced: boolean;
}

/**
 * Download, install and verify `packageSpec` (anything `npm pack` accepts) in a temp dir under the data path, then
 * swap it into ${dataPath}/<subdir>/<name>, replacing an existing install. `validate` runs on the fully installed
 * package before the swap, so a package that fails it never replaces a working one.
 */
export async function installPackage(
    kind: PackageKind,
    {
        packageSpec,
        dataPath,
        validate
    }: { packageSpec: string; dataPath: string; validate?: (pkgDir: string, pkg: { name: string; main?: string }) => Promise<void> }
): Promise<InstallPackageResult> {
    const logTag = `[${kind.label.replace(/ /g, "-")}-install]`;

    // 1. Check npm is available
    await ensureNpmAvailable();

    // 2. Use npm pack to download the package as a tarball
    const tmpDir = path.join(dataPath, `.${kind.label.replace(/ /g, "-")}-install-tmp-` + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });

    try {
        const archivePath = await runNpmPack(packageSpec, tmpDir);

        // 3. Extract the archive
        const extractDir = path.join(tmpDir, "extracted");
        await decompress(archivePath, extractDir);
        process.stderr.write(`${logTag} archive extracted\n`);

        // 4. Find package.json (npm pack tarballs have a package/ root dir)
        let pkgDir = extractDir;
        try {
            await readPackageJson(pkgDir);
        } catch {
            // Check one level deep
            const entries = await fs.readdir(extractDir, { withFileTypes: true });
            const dirs = entries.filter((e) => e.isDirectory());
            let found = false;
            for (const dir of dirs) {
                const candidate = path.join(extractDir, dir.name);
                try {
                    await readPackageJson(candidate);
                    pkgDir = candidate;
                    found = true;
                    break;
                } catch {
                    // continue
                }
            }
            if (!found) {
                throw new InvalidPackageArchiveError('No valid package.json found in the archive. The archive must contain a package.json with a "name" field.');
            }
        }

        // 5. Read package info. The name becomes the install directory, so reject one that is not an npm name
        //    (e.g. "../challenges/x") before spending an npm install on it
        const pkg = await readPackageJson(pkgDir);
        assertValidPackageName(pkg.name);

        // 6. Run npm install in the temp dir, so a failed install never
        //    touches an existing working installation of the same package
        process.stderr.write(`${logTag} starting npm install in ${pkgDir}\n`);
        await runNpmInstall(pkgDir);
        process.stderr.write(`${logTag} npm install completed\n`);

        // 7. Verify native modules are ABI-compatible and the package is what this kind expects (still in the
        //    temp dir, so failure needs no rollback — the temp dir is cleaned up below)
        await verifyNativeModuleAbi(pkgDir);
        if (validate) await validate(pkgDir, pkg);

        // 8. Swap the verified package into the packages dir, replacing any
        //    existing installation (idempotent, like npm install)
        const packagesDir = await ensurePackagesDir(kind, dataPath);
        const destDir = packageNameToDir(packagesDir, pkg.name);
        let alreadyExists = true;
        try {
            await fs.access(destDir);
        } catch {
            alreadyExists = false;
        }

        // Move any existing install aside (same filesystem — tmpDir lives under
        // dataPath) so it can be restored if the final rename fails
        const backupDir = path.join(tmpDir, "previous-install");
        if (alreadyExists) await fs.rename(destDir, backupDir);

        if (pkg.name.startsWith("@")) {
            // Ensure scope dir exists for scoped packages
            const scopeDir = path.dirname(destDir);
            await fs.mkdir(scopeDir, { recursive: true });
        }
        try {
            await fs.rename(pkgDir, destDir);
        } catch (err) {
            // Restore the previous installation before surfacing the error
            if (alreadyExists) await fs.rename(backupDir, destDir);
            throw err;
        }

        return { name: pkg.name, version: pkg.version, replaced: alreadyExists };
    } finally {
        // 9. Clean up temp dir (includes the previous-install backup, if any)
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

export class PackageNotInstalledError extends Error {}

/** Throw PackageNotInstalledError unless ${dataPath}/<subdir>/<name> exists. Returns that directory. */
export async function assertPackageInstalled(kind: PackageKind, { name, dataPath }: { name: string; dataPath: string }): Promise<string> {
    const packageDir = packageNameToDir(getPackagesDir(kind, dataPath), name);
    try {
        await fs.access(packageDir);
    } catch {
        throw new PackageNotInstalledError(`${kind.label[0].toUpperCase()}${kind.label.slice(1)} "${name}" is not installed.`);
    }
    return packageDir;
}

/** Remove ${dataPath}/<subdir>/<name>. Returns the removed version, if its package.json was readable. */
export async function removePackage(kind: PackageKind, { name, dataPath }: { name: string; dataPath: string }): Promise<{ version?: string }> {
    const packageDir = await assertPackageInstalled(kind, { name, dataPath });

    // Read the installed version for the success message (best-effort)
    let version: string | undefined;
    try {
        version = (await readPackageJson(packageDir)).version;
    } catch {
        // unreadable package.json — report the name only
    }

    await fs.rm(packageDir, { recursive: true, force: true });

    // Clean up empty @scope/ dir for scoped packages
    if (name.startsWith("@")) {
        const scopeDir = path.dirname(packageDir);
        try {
            const entries = await fs.readdir(scopeDir);
            if (entries.length === 0) {
                await fs.rmdir(scopeDir);
            }
        } catch {
            // ignore
        }
    }

    return { version };
}

/** The part of a connected pkc-js RPC client that collectPackageUsages reads. */
export interface PackageUsageSource {
    communities: { address: string }[];
    createCommunity(options: { address: string }): Promise<{ settings?: unknown }>;
    destroy(): Promise<void>;
}

/**
 * Every place a community on the daemon names a package, as "<address> <usage>". `findUsages` maps one community's
 * settings to the usages within it, e.g. ["settings.challenges[1]"]. Stopped communities are checked too, since they
 * load the package on their next start. Destroys `pkc` when done.
 */
export async function collectPackageUsages(pkc: PackageUsageSource, findUsages: (settings: any) => string[]): Promise<string[]> {
    const usages: string[] = [];
    try {
        for (const { address } of pkc.communities) {
            const community = await pkc.createCommunity({ address });
            for (const usage of findUsages(community.settings)) usages.push(`${address} ${usage}`);
        }
    } finally {
        await pkc.destroy();
    }
    return usages;
}

/**
 * HTTP url of a daemon's reload endpoint for `kind`, derived from its --pkcRpcUrl. The endpoint
 * is served by the same http server as the RPC socket, and its local-only variant requires the
 * request to come from the loopback interface — so a wildcard bind is dialed as loopback rather
 * than as 0.0.0.0. An auth key path in the url is kept, which selects the remote variant.
 */
export function reloadUrlFromPkcRpcUrl(kind: PackageKind, pkcRpcUrl: string): string | undefined {
    let url: URL;
    try {
        url = new URL(pkcRpcUrl);
    } catch {
        return undefined;
    }
    if (!url.port) return undefined;
    // URL.hostname keeps the brackets around an IPv6 literal — strip them so the host can be
    // compared and re-bracketed exactly once
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const host = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
    // A remote daemon is reached through its auth key path (ws://host:port/<authKey>), and the daemon serves the
    // reload route under that same prefix; the bare /api/... route only answers local connections
    const authPath = url.pathname.replace(/\/+$/, "");
    const scheme = url.protocol === "wss:" ? "https" : "http";
    return `${scheme}://${host.includes(":") ? `[${host}]` : host}:${url.port}${authPath}/api/${kind.subdir}/reload`;
}

/** How long install/remove wait for a daemon to finish reloading before giving up. */
export const PACKAGE_RELOAD_TIMEOUT_MS = 30000;

/**
 * Ask the daemon at `pkcRpcUrl` to reload its `kind` packages, so an install/remove takes
 * effect without a restart. Returns whether a daemon actually reloaded — best-effort, since
 * no daemon running is not an error.
 *
 * The request is bounded: a daemon that accepts the connection but never answers (busy, wedged,
 * or something else listening on the port) would otherwise hold the CLI for undici's 300s
 * default. Aborting only ends our wait — the daemon may still finish the reload.
 */
export async function reloadPackagesInDaemon(kind: PackageKind, pkcRpcUrl: string | URL, timeoutMs = PACKAGE_RELOAD_TIMEOUT_MS): Promise<boolean> {
    const reloadUrl = reloadUrlFromPkcRpcUrl(kind, pkcRpcUrl.toString());
    if (!reloadUrl) return false;
    try {
        const res = await fetch(reloadUrl, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
        return res.ok;
    } catch {
        return false; // daemon not running or not answering, that's fine
    }
}

// Hash of a package's own source, used as the import cache key (see loadPackagesIntoPKC).
// Only node_modules is skipped: dependencies are pinned by the install that produced this
// package dir, and hashing them would make every reload walk the entire dependency tree.
// Dot-prefixed files and directories are hashed — pkg.main may point into one
// (".dist/index.js"), and skipping them left that entry out of the key, so a same-version
// replacement kept the old import URL and served the stale module.
export async function hashPackageContents(packageDir: string): Promise<string> {
    const hash = createHash("sha256");

    const walk = async (dir: string, relativeDir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Sort so the digest does not depend on readdir order
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            if (entry.name === "node_modules") continue;
            const absolutePath = path.join(dir, entry.name);
            const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolutePath, relativePath);
            } else if (entry.isFile()) {
                // Frame each record: feeding the path and the raw bytes back to back makes the
                // stream ambiguous, so {index.js:"A", j:"Z"} and {index.js:"AjZ"} would hash
                // identically and a changed entry could reuse the previous cache key
                const contents = await fs.readFile(absolutePath);
                const fileDigest = createHash("sha256").update(contents).digest("hex");
                hash.update(`${relativePath}\0${fileDigest}\0`);
            }
        }
    };

    await walk(packageDir, "");
    return hash.digest("hex").slice(0, 16);
}

/** Import an installed package's entry point and return its default export (or the module itself). */
export async function importPackageFactory(kind: PackageKind, packageDir: string, pkg?: { main?: string }): Promise<unknown> {
    const entryPoint = (pkg ?? (await readPackageJson(packageDir))).main || "index.js";
    const entryPath = path.resolve(packageDir, entryPoint);

    // Node caches ESM modules by URL, and `install` swaps a new build onto the same
    // destination path.  Importing the bare path would therefore hand back the module
    // evaluated before the upgrade, so the registry would keep serving the old factory while
    // metadata reports the new version (issue #124).  Keying the URL on the package contents
    // re-evaluates the entry whenever the package changes and stays byte-identical (so
    // cached, so factory-identical) when it does not.
    //
    // Only the entry module is re-evaluated: relative imports inside the package do not
    // inherit the query, so a multi-file package graph would keep its stale submodules.
    // Packages are expected to ship a bundled entry point.
    const entryUrl = pathToFileURL(entryPath);
    entryUrl.searchParams.set(kind.cacheBustParam, await hashPackageContents(packageDir));

    // A CommonJS entry is also cached by filename, and Node's ESM loader reuses that cached
    // module for a new URL, so drop it or the content-hash query alone hands back the old
    // exports.  An unchanged package keeps its URL, which the ESM cache answers without
    // touching require.cache, so its factory stays identical.
    delete createRequire(import.meta.url).cache[entryPath];

    const imported = await import(entryUrl.href);
    return imported.default || imported;
}

/**
 * What each name held in the pkc-js registry before this process first registered a package
 * under it, per registry.  The registry *is* pkc-js's own, so a package named after a built-in
 * ("question") shadows it — unregistering has to hand the built-in back rather than delete the
 * key.  `hadPrevious: false` means the name was ours alone and can be deleted.
 *
 * A process serves one data path (the daemon passes its own), so this is not keyed by data path.
 */
const shadowedByRegistry = new Map<PackageKind["registryKey"], Map<string, { hadPrevious: boolean; previous: unknown }>>();

/**
 * Whether pkc-js itself ships `name` in the `kind` registry, so removing a package of that name hands the built-in
 * back instead of leaving the name unregistered. Holds in the daemon too, where the package may shadow the built-in.
 */
export async function isBuiltInPackageName(kind: PackageKind, name: string): Promise<boolean> {
    const shadowed = shadowedByRegistry.get(kind.registryKey)?.get(name);
    if (shadowed) return shadowed.hadPrevious;
    const PKC = await import("@pkcprotocol/pkc-js");
    return Object.hasOwn((PKC.default as any)[kind.registryKey] ?? {}, name);
}

export async function loadPackagesIntoPKC(kind: PackageKind, dataPath?: string): Promise<InstalledPackage[]> {
    const packages = await listInstalledPackages(kind, dataPath);

    const PKC = await import("@pkcprotocol/pkc-js");
    const registry = (PKC.default as any)[kind.registryKey] as Record<string, unknown>;
    let shadowed = shadowedByRegistry.get(kind.registryKey);
    if (!shadowed) {
        shadowed = new Map();
        shadowedByRegistry.set(kind.registryKey, shadowed);
    }

    // Hand back any name whose package is no longer installed, so `remove` takes effect
    // without a restart.  A package that is still installed but fails to import keeps its
    // previously loaded factory: it is excluded from the returned list either way, and dropping a
    // working package because its replacement is broken would take the community's publication
    // flow down instead of leaving it on known-good code.
    const installedNames = new Set(packages.map((pkg) => pkg.name));
    for (const [name, original] of shadowed) {
        if (installedNames.has(name)) continue;
        if (original.hadPrevious) registry[name] = original.previous;
        else delete registry[name];
        shadowed.delete(name);
    }

    if (packages.length === 0) return [];

    const loaded: InstalledPackage[] = [];

    for (const pkg of packages) {
        try {
            const factory = await importPackageFactory(kind, pkg.path);
            // Remember what this name held before we first took it over, so `remove`
            // can hand it back instead of leaving a dead key (or deleting a pkc-js built-in)
            if (!shadowed.has(pkg.name)) {
                shadowed.set(pkg.name, { hadPrevious: pkg.name in registry, previous: registry[pkg.name] });
            }
            registry[pkg.name] = factory;
            loaded.push(pkg);
        } catch (err) {
            console.error(`Failed to load ${kind.label} "${pkg.name}":`, err);
        }
    }

    return loaded;
}
