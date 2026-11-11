import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished as streamFinished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import decompress from "decompress";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, "..");

async function main() {
    const distDir = path.join(packageRoot, "dist");
    try {
        await fs.access(distDir);
    } catch {
        // dist/ doesn't exist — dev install before build, skip silently
        return;
    }

    const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf-8"));
    const webuis = pkg.webuis;
    if (!webuis || webuis.length === 0) {
        console.warn("Warning: No webuis configured in package.json");
        return;
    }

    // dist/webuis is reused only when a previous run installed every web UI pinned in package.json: the
    // marker lists them and is written last. No marker or another list (an interrupted or partial run, or
    // pins changed by a pull) means downloading them again.
    const dstOfWebui = path.join(distDir, "webuis");
    const markerPath = path.join(dstOfWebui, ".installed-webuis.json");
    const pinnedWebuis = JSON.stringify(webuis);
    if ((await fs.readFile(markerPath, "utf-8").catch(() => undefined)) === pinnedWebuis) {
        console.log("Web UIs already downloaded, skipping download");
        return;
    }
    // The new set is assembled in stagingDir and swapped in at the end, so dist/webuis (which the daemon
    // serves from) stays as it is until then. Each web UI is downloaded and prepared in extractDir and moved
    // to stagingDir only once complete.
    const stagingDir = path.join(distDir, ".webuis-staging");
    const extractDir = path.join(distDir, ".webuis-extract");
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    const githubToken = process.env["GITHUB_TOKEN"];
    if (githubToken) console.log("Using GITHUB_TOKEN for API requests");

    const installed = new Set();
    for (const entry of webuis) {
        const { url, sha256OfHtmlZip } = entry;
        try {
            await fs.rm(extractDir, { recursive: true, force: true });
            await fs.mkdir(extractDir, { recursive: true });

            // Parse "https://github.com/{owner}/{repo}/releases/tag/{tag}"
            const match = url.match(/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/(.+)$/);
            if (!match) {
                console.warn(`Warning: Could not parse GitHub release URL: ${url}. Skipping.`);
                continue;
            }
            const [, ownerRepo, tag] = match;

            const headers = githubToken ? { authorization: `Bearer ${githubToken}` } : undefined;
            const releaseReq = await fetch(`https://api.github.com/repos/${ownerRepo}/releases/tags/${tag}`, { headers });
            if (!releaseReq.ok) {
                console.warn(`Warning: Failed to fetch release for ${ownerRepo}@${tag}, status ${releaseReq.status}. Skipping.`);
                continue;
            }

            const release = await releaseReq.json();
            const htmlZipAsset = release.assets.find((asset) => asset.name.includes("html"));
            if (!htmlZipAsset) {
                console.warn(`Warning: No HTML zip asset found in ${ownerRepo}@${tag}. Skipping.`);
                continue;
            }

            const zipfilePath = path.join(extractDir, htmlZipAsset.name);
            const downloadReq = await fetch(htmlZipAsset["browser_download_url"], { headers });
            if (!downloadReq.ok || !downloadReq.body) {
                console.warn(`Warning: Failed to download ${htmlZipAsset.name}, status ${downloadReq.status}. Skipping.`);
                continue;
            }

            const writer = createWriteStream(zipfilePath);
            await streamFinished(Readable.fromWeb(downloadReq.body).pipe(writer));
            writer.close();
            console.log(`Downloaded ${htmlZipAsset.name}`);

            // Verify SHA-256 checksum
            const fileBuffer = await fs.readFile(zipfilePath);
            const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
            if (actualHash !== sha256OfHtmlZip) {
                await fs.rm(zipfilePath);
                console.error(
                    `ERROR: SHA-256 mismatch for ${htmlZipAsset.name}!\n` +
                        `  Expected: ${sha256OfHtmlZip}\n` +
                        `  Actual:   ${actualHash}\n` +
                        `This could indicate a supply chain attack. Aborting.`
                );
                process.exit(1);
            }
            console.log(`Verified SHA-256 checksum for ${htmlZipAsset.name}`);

            await decompress(zipfilePath, extractDir);
            console.log(`Extracted ${htmlZipAsset.name}`);
            await fs.rm(zipfilePath);

            // Rename index.html to prevent access to unconfigured version
            const extractedDirName = htmlZipAsset.name.replace(".zip", "");
            const indexPath = path.join(extractDir, extractedDirName, "index.html");
            const backupPath = path.join(extractDir, extractedDirName, "index_backup_no_rpc.html");
            await fs.rename(indexPath, backupPath);
            await fs.rename(path.join(extractDir, extractedDirName), path.join(stagingDir, extractedDirName));
            installed.add(entry);
            console.log(`Downloaded ${ownerRepo}@${tag} successfully`);
        } catch (e) {
            console.warn(`Warning: Failed to process ${url}: ${e}. Skipping.`);
            continue;
        }
    }
    await fs.rm(extractDir, { recursive: true, force: true });

    // A pinned web UI that could not be downloaded keeps the complete version dist/webuis already has
    // (matched by repo name), until a later run replaces it. Web UIs that are no longer pinned are dropped.
    const listDirs = async (dir) =>
        (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const stagedDirs = await listDirs(stagingDir);
    const oldDirs = await listDirs(dstOfWebui);
    const keptDirs = new Set();
    for (const entry of webuis.filter((entry) => !installed.has(entry))) {
        const repoName = entry.url.match(/github\.com\/[^/]+\/([^/]+)\//)?.[1].toLowerCase();
        if (!repoName) continue;
        for (const name of oldDirs.filter((name) => name.toLowerCase().includes(repoName) && !stagedDirs.includes(name))) {
            const isComplete = await fs.access(path.join(dstOfWebui, name, "index_backup_no_rpc.html")).then(() => true, () => false);
            if (isComplete) keptDirs.add(name);
        }
    }

    // Verify at least one web UI will be installed
    const webuiDirs = [...stagedDirs, ...keptDirs];
    if (webuiDirs.length === 0) {
        console.error("ERROR: No web UIs were downloaded. At least one web UI is required.");
        process.exit(1);
    }

    // Swap the new set in, then move the kept web UIs over from the old one. If a rename fails partway (Windows
    // can return EPERM or EBUSY while a file is open), the previous set is put back before the error is
    // reported, so the next run can still keep its web UIs. The rollback is best effort: if one of its renames
    // fails too, dist/webuis can still be left partial, and the previous set may stay in .webuis-old. If
    // dist/webuis ends up missing (no previous set, as in every `npm install -g`, or a failed rollback), the
    // daemon cannot start, so postinstall exits 1 and the install fails instead of reporting success.
    const oldDir = path.join(distDir, ".webuis-old");
    await fs.rm(oldDir, { recursive: true, force: true });
    await fs.rename(dstOfWebui, oldDir).catch((e) => {
        if (e.code !== "ENOENT") throw e;
    });
    let swapped = false;
    const movedKeptDirs = [];
    try {
        await fs.rename(stagingDir, dstOfWebui);
        swapped = true;
        for (const name of keptDirs) {
            await fs.rename(path.join(oldDir, name), path.join(dstOfWebui, name));
            movedKeptDirs.push(name);
        }
    } catch (e) {
        for (const name of movedKeptDirs) await fs.rename(path.join(dstOfWebui, name), path.join(oldDir, name)).catch(() => {});
        if (swapped) await fs.rename(dstOfWebui, stagingDir).catch(() => {});
        await fs.rename(oldDir, dstOfWebui).catch(() => {});
        if (!(await fs.access(dstOfWebui).then(() => true, () => false))) {
            console.error(`ERROR: Could not move the web UIs into ${dstOfWebui}: ${e}`);
            process.exit(1);
        }
        throw e;
    }
    for (const name of keptDirs) console.warn(`Warning: Kept the installed ${name}, because its pinned version could not be downloaded`);
    await fs.rm(oldDir, { recursive: true, force: true });
    console.log(`Installed ${webuiDirs.length} web UI(s):`, webuiDirs);
    if (installed.size === webuis.length) await fs.writeFile(markerPath, pinnedWebuis);
}

main().catch((err) => {
    console.warn(`Warning: postinstall webui download failed: ${err}`);
    // Don't fail the install for non-checksum errors
});
