import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { finished as streamFinished } from "stream/promises";
import { Readable } from "stream";
import decompress from "decompress";

(async () => {
    const webuiGithubRepos = ["plebbit/seedit", "plebbit/plebones", "bitsocialnet/5chan"];
    console.log("Github repos to download", webuiGithubRepos);
    const githubToken: string | undefined = process.env["GITHUB_TOKEN"]; // we need a token to avoid getting rate limited in CI
    if (githubToken) console.log("github token length", githubToken.length);
    const dstOfWebui = path.join(process.cwd(), "dist", "webuis");
    console.log("Destination of web uis will be", dstOfWebui);
    try {
        await fs.mkdir(dstOfWebui);
    } catch (e) {
        const error = e as any;
        if (error["code"] === "EEXIST") {
            console.log("Web UIs directory already exists, we're gonna assume they're already downloaded and abort");
            return;
        } else throw error;
    }

    for (const githubRepo of webuiGithubRepos) {
        try {
            const headers = githubToken ? { authorization: `Bearer ${githubToken}` } : undefined;
            const latestSeeditReleaseReq = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
                headers
            });
            if (!latestSeeditReleaseReq.ok) {
                console.warn(
                    `Warning: Failed to fetch the release of ${githubRepo}, status code ${latestSeeditReleaseReq.status}, status text ${latestSeeditReleaseReq.statusText}. Skipping.`
                );
                continue;
            }
            const latestRelease = (await latestSeeditReleaseReq.json()) as any;
            const htmlZipAsset = latestRelease.assets.find((asset: any) => asset.name.includes("html"));
            if (!htmlZipAsset) {
                console.warn(`Warning: No HTML zip asset found in latest release of ${githubRepo}. Skipping.`);
                continue;
            }
            const htmlZipRequest = await fetch(htmlZipAsset["browser_download_url"], { headers });
            if (!htmlZipRequest.ok || !htmlZipRequest.body) {
                console.warn(
                    `Warning: Failed to download ${htmlZipAsset["browser_download_url"]} html zip file, status ${htmlZipRequest.status} ${htmlZipRequest.statusText}. Skipping.`
                );
                continue;
            }

            const zipfilePath = path.join(dstOfWebui, htmlZipAsset.name);
            const writer = createWriteStream(zipfilePath);
            await streamFinished(Readable.fromWeb(htmlZipRequest.body as any).pipe(writer));
            writer.close();
            console.log("Downloaded", htmlZipAsset.name, "webui successfully. Attempting to unzip");

            await decompress(zipfilePath, dstOfWebui);
            console.log("Unzipped", zipfilePath);
            await fs.rm(zipfilePath);
            console.log(`Downloaded`, githubRepo, "successfully");

            const extractedDirName = htmlZipAsset.name.replace(".zip", "");
            // We're renaming index.html here because we don't somebody to go to unmodified index.html
            // they will get an error, but an error is preferable to going to the wrong html
            const backupIndexHtml = path.join(dstOfWebui, extractedDirName, "index_backup_no_rpc.html");
            await fs.rename(path.join(dstOfWebui, extractedDirName, "index.html"), backupIndexHtml);
        } catch (e) {
            console.warn(`Warning: Failed to download ${githubRepo}: ${e}. Skipping.`);
            continue;
        }
    }

    // Verify at least one web UI was downloaded
    const downloadedEntries = await fs.readdir(dstOfWebui, { withFileTypes: true });
    const webuiDirs = downloadedEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (webuiDirs.length === 0) {
        console.error("ERROR: No web UIs were downloaded. At least one web UI is required.");
        process.exit(1);
    }
    console.log(`Successfully downloaded ${webuiDirs.length} web UI(s):`, webuiDirs);
})();
