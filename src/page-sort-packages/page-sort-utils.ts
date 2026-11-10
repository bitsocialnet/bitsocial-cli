import { validatePageSortFileFactory } from "@pkcprotocol/pkc-js/page-sorts";
import {
    getPackagesDir,
    importPackageFactory,
    listInstalledPackages,
    readPackageJson,
    loadPackagesIntoPKC,
    reloadPackagesInDaemon,
    PACKAGE_RELOAD_TIMEOUT_MS,
    type InstalledPackage,
    type PackageReloadResult,
    type PackageKind
} from "../common-utils/package-registry.js";

// Page sort packages: npm packages whose default export is a pkc-js page sort factory, registered into
// PKC.pageSorts under the package name, so `settings.pages.posts[i].name` can name them (issue #164).
// The machinery is shared with challenge packages in common-utils/package-registry.ts.

export const PAGE_SORT_PACKAGE_KIND: PackageKind = {
    subdir: "page-sorts",
    registryKey: "pageSorts",
    cacheBustParam: "bitsocialPageSortContent",
    label: "page sort"
};

export type InstalledPageSort = InstalledPackage;

export const getPageSortsDir = (dataPath?: string): string => getPackagesDir(PAGE_SORT_PACKAGE_KIND, dataPath);

export const listInstalledPageSorts = (dataPath?: string): Promise<InstalledPageSort[]> =>
    listInstalledPackages(PAGE_SORT_PACKAGE_KIND, dataPath);

export const reloadPageSortsInDaemon = (pkcRpcUrl: string | URL, timeoutMs = PACKAGE_RELOAD_TIMEOUT_MS): Promise<PackageReloadResult> =>
    reloadPackagesInDaemon(PAGE_SORT_PACKAGE_KIND, pkcRpcUrl, timeoutMs);

export const loadPageSortsIntoPKC = (dataPath?: string): Promise<InstalledPageSort[]> =>
    loadPackagesIntoPKC(PAGE_SORT_PACKAGE_KIND, dataPath);

/**
 * Import a page sort package, validate it the way a community would, and return its sortName: the key it publishes
 * under in pageCids, which need not match the package name (issue #173).
 */
export async function readPageSortName(packageDir: string, pkg?: { name: string; main?: string }): Promise<string> {
    const packageJson = pkg ?? (await readPackageJson(packageDir));
    const factory = await importPackageFactory(PAGE_SORT_PACKAGE_KIND, packageDir, packageJson);
    return validatePageSortFileFactory(factory, { name: packageJson.name }).sortName;
}

/** Where a community's settings.pages names `pageSortName`, e.g. "posts[0]". */
export function findPageSortUsages(
    pagesSettings: { posts?: { name?: string }[]; replies?: { name?: string }[] } | undefined,
    pageSortName: string
): string[] {
    const usages: string[] = [];
    for (const scope of ["posts", "replies"] as const) {
        pagesSettings?.[scope]?.forEach((entry, index) => {
            if (entry?.name === pageSortName) usages.push(`${scope}[${index}]`);
        });
    }
    return usages;
}
