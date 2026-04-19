import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { finished as streamFinished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, "..");

const dryRun = process.argv.includes("--dry-run");

async function main() {
    const pkgPath = path.join(packageRoot, "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    const webuis = pkg.webuis;
    if (!webuis || webuis.length === 0) {
        console.log("No webuis configured in package.json");
        return;
    }

    const githubToken = process.env["GITHUB_TOKEN"];
    if (githubToken) console.log("Using GITHUB_TOKEN for API requests");
    const headers = githubToken ? { authorization: `Bearer ${githubToken}` } : undefined;

    let updatedCount = 0;

    for (const entry of webuis) {
        const { url, sha256OfHtmlZip } = entry;

        // Parse "https://github.com/{owner}/{repo}/releases/tag/{tag}"
        const match = url.match(/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/(.+)$/);
        if (!match) {
            console.warn(`Warning: Could not parse GitHub release URL: ${url}. Skipping.`);
            continue;
        }
        const [, ownerRepo, currentTag] = match;
        const repoName = ownerRepo.split("/")[1];

        // Fetch latest release
        const latestRes = await fetch(`https://api.github.com/repos/${ownerRepo}/releases/latest`, { headers });
        if (!latestRes.ok) {
            if (latestRes.status === 403) {
                console.warn(`Warning: GitHub API rate limited for ${ownerRepo}. Set GITHUB_TOKEN to avoid this. Skipping.`);
            } else {
                console.warn(`Warning: Failed to fetch latest release for ${ownerRepo}, status ${latestRes.status}. Skipping.`);
            }
            continue;
        }

        const latest = await latestRes.json();
        const latestTag = latest.tag_name;

        if (latestTag === currentTag) {
            console.log(`${repoName}: ${currentTag} (already latest)`);
            continue;
        }

        // Find html zip asset
        const htmlZipAsset = latest.assets.find((asset) => asset.name.includes("html"));
        if (!htmlZipAsset) {
            console.warn(`Warning: No HTML zip asset found in ${ownerRepo}@${latestTag}. Skipping.`);
            continue;
        }

        if (dryRun) {
            console.log(`${repoName}: ${currentTag} -> ${latestTag} (would update)`);
            updatedCount++;
            continue;
        }

        // Download zip to temp dir
        const tmpPath = path.join(os.tmpdir(), htmlZipAsset.name);
        const downloadRes = await fetch(htmlZipAsset["browser_download_url"], { headers });
        if (!downloadRes.ok || !downloadRes.body) {
            console.warn(`Warning: Failed to download ${htmlZipAsset.name}, status ${downloadRes.status}. Skipping.`);
            continue;
        }

        const writer = createWriteStream(tmpPath);
        await streamFinished(Readable.fromWeb(downloadRes.body).pipe(writer));
        writer.close();

        // Compute SHA256
        const fileBuffer = await fs.readFile(tmpPath);
        const newHash = createHash("sha256").update(fileBuffer).digest("hex");

        // Clean up temp file
        await fs.rm(tmpPath);

        // Update entry
        entry.url = `https://github.com/${ownerRepo}/releases/tag/${latestTag}`;
        entry.sha256OfHtmlZip = newHash;
        updatedCount++;
        console.log(`${repoName}: ${currentTag} -> ${latestTag} (updated)`);
    }

    if (updatedCount === 0) {
        console.log("\nAll web UIs are already at their latest versions.");
        return;
    }

    if (dryRun) {
        console.log(`\n${updatedCount} web UI(s) would be updated (dry run, no changes made).`);
        return;
    }

    // Write updated package.json
    pkg.webuis = webuis;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 4) + "\n");
    console.log(`\nUpdated ${updatedCount} web UI(s) in package.json.`);

    // Remove dist/webuis/ so postinstall re-downloads
    const distWebuis = path.join(packageRoot, "dist", "webuis");
    try {
        await fs.rm(distWebuis, { recursive: true });
        console.log("Removed dist/webuis/ — run 'npm run ci:download-web-uis' to re-download.");
    } catch (e) {
        if (e.code !== "ENOENT") throw e;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
