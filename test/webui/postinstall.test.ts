// bin/postinstall.js (also `npm run ci:download-web-uis`, which `test:cli` runs first) used the existence
// of dist/webuis as both its lock and its "download complete" marker: it created the directory first and
// returned early whenever it already existed. A web UI skipped on one run (rate limit, network error) was
// never retried, pins changed by a pull were never downloaded, and a directory left without its
// index_backup_no_rpc.html still counted as installed, which made daemon start fail.
//
// Each test runs a copy of the real script in a temp package root against a stubbed GitHub (a module
// preloaded with --import replaces fetch) that serves real zip files, so decompress runs for real.

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import zlib from "zlib";
import { directory as randomDirectory } from "tempy";

const REPO_ROOT = process.cwd();

/** A zip archive with the given files, stored without compression. */
function makeZip(files: Record<string, string>): Buffer {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name);
        const data = Buffer.from(content);
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // local file header signature
        local.writeUInt16LE(10, 4); // version needed
        local.writeUInt16LE(0x21, 12); // date: 1980-01-01
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18); // compressed size (stored)
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0); // central directory header signature
        header.writeUInt16LE(20, 4); // version made by
        header.writeUInt16LE(10, 6); // version needed
        header.writeUInt16LE(0x21, 14);
        header.writeUInt32LE(crc, 16);
        header.writeUInt32LE(data.length, 20);
        header.writeUInt32LE(data.length, 24);
        header.writeUInt16LE(nameBuf.length, 28);
        header.writeUInt32LE(offset, 42); // offset of the local header
        parts.push(local, nameBuf, data);
        central.push(header, nameBuf);
        offset += local.length + nameBuf.length + data.length;
    }
    const centralDir = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, centralDir, end]);
}

// Replaces fetch for the script: GitHub's release API and asset downloads are served from FAKE_RELEASES,
// and every requested URL is appended to FAKE_FETCH_LOG.
const FETCH_STUB = `
import fs from "node:fs";
const releases = JSON.parse(fs.readFileSync(process.env.FAKE_RELEASES, "utf-8"));
globalThis.fetch = async (url) => {
    const href = String(url);
    fs.appendFileSync(process.env.FAKE_FETCH_LOG, href + "\\n");
    const api = href.match(/^https:\\/\\/api\\.github\\.com\\/repos\\/(.+)\\/releases\\/tags\\/(.+)$/);
    if (api) {
        const release = releases[api[1] + "@" + api[2]];
        if (!release || release.status) return new Response("unavailable", { status: release ? release.status : 404 });
        const assets = [{ name: release.name, browser_download_url: "https://downloads.test/" + release.name }];
        return new Response(JSON.stringify({ assets }));
    }
    const asset = Object.values(releases).find((r) => r.name && href === "https://downloads.test/" + r.name);
    if (asset) return new Response(fs.readFileSync(asset.zip));
    return new Response("not found", { status: 404 });
};
`;

interface FakeRelease {
    repo: string; // owner/repo
    tag: string;
    /** Name of the extracted directory (the asset is `<dir>.zip`). */
    dir: string;
    /** Files inside the extracted directory; defaults to an index.html. */
    files?: Record<string, string>;
    /** Serve the release API with this HTTP status instead. */
    status?: number;
}

