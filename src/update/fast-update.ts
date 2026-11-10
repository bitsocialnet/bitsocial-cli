import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { finished as streamFinished } from "node:stream/promises";
import decompress from "decompress";
import { runNpmPack, ensureNpmAvailable } from "../common-utils/npm.js";
import { PACKAGE_NAME } from "./npm-registry.js";

interface WebuiEntry {
    url: string;
    sha256OfHtmlZip: string;
}

/**
 * Attempt a fast update by downloading only the tarball and reusing node_modules/
 * and dist/webuis/ from the existing install. Falls back (returns false) if
 * dependencies changed or any step fails.
 */
export async function fastInstallGlobal(
    version: string,
    installRoot: string,
    log: (msg: string) => void
): Promise<boolean> {
    const stagingDir = installRoot + ".__fast_update_staging";
    const backupDir = installRoot + ".__fast_update_backup";

    // Phase: cleanup leftovers from any interrupted previous fast-update
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.rm(backupDir, { recursive: true, force: true });

    let nodeModulesMoved = false;

    try {
        // Phase: download tarball
        await ensureNpmAvailable();
        await fs.mkdir(stagingDir, { recursive: true });
        log("Trying fast update...");
        const tgzPath = await runNpmPack(`${PACKAGE_NAME}@${version}`, stagingDir);

        // Phase: extract (strip: 1 removes the "package/" prefix in npm tarballs)
        await decompress(tgzPath, stagingDir, { strip: 1 });
        await fs.rm(tgzPath);

        // Phase: compare dependencies
        const oldPkg = JSON.parse(await fs.readFile(path.join(installRoot, "package.json"), "utf-8"));
        const newPkg = JSON.parse(await fs.readFile(path.join(stagingDir, "package.json"), "utf-8"));

        if (JSON.stringify(oldPkg.dependencies) !== JSON.stringify(newPkg.dependencies)) {
            log("Dependencies changed, falling back to full install.");
            await fs.rm(stagingDir, { recursive: true, force: true });
            return false;
        }

        // Phase: download web UIs, before anything in the current install is moved or deleted. A web UI is
        // reused only when its pin is unchanged AND its directory is on disk; every other entry is downloaded
        // into staging now. A failed download throws, so the caller falls back to a full install instead of
        // the update succeeding without that web UI.
        const oldWebuis: WebuiEntry[] = oldPkg.webuis ?? [];
        const newWebuis: WebuiEntry[] = newPkg.webuis ?? [];
        const oldWebuisByUrl = new Map(oldWebuis.map((w: WebuiEntry) => [w.url, w.sha256OfHtmlZip]));
        const oldWebuisDir = path.join(installRoot, "dist", "webuis");
        const newWebuisDir = path.join(stagingDir, "dist", "webuis");
        const oldWebuiDirNames = (await fs.readdir(oldWebuisDir, { withFileTypes: true }).catch(() => [] as never[]))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // We don't know exact dir names, but we can match by repo name from the URL.
        const dirsOf = (webui: WebuiEntry): string[] => {
            const repoName = extractRepoName(webui.url)?.toLowerCase();
            return repoName ? oldWebuiDirNames.filter((name) => name.toLowerCase().includes(repoName)) : [];
        };
        const reusedDirs = new Set<string>();
        const toDownload: WebuiEntry[] = [];
        for (const webui of newWebuis) {
            const dirs = dirsOf(webui);
            if (oldWebuisByUrl.get(webui.url) === webui.sha256OfHtmlZip && dirs.length > 0) dirs.forEach((dir) => reusedDirs.add(dir));
            else toDownload.push(webui);
        }
        const downloadDir = path.join(stagingDir, ".webuis-download");
        if (toDownload.length > 0) {
            await fs.mkdir(downloadDir, { recursive: true });
            log(`Downloading ${toDownload.length} changed web UI(s)...`);
            for (const webui of toDownload) await downloadWebui(webui, downloadDir, log);
        }

        // Phase: reuse node_modules from old install (O(1) rename, same filesystem)
        try {
            await fs.rename(
                path.join(installRoot, "node_modules"),
                path.join(stagingDir, "node_modules")
            );
            nodeModulesMoved = true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EXDEV") {
                log("Cross-device rename, falling back to full install.");
                await fs.rm(stagingDir, { recursive: true, force: true });
                return false;
            }
            throw err;
        }

        // Phase: move the entire dist/webuis/ directory from old install to staging, drop the directories
        // of changed or removed entries, and put the downloaded ones in their place
        try {
            await fs.rename(oldWebuisDir, newWebuisDir);
        } catch (err) {
            // webuis dir missing in old install — will create fresh. Any other failure must not ship an
            // install without the web UIs it reuses.
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        await fs.mkdir(newWebuisDir, { recursive: true });
        for (const name of oldWebuiDirNames) {
            if (!reusedDirs.has(name)) await fs.rm(path.join(newWebuisDir, name), { recursive: true, force: true });
        }
        if (toDownload.length > 0) {
            for (const name of await fs.readdir(downloadDir)) {
                await fs.rename(path.join(downloadDir, name), path.join(newWebuisDir, name));
            }
            await fs.rm(downloadDir, { recursive: true, force: true });
        }

        // Phase: atomic swap
        await fs.rename(installRoot, backupDir);
        await fs.rename(stagingDir, installRoot);
        nodeModulesMoved = false; // now part of installRoot, no rollback needed

        // Phase: cleanup backup
        await fs.rm(backupDir, { recursive: true, force: true });
        return true;
    } catch (err) {
        // Rollback: restore node_modules if we moved it out
        if (nodeModulesMoved) {
            try {
                await fs.rename(
                    path.join(stagingDir, "node_modules"),
                    path.join(installRoot, "node_modules")
                );
            } catch {
                // best-effort
            }
        }
        // If installRoot was renamed to backup but staging didn't land, restore it
        try {
            await fs.access(installRoot);
        } catch {
            try {
                await fs.rename(backupDir, installRoot);
            } catch {
                // best-effort
            }
        }
        await fs.rm(stagingDir, { recursive: true, force: true });
        log(`Fast update failed: ${(err as Error).message}`);
        return false;
    }
}

