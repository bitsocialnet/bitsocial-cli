// bin/postinstall.js (also `npm run ci:download-web-uis`, which `test:cli` runs first) used the existence
// of dist/webuis as both its lock and its "download complete" marker: it created the directory first and
// returned early whenever it already existed. A web UI skipped on one run (rate limit, network error) was
// never retried, pins changed by a pull were never downloaded, and a directory left without its
// index_backup_no_rpc.html still counted as installed, which made daemon start fail.
//
// It now decides per web UI, from the release manifest every web UI build must ship: a directory is
// installed for a pin only when its `<app>-release-manifest.json` names the pinned release tag. A web UI
// of any other version is never left in dist/webuis, because the daemon would serve it.
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
// and every requested URL is appended to FAKE_FETCH_LOG. With FAKE_RENAME_FAIL set, the first rename onto
// that path fails with EPERM, as Windows can fail one while another process holds a file open.
const FETCH_STUB = `
import fs from "node:fs";
if (process.env.FAKE_RENAME_FAIL) {
    const rename = fs.promises.rename;
    let failed = false;
    fs.promises.rename = async (from, to) => {
        if (!failed && String(to) === process.env.FAKE_RENAME_FAIL) {
            failed = true;
            throw Object.assign(new Error("EPERM: operation not permitted, rename '" + from + "' -> '" + to + "'"), { code: "EPERM" });
        }
        return rename(from, to);
    };
}
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
    /** Files inside the extracted directory, next to the release manifest; defaults to an index.html. */
    files?: Record<string, string>;
    /** `releaseTag` of the release manifest in the build; defaults to `tag`. `null` ships no release manifest. */
    manifestTag?: string | null;
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
            const app = release.repo.split("/")[1];
            const manifestTag = release.manifestTag === undefined ? release.tag : release.manifestTag;
            const files = Object.entries({
                ...(release.files ?? { "index.html": "<html></html>" }),
                ...(manifestTag === null
                    ? {}
                    : { [`${app}-release-manifest.json`]: JSON.stringify({ schema: "bitsocial.release-manifest.v1", appName: app, releaseTag: manifestTag }) })
            });
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

    const run = async (extraEnv: Record<string, string> = {}, expectedStatus = 0) => {
        await fs.rm(fetchLog, { force: true });
        const result = spawnSync(process.execPath, ["--import", pathToFileURL(stubPath).href, path.join(root, "bin", "postinstall.js")], {
            env: { ...process.env, FAKE_RELEASES: path.join(work, "releases.json"), FAKE_FETCH_LOG: fetchLog, ...extraEnv },
            encoding: "utf-8"
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(expectedStatus);
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
const FIVECHAN: FakeRelease = { repo: "bitsocialnet/5chan", tag: "v0.10.2", dir: "5chan-0.10.2-html" };
const BITBONES: FakeRelease = { repo: "bitsocialnet/bitbones", tag: "v0.1.0", dir: "bitbones-html-0.1.0" };

describe("bin/postinstall.js web UI download", () => {
    it("downloads every pinned web UI and skips the download on the next run", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, FIVECHAN]);

        await pkg.run();
        expect(await pkg.installedDirs()).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
        await expect(fs.access(path.join(pkg.webuisDir, "seedit-html-0.6.0", "index_backup_no_rpc.html"))).resolves.toBeUndefined();
        for (const workDir of [".webuis-extract", ".webuis-staging", ".webuis-old"]) {
            await expect(fs.access(path.join(pkg.webuisDir, "..", workDir))).rejects.toThrow();
        }
        // The release manifests say what is installed; postinstall keeps no list of its own
        expect((await fs.readdir(pkg.webuisDir)).sort()).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);

        const second = await pkg.run();
        expect(second.fetched, second.output).toEqual([]);
        expect(await pkg.installedDirs()).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
    });

    it("downloads the pinned version when dist/webuis holds an outdated one (pins changed by a pull)", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT_OLD, FIVECHAN]);
        await pkg.run();
        expect(await pkg.installedDirs()).toEqual(["5chan-0.10.2-html", "seedit-html-0.5.10"]);

        await pkg.publish([SEEDIT, FIVECHAN]);
        const { output, fetched } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
        // 5chan is already installed in its pinned version, so only seedit is downloaded
        expect(fetched.filter((url) => url.includes("5chan")), output).toEqual([]);
    });

    it("retries a web UI whose download failed on the previous run", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, { ...FIVECHAN, status: 403 }]);
        const failed = await pkg.run();
        expect(await pkg.installedDirs()).toEqual(["seedit-html-0.6.0"]);
        expect(failed.output).toContain("Dropped bitsocialnet/5chan@v0.10.2");

        await pkg.publish([SEEDIT, FIVECHAN]);
        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
    });

    it("does not leave a web UI directory behind when its install step fails", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        // A zip without index.html: extraction succeeds, but the index.html -> index_backup_no_rpc.html
        // rename fails. The daemon would fail to start on a directory without index_backup_no_rpc.html.
        await pkg.publish([SEEDIT, { ...FIVECHAN, files: { "app.js": "" } }]);

        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["seedit-html-0.6.0"]);
    });

    // A web UI of another version than the pinned one may use other schemas than this bitsocial-cli, so it is
    // never served: when the pinned version cannot be downloaded, the installed copy is dropped, with a
    // message, and the web UI stays out until a later run installs the pinned version.
    it("drops the installed copy of a web UI whose pinned version cannot be downloaded", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT_OLD, FIVECHAN]);
        await pkg.run();

        await pkg.publish([{ ...SEEDIT, status: 503 }, FIVECHAN]);
        const offline = await pkg.run();
        expect(await pkg.installedDirs(), offline.output).toEqual(["5chan-0.10.2-html"]);
        expect(offline.output).toContain("Dropped bitsocialnet/seedit@v0.6.0");
        expect(offline.output).toContain("seedit-html-0.5.10");

        await pkg.publish([SEEDIT, FIVECHAN]);
        const online = await pkg.run();
        expect(await pkg.installedDirs(), online.output).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
    });

    it("keeps the installed web UIs and downloads nothing when GitHub cannot be reached and no pin changed", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, FIVECHAN]);
        await pkg.run();

        await pkg.publish([{ ...SEEDIT, status: 503 }, { ...FIVECHAN, status: 503 }]);
        const offline = await pkg.run();

        expect(offline.fetched, offline.output).toEqual([]);
        expect(await pkg.installedDirs(), offline.output).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
    });

    it("fails when no pinned web UI can be installed", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([{ ...SEEDIT, status: 503 }, { ...FIVECHAN, status: 503 }]);

        const { output } = await pkg.run({}, 1);

        expect(output).toContain("No web UIs were installed");
    });

    // Every web UI build must ship `<app>-release-manifest.json` naming its release tag. Without it nothing
    // can tell which version a directory holds, so the build is rejected.
    it("rejects a downloaded web UI that has no release manifest", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, { ...BITBONES, manifestTag: null }]);

        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["seedit-html-0.6.0"]);
        expect(output).toContain("Dropped bitsocialnet/bitbones@v0.1.0");
        expect(output).toContain("release manifest");
    });

    it("rejects a downloaded web UI whose release manifest names another version than the pin", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, { ...FIVECHAN, manifestTag: "v0.10.1" }]);

        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["seedit-html-0.6.0"]);
        expect(output).toContain("Dropped bitsocialnet/5chan@v0.10.2");
        expect(output).toContain("v0.10.1");
    });

    it("downloads a web UI again when its installed directory has no release manifest", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, FIVECHAN]);
        await pkg.run();
        // As installed by an older bitsocial-cli from a build that shipped no release manifest
        await fs.rm(path.join(pkg.webuisDir, "seedit-html-0.6.0", "seedit-release-manifest.json"));

        const { output, fetched } = await pkg.run();

        expect(fetched.some((url) => url.includes("seedit")), output).toBe(true);
        await expect(fs.access(path.join(pkg.webuisDir, "seedit-html-0.6.0", "seedit-release-manifest.json"))).resolves.toBeUndefined();
    });

    // The swap moves dist/webuis to dist/.webuis-old before it moves the new set in. A rename failing after
    // that left dist/webuis missing while postinstall exited 0, and the next run deleted dist/.webuis-old.
    it("puts the installed web UIs back when the new set cannot be moved into place", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT_OLD, FIVECHAN]);
        await pkg.run();
        const before = ["5chan-0.10.2-html", "seedit-html-0.5.10"];
        await pkg.publish([SEEDIT, FIVECHAN]);

        const failedSwap = await pkg.run({ FAKE_RENAME_FAIL: pkg.webuisDir });
        expect(failedSwap.output).toContain("EPERM");
        expect(await pkg.installedDirs(), failedSwap.output).toEqual(before);
        for (const name of before) {
            await expect(fs.access(path.join(pkg.webuisDir, name, "index_backup_no_rpc.html"))).resolves.toBeUndefined();
        }

        const { output } = await pkg.run();
        expect(await pkg.installedDirs(), output).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
    });

    // A fresh install (every `npm install -g`, which never ships dist/webuis) has no previous set to put
    // back. postinstall used to warn and exit 0, so the install reported success and daemon start then
    // failed on the missing dist/webuis.
    it("fails the install when the web UIs cannot be moved into place and none were installed before", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, FIVECHAN]);

        const failedSwap = await pkg.run({ FAKE_RENAME_FAIL: pkg.webuisDir }, 1);
        expect(failedSwap.output).toContain("EPERM");
        await expect(fs.access(pkg.webuisDir)).rejects.toThrow();

        const { output } = await pkg.run();
        expect(await pkg.installedDirs(), output).toEqual(["5chan-0.10.2-html", "seedit-html-0.6.0"]);
        await expect(fs.access(path.join(pkg.webuisDir, "..", ".webuis-staging"))).rejects.toThrow();
    });

    it("removes a web UI that is no longer pinned, and an incomplete one", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, BITBONES]);
        await pkg.run();
        // seedit without its index_backup_no_rpc.html, as an interrupted run of an older postinstall left it
        await fs.rm(path.join(pkg.webuisDir, "seedit-html-0.6.0", "index_backup_no_rpc.html"));

        // bitbones is no longer pinned, and seedit cannot be downloaded
        await pkg.publish([{ ...SEEDIT, status: 503 }, FIVECHAN]);
        const { output } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["5chan-0.10.2-html"]);
    });

    it("removes a web UI that is no longer pinned even when every pinned one is installed", { timeout: 60000 }, async () => {
        const pkg = await setupPackage();
        await pkg.publish([SEEDIT, BITBONES]);
        await pkg.run();

        await pkg.publish([SEEDIT]);
        const { output, fetched } = await pkg.run();

        expect(await pkg.installedDirs(), output).toEqual(["seedit-html-0.6.0"]);
        expect(fetched, output).toEqual([]);
    });
});
