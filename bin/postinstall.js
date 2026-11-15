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

/**
 * The release tag a web UI directory was built from, read from the `<app>-release-manifest.json` every web
 * UI build must ship. Undefined when the directory has no readable release manifest.
 * Mirrors readWebuiReleaseTag in src/webui/release-manifest.ts.
 */
async function readWebuiReleaseTag(webuiDir) {
    const names = await fs.readdir(webuiDir).catch(() => []);
    const manifestName = names.find((name) => name.endsWith("-release-manifest.json"));
    if (!manifestName) return undefined;
    try {
        const { releaseTag } = JSON.parse(await fs.readFile(path.join(webuiDir, manifestName), "utf-8"));
        return typeof releaseTag === "string" ? releaseTag : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Download the web UI of `pin` and prepare it in `extractDir`. Returns the name of its directory there.
 * Throws when it cannot be downloaded or is not the pinned version.
 */
async function downloadWebui(pin, extractDir, githubToken) {
    const { ownerRepo, tag } = pin;
    const headers = githubToken ? { authorization: `Bearer ${githubToken}` } : undefined;
    const releaseReq = await fetch(`https://api.github.com/repos/${ownerRepo}/releases/tags/${tag}`, { headers });
    if (!releaseReq.ok) throw new Error(`fetching the release failed with status ${releaseReq.status}`);

    const release = await releaseReq.json();
    const htmlZipAsset = release.assets.find((asset) => asset.name.includes("html"));
    if (!htmlZipAsset) throw new Error("the release has no HTML zip asset");

    const zipfilePath = path.join(extractDir, htmlZipAsset.name);
    const downloadReq = await fetch(htmlZipAsset["browser_download_url"], { headers });
    if (!downloadReq.ok || !downloadReq.body) throw new Error(`downloading ${htmlZipAsset.name} failed with status ${downloadReq.status}`);

    const writer = createWriteStream(zipfilePath);
    await streamFinished(Readable.fromWeb(downloadReq.body).pipe(writer));
    writer.close();
    console.log(`Downloaded ${htmlZipAsset.name}`);

    // Verify SHA-256 checksum
    const fileBuffer = await fs.readFile(zipfilePath);
    const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
    if (actualHash !== pin.entry.sha256OfHtmlZip) {
        await fs.rm(zipfilePath);
        console.error(
            `ERROR: SHA-256 mismatch for ${htmlZipAsset.name}!\n` +
                `  Expected: ${pin.entry.sha256OfHtmlZip}\n` +
                `  Actual:   ${actualHash}\n` +
                `This could indicate a supply chain attack. Aborting.`
        );
        process.exit(1);
    }
    console.log(`Verified SHA-256 checksum for ${htmlZipAsset.name}`);

    await decompress(zipfilePath, extractDir);
    console.log(`Extracted ${htmlZipAsset.name}`);
    await fs.rm(zipfilePath);

    const extractedDirName = htmlZipAsset.name.replace(".zip", "");
    const extractedDir = path.join(extractDir, extractedDirName);
    const releaseTag = await readWebuiReleaseTag(extractedDir);
    if (releaseTag === undefined) throw new Error("the build has no release manifest (<app>-release-manifest.json with a releaseTag)");
    if (releaseTag !== tag) throw new Error(`the release manifest of the build names ${releaseTag}`);

    // Rename index.html to prevent access to unconfigured version
    await fs.rename(path.join(extractedDir, "index.html"), path.join(extractedDir, "index_backup_no_rpc.html"));
    return extractedDirName;
}

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

    const pins = [];
    for (const entry of webuis) {
        // Parse "https://github.com/{owner}/{repo}/releases/tag/{tag}"
        const match = entry.url.match(/github\.com\/([^/]+\/([^/]+))\/releases\/tag\/(.+)$/);
        if (!match) {
            console.warn(`Warning: Could not parse GitHub release URL: ${entry.url}. Skipping.`);
            continue;
        }
        pins.push({ entry, ownerRepo: match[1], repoName: match[2].toLowerCase(), tag: match[3] });
    }

    // A web UI is installed for a pin when a complete directory of it (matched by repo name) has a release
    // manifest naming the pinned tag. A directory of another version, or one whose version cannot be told,
    // is never left in dist/webuis: the daemon serves from there, and a web UI built for another
    // bitsocial-cli may use other schemas.
    const dstOfWebui = path.join(distDir, "webuis");
    const listDirs = async (dir) =>
        (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const oldDirs = await listDirs(dstOfWebui);
    const installedDirOf = new Map();
    for (const pin of pins) {
        for (const name of oldDirs.filter((name) => name.toLowerCase().includes(pin.repoName))) {
            const isComplete = await fs.access(path.join(dstOfWebui, name, "index_backup_no_rpc.html")).then(() => true, () => false);
            if (isComplete && (await readWebuiReleaseTag(path.join(dstOfWebui, name))) === pin.tag) {
                installedDirOf.set(pin, name);
                break;
            }
        }
    }
    const installedDirs = new Set(installedDirOf.values());
    if (pins.every((pin) => installedDirOf.has(pin)) && oldDirs.every((name) => installedDirs.has(name))) {
        console.log("Web UIs already downloaded, skipping download");
        return;
    }

    // The new set is assembled in stagingDir and swapped in at the end, so dist/webuis stays as it is until
    // then. An installed web UI is copied over; any other is downloaded and prepared in extractDir and moved
    // to stagingDir only once complete.
    const stagingDir = path.join(distDir, ".webuis-staging");
    const extractDir = path.join(distDir, ".webuis-extract");
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    const githubToken = process.env["GITHUB_TOKEN"];
    if (githubToken) console.log("Using GITHUB_TOKEN for API requests");

    const dropped = [];
    for (const pin of pins) {
        const installedDir = installedDirOf.get(pin);
        if (installedDir) {
            await fs.cp(path.join(dstOfWebui, installedDir), path.join(stagingDir, installedDir), { recursive: true });
            continue;
        }
        try {
            await fs.rm(extractDir, { recursive: true, force: true });
            await fs.mkdir(extractDir, { recursive: true });
            const extractedDirName = await downloadWebui(pin, extractDir, githubToken);
            await fs.rename(path.join(extractDir, extractedDirName), path.join(stagingDir, extractedDirName));
            console.log(`Downloaded ${pin.ownerRepo}@${pin.tag} successfully`);
        } catch (e) {
            dropped.push({ pin, reason: e instanceof Error ? e.message : String(e) });
        }
    }
    await fs.rm(extractDir, { recursive: true, force: true });

    // A pinned web UI that could not be installed is dropped, along with any other version of it in
    // dist/webuis. The next run tries again.
    const stagedDirs = await listDirs(stagingDir);
    const warnAboutDropped = (isSwapped) => {
        for (const { pin, reason } of dropped) {
            const otherVersions = oldDirs.filter((name) => name.toLowerCase().includes(pin.repoName) && !stagedDirs.includes(name));
            const removed =
                isSwapped && otherVersions.length > 0 ? ` Removed the installed ${otherVersions.join(", ")}, which is not the pinned version.` : "";
            console.warn(
                `Warning: Dropped ${pin.ownerRepo}@${pin.tag}: ${reason}.${removed} The daemon will not serve this web UI until a later run installs it.`
            );
        }
    };
    if (stagedDirs.length === 0) {
        warnAboutDropped(false);
        console.error("ERROR: No web UIs were installed. At least one web UI is required.");
        process.exit(1);
    }

    // Swap the new set in. If the rename fails (Windows can return EPERM or EBUSY while a file is open), the
    // previous set is put back before the error is reported. If dist/webuis ends up missing (no previous
    // set, as in every `npm install -g`, or a failed rollback), the daemon cannot start, so postinstall
    // exits 1 and the install fails instead of reporting success.
    const oldDir = path.join(distDir, ".webuis-old");
    await fs.rm(oldDir, { recursive: true, force: true });
    await fs.rename(dstOfWebui, oldDir).catch((e) => {
        if (e.code !== "ENOENT") throw e;
    });
    try {
        await fs.rename(stagingDir, dstOfWebui);
    } catch (e) {
        await fs.rename(oldDir, dstOfWebui).catch(() => {});
        if (!(await fs.access(dstOfWebui).then(() => true, () => false))) {
            console.error(`ERROR: Could not move the web UIs into ${dstOfWebui}: ${e}`);
            process.exit(1);
        }
        throw e;
    }
    await fs.rm(oldDir, { recursive: true, force: true });
    warnAboutDropped(true);
    console.log(`Installed ${stagedDirs.length} web UI(s):`, stagedDirs);
}

main().catch((err) => {
    console.warn(`Warning: postinstall webui download failed: ${err}`);
    // Don't fail the install for non-checksum errors
});