/** Extract repo name from a GitHub release URL (e.g. "seedit" from ".../plebbit/seedit/releases/tag/v0.5.10") */
function extractRepoName(url: string): string | undefined {
    const match = url.match(/github\.com\/[^/]+\/([^/]+)\/releases\/tag\//);
    return match?.[1];
}

/** Download a single webui entry — mirrors the logic in bin/postinstall.js */
async function downloadWebui(entry: WebuiEntry, webuisDir: string, log: (msg: string) => void): Promise<void> {
    const match = entry.url.match(/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/(.+)$/);
    if (!match) throw new Error(`Could not parse GitHub release URL: ${entry.url}`);
    const [, ownerRepo, tag] = match;

    const githubToken = process.env["GITHUB_TOKEN"];
    const headers: Record<string, string> = {};
    if (githubToken) headers["authorization"] = `Bearer ${githubToken}`;

    const releaseReq = await fetch(`https://api.github.com/repos/${ownerRepo}/releases/tags/${tag}`, { headers });
    if (!releaseReq.ok) throw new Error(`Failed to fetch release ${ownerRepo}@${tag}, status ${releaseReq.status}`);

    const release = await releaseReq.json();
    const htmlZipAsset = (release as any).assets.find((asset: any) => asset.name.includes("html"));
    if (!htmlZipAsset) throw new Error(`No HTML zip asset in ${ownerRepo}@${tag}`);

    const zipfilePath = path.join(webuisDir, htmlZipAsset.name);
    const downloadReq = await fetch(htmlZipAsset["browser_download_url"], { headers });
    if (!downloadReq.ok || !downloadReq.body) throw new Error(`Failed to download ${htmlZipAsset.name}, status ${downloadReq.status}`);

    const writer = createWriteStream(zipfilePath);
    await streamFinished(Readable.fromWeb(downloadReq.body as any).pipe(writer));
    writer.close();

    // Verify SHA-256 checksum
    const fileBuffer = await fs.readFile(zipfilePath);
    const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
    if (actualHash !== entry.sha256OfHtmlZip) {
        await fs.rm(zipfilePath);
        throw new Error(
            `SHA-256 mismatch for ${htmlZipAsset.name}! Expected: ${entry.sha256OfHtmlZip}, Actual: ${actualHash}`
        );
    }

    await decompress(zipfilePath, webuisDir);
    await fs.rm(zipfilePath);

    // Rename index.html to prevent access to unconfigured version
    const extractedDirName = htmlZipAsset.name.replace(".zip", "");
    const indexPath = path.join(webuisDir, extractedDirName, "index.html");
    const backupPath = path.join(webuisDir, extractedDirName, "index_backup_no_rpc.html");
    await fs.rename(indexPath, backupPath);

    log(`Downloaded ${ownerRepo}@${tag}`);
}