async function setupPackage() {
    const root = randomDirectory();
    const work = randomDirectory();
    await fs.mkdir(path.join(root, "bin"), { recursive: true });
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.copyFile(path.join(REPO_ROOT, "bin", "postinstall.js"), path.join(root, "bin", "postinstall.js"));
    // Resolve `decompress` from the repo's dependencies
    await fs.symlink(await fs.realpath(path.join(REPO_ROOT, "node_modules")), path.join(root, "node_modules"), "junction");
    const stubPath = path.join(work, "fetch-stub.mjs");
    await fs.writeFile(stubPath, FETCH_STUB);
    const fetchLog = path.join(work, "fetch.log");

    /** Write package.json pins and the matching fake releases. */
    const publish = async (releases: FakeRelease[]) => {
        const served: Record<string, { name?: string; zip?: string; status?: number }> = {};
        const webuis = [];
        for (const release of releases) {
            const files = Object.entries(release.files ?? { "index.html": "<html></html>" });
            const zip = makeZip(Object.fromEntries(files.map(([file, content]) => [`${release.dir}/${file}`, content])));
            const zipPath = path.join(work, `${release.dir}.zip`);
            await fs.writeFile(zipPath, zip);
            served[`${release.repo}@${release.tag}`] = release.status
                ? { status: release.status }
                : { name: `${release.dir}.zip`, zip: zipPath };
            webuis.push({
                url: `https://github.com/${release.repo}/releases/tag/${release.tag}`,
                sha256OfHtmlZip: createHash("sha256").update(zip).digest("hex")
            });
        }
        await fs.writeFile(path.join(work, "releases.json"), JSON.stringify(served));
        await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fake", version: "0.0.0", webuis }, null, 4));
    };

    const run = async () => {
        await fs.rm(fetchLog, { force: true });
        const result = spawnSync(process.execPath, ["--import", pathToFileURL(stubPath).href, path.join(root, "bin", "postinstall.js")], {
            env: { ...process.env, FAKE_RELEASES: path.join(work, "releases.json"), FAKE_FETCH_LOG: fetchLog },
            encoding: "utf-8"
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        const fetched = (await fs.readFile(fetchLog, "utf-8").catch(() => "")).split("\n").filter(Boolean);
        return { output: `${result.stdout}\n${result.stderr}`, fetched };
    };

    const webuisDir = path.join(root, "dist", "webuis");
    const installedDirs = async () =>
        (await fs.readdir(webuisDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
    return { publish, run, webuisDir, installedDirs };
}

const SEEDIT_OLD: FakeRelease = { repo: "bitsocialnet/seedit", tag: "v0.5.10", dir: "seedit-html-0.5.10" };
const SEEDIT: FakeRelease = { repo: "bitsocialnet/seedit", tag: "v0.6.0", dir: "seedit-html-0.6.0" };
const PLEBONES: FakeRelease = { repo: "plebbit/plebones", tag: "v0.1.27", dir: "plebones-html-0.1.27" };
const FIVECHAN: FakeRelease = { repo: "bitsocialnet/5chan", tag: "v0.10.2", dir: "5chan-0.10.2-html" };

describe("bin/postinstall.js web UI download", () => {
    it("downloads every pinned web UI and skips the download on the next run", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, PLEBONES]);

        await pkg.run();
        expect(await pkg.installedDirs()).toEqual(["plebones-html-0.1.27", "seedit-html-0.6.0"]);
        await expect(fs.access(path.join(pkg.webuisDir, "seedit-html-0.6.0", "index_backup_no_rpc.html"))).resolves.toBeUndefined();
        for (const workDir of [".webuis-extract", ".webuis-staging", ".webuis-old"]) {
            await expect(fs.access(path.join(pkg.webuisDir, "..", workDir))).rejects.toThrow();
        }

        const second = await pkg.run();
        expect(second.fetched, second.output).toEqual([]);
        expect(await pkg.installedDirs()).toEqual(["plebones-html-0.1.27", "seedit-html-0.6.0"]);
    });

    it("downloads the pinned version when dist/webuis holds an outdated one (pins changed by a pull)", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT_OLD, PLEBONES]);
        await pkg.run();
        expect(await pkg.installedDirs()).toEqual(["plebones-html-0.1.27", "seedit-html-0.5.10"]);

        await pkg.publish([SEEDIT, PLEBONES]);
        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["plebones-html-0.1.27", "seedit-html-0.6.0"]);
    });

    it("retries a web UI whose download failed on the previous run", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, { ...PLEBONES, status: 403 }]);
        await pkg.run();
        expect(await pkg.installedDirs()).toEqual(["seedit-html-0.6.0"]);

        await pkg.publish([SEEDIT, PLEBONES]);
        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["plebones-html-0.1.27", "seedit-html-0.6.0"]);
    });

    it("does not leave a web UI directory behind when its install step fails", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        // A zip without index.html: extraction succeeds, but the index.html -> index_backup_no_rpc.html
        // rename fails. The daemon would fail to start on a directory without index_backup_no_rpc.html.
        await pkg.publish([SEEDIT, { ...PLEBONES, files: { "app.js": "" } }]);

        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["seedit-html-0.6.0"]);
    });

    // dist/webuis is only replaced once the new set is ready: a run that cannot download a web UI (offline,
    // rate limited) keeps the version already installed instead of deleting it, and exits 0 as long as a
    // web UI is installed, so an offline `npm install` in an existing checkout still succeeds.
    it("keeps the installed web UIs when GitHub cannot be reached, and downloads them on the next run", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT_OLD, PLEBONES]);
        await pkg.run();

        await pkg.publish([{ ...SEEDIT, status: 503 }, { ...PLEBONES, status: 503 }]);
        const offline = await pkg.run();
        expect(await pkg.installedDirs(), offline.output).toEqual(["plebones-html-0.1.27", "seedit-html-0.5.10"]);

        await pkg.publish([SEEDIT, PLEBONES]);
        const online = await pkg.run();
        expect(await pkg.installedDirs(), online.output).toEqual(["plebones-html-0.1.27", "seedit-html-0.6.0"]);
    });

    it("replaces the web UIs it could download and keeps the installed version of the others", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT_OLD, PLEBONES]);
        await pkg.run();

        await pkg.publish([SEEDIT, { ...PLEBONES, status: 403 }]);
        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["plebones-html-0.1.27", "seedit-html-0.6.0"]);
    });

    it("does not keep a web UI that is no longer pinned, or an incomplete one", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, PLEBONES]);
        await pkg.run();
        // seedit without its index_backup_no_rpc.html, as an interrupted run of an older postinstall left it
        await fs.rm(path.join(pkg.webuisDir, "seedit-html-0.6.0", "index_backup_no_rpc.html"));

        // plebones is no longer pinned, and seedit cannot be downloaded
        await pkg.publish([{ ...SEEDIT, status: 503 }, FIVECHAN]);
        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["5chan-0.10.2-html"]);
    });
});
