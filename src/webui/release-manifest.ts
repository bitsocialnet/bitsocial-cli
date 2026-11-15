import fs from "node:fs/promises";
import path from "node:path";

/** A web UI pinned in package.json `webuis`. */
export interface WebuiPin {
    /** GitHub release URL: `https://github.com/{owner}/{repo}/releases/tag/{tag}`. */
    url: string;
    sha256OfHtmlZip: string;
}

/** The repository and release tag a pin's URL names. Undefined when the URL is not a GitHub release URL. */
export function parseWebuiPinUrl(url: string): { ownerRepo: string; repoName: string; tag: string } | undefined {
    const match = url.match(/github\.com\/([^/]+\/([^/]+))\/releases\/tag\/(.+)$/);
    return match ? { ownerRepo: match[1], repoName: match[2], tag: match[3] } : undefined;
}

/**
 * The release tag a web UI directory was built from, read from the `<app>-release-manifest.json` every web
 * UI build must ship. Undefined when the directory has no readable release manifest.
 * bin/postinstall.js has a copy of this, because it runs without dist/.
 */
export async function readWebuiReleaseTag(webuiDir: string): Promise<string | undefined> {
    const names = await fs.readdir(webuiDir).catch(() => [] as string[]);
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
 * Why the web UI directory `webuiDir` must not be served or reused for any of `pins`, or undefined when it
 * holds the pinned version of one of them. A directory belongs to the pin whose repo name is part of its
 * name (e.g. `seedit-html-0.6.3` to `.../seedit/releases/tag/v0.6.3`), and holds the pinned version when
 * its release manifest names the pin's tag.
 *
 * A web UI of another version may use other schemas than this bitsocial-cli, so it is never served.
 */
export async function whyWebuiDirDoesNotMatchPins(webuiDir: string, pins: WebuiPin[]): Promise<string | undefined> {
    const dirName = path.basename(webuiDir).toLowerCase();
    const pinsOfDir = pins.map((pin) => parseWebuiPinUrl(pin.url)).filter((pin) => pin && dirName.includes(pin.repoName.toLowerCase()));
    if (pinsOfDir.length === 0) return "package.json pins no web UI of this name";
    const releaseTag = await readWebuiReleaseTag(webuiDir);
    if (releaseTag === undefined) return "it has no release manifest (<app>-release-manifest.json with a releaseTag), so its version is unknown";
    if (pinsOfDir.some((pin) => pin!.tag === releaseTag)) return undefined;
    return `it is ${releaseTag}, but package.json pins ${pinsOfDir.map((pin) => pin!.tag).join(", ")}`;
}
