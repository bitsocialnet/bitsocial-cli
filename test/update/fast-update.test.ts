import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

// Mock external dependencies before importing the module under test
vi.mock("../../src/common-utils/npm.js", () => ({
    runNpmPack: vi.fn(),
    ensureNpmAvailable: vi.fn().mockResolvedValue(undefined),
    getNpmCliPath: vi.fn().mockResolvedValue("/usr/bin/npm"),
    getNpmEnv: vi.fn().mockReturnValue(process.env)
}));

vi.mock("decompress", () => ({
    default: vi.fn()
}));

import { fastInstallGlobal } from "../../src/update/fast-update.js";
import { runNpmPack } from "../../src/common-utils/npm.js";
import decompress from "decompress";

const FAKE_ZIP_BYTES = Buffer.from("fake-webui-zip");
const FAKE_ZIP_SHA256 = createHash("sha256").update(FAKE_ZIP_BYTES).digest("hex");

const MOCK_OLD_PKG = {
    name: "@bitsocial/bitsocial-cli",
    version: "0.19.45",
    dependencies: { "dep-a": "1.0.0", "dep-b": "2.0.0" },
    webuis: [
        { url: "https://github.com/plebbit/seedit/releases/tag/v0.5.10", sha256OfHtmlZip: "aaa" },
        { url: "https://github.com/plebbit/plebones/releases/tag/v0.1.27", sha256OfHtmlZip: "bbb" }
    ]
};

const MOCK_NEW_PKG_SAME_DEPS = {
    ...MOCK_OLD_PKG,
    version: "0.19.46"
};

const MOCK_NEW_PKG_CHANGED_DEPS = {
    ...MOCK_OLD_PKG,
    version: "0.19.46",
    dependencies: { "dep-a": "1.0.0", "dep-b": "3.0.0" }
};

const MOCK_NEW_PKG_CHANGED_WEBUI = {
    ...MOCK_OLD_PKG,
    version: "0.19.46",
    webuis: [
        { url: "https://github.com/plebbit/seedit/releases/tag/v0.5.11", sha256OfHtmlZip: "ccc" },
        { url: "https://github.com/plebbit/plebones/releases/tag/v0.1.27", sha256OfHtmlZip: "bbb" }
    ]
};

describe("fastInstallGlobal", () => {
    let tmpDir: string;
    let installRoot: string;
    let logOutput: string[];
    const log = (msg: string) => logOutput.push(msg);

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fast-update-test-"));
        installRoot = path.join(tmpDir, "bitsocial-cli");
        logOutput = [];

        // Create a mock old install directory
        await fs.mkdir(installRoot, { recursive: true });
        await fs.mkdir(path.join(installRoot, "node_modules", "dep-a"), { recursive: true });
        await fs.writeFile(path.join(installRoot, "node_modules", "dep-a", "index.js"), "module.exports = {}");
        await fs.mkdir(path.join(installRoot, "dist", "webuis", "seedit-html-0.5.10"), { recursive: true });
        await fs.mkdir(path.join(installRoot, "dist", "webuis", "plebones-html-0.1.27"), { recursive: true });
        await fs.writeFile(
            path.join(installRoot, "dist", "webuis", "seedit-html-0.5.10", "index_backup_no_rpc.html"),
            "<html></html>"
        );
        await fs.writeFile(path.join(installRoot, "dist", "webuis", "plebones-html-0.1.27", "index_backup_no_rpc.html"), "<html></html>");
        await fs.writeFile(path.join(installRoot, "package.json"), JSON.stringify(MOCK_OLD_PKG));
        await fs.mkdir(path.join(installRoot, "bin"), { recursive: true });
        await fs.writeFile(path.join(installRoot, "bin", "run"), "#!/usr/bin/env node");
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * Serve GitHub's release API and asset downloads: each release has one `<repo>-html-<version>.zip`
     * asset whose bytes are FAKE_ZIP_BYTES (the decompress mock turns it into `<repo>-html-<version>/`).
     */
    function stubGithubReleases() {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string | URL) => {
                const href = String(url);
                const release = href.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/([^/]+)\/releases\/tags\/v(.+)$/);
                if (release) {
                    const name = `${release[1]}-html-${release[2]}.zip`;
                    return new Response(JSON.stringify({ assets: [{ name, browser_download_url: `https://downloads.test/${name}` }] }));
                }
                if (href.startsWith("https://downloads.test/")) return new Response(FAKE_ZIP_BYTES);
                return new Response("not found", { status: 404 });
            })
        );
    }

    /** Helper: set up runNpmPack and decompress mocks to extract a new package.json */
    function setupMocks(newPkg: Record<string, unknown>) {
        vi.mocked(runNpmPack).mockImplementation(async (_spec: string, destDir: string) => {
            const tgzPath = path.join(destDir, "bitsocial-cli-0.19.46.tgz");
            await fs.writeFile(tgzPath, "fake-tarball");
            return tgzPath;
        });

        (vi.mocked(decompress) as any).mockImplementation(async (input: any, output: any) => {
            if (String(input).endsWith(".zip")) {
                // Simulate extracting a web UI zip into <name-without-.zip>/
                const dir = path.join(output, path.basename(String(input), ".zip"));
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(path.join(dir, "index.html"), "<html></html>");
                return [];
            }
            // Simulate extracting the tarball — write package.json, bin/, dist/
            await fs.mkdir(path.join(output, "bin"), { recursive: true });
            await fs.mkdir(path.join(output, "dist"), { recursive: true });
            await fs.writeFile(path.join(output, "package.json"), JSON.stringify(newPkg));
            await fs.writeFile(path.join(output, "bin", "run"), "#!/usr/bin/env node");
            await fs.writeFile(path.join(output, "bin", "postinstall.js"), "// postinstall");
            return [];
        });
    }

    it("returns true and preserves node_modules + webuis when deps unchanged", async () => {
        setupMocks(MOCK_NEW_PKG_SAME_DEPS);

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        // node_modules should still exist at installRoot
        const depIndex = await fs.readFile(
            path.join(installRoot, "node_modules", "dep-a", "index.js"),
            "utf-8"
        );
        expect(depIndex).toBe("module.exports = {}");
        // webuis should still exist
        const webuiHtml = await fs.readFile(
            path.join(installRoot, "dist", "webuis", "seedit-html-0.5.10", "index_backup_no_rpc.html"),
            "utf-8"
        );
        expect(webuiHtml).toBe("<html></html>");
        // new package.json should be in place
        const pkg = JSON.parse(await fs.readFile(path.join(installRoot, "package.json"), "utf-8"));
        expect(pkg.version).toBe("0.19.46");
        // staging and backup dirs should be gone
        await expect(fs.access(installRoot + ".__fast_update_staging")).rejects.toThrow();
        await expect(fs.access(installRoot + ".__fast_update_backup")).rejects.toThrow();
    });

    it("returns false when dependencies changed", async () => {
        setupMocks(MOCK_NEW_PKG_CHANGED_DEPS);

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(false);
        expect(logOutput.some((m) => m.includes("Dependencies changed"))).toBe(true);
        // installRoot should be untouched
        const pkg = JSON.parse(await fs.readFile(path.join(installRoot, "package.json"), "utf-8"));
        expect(pkg.version).toBe("0.19.45");
        // node_modules should still be there
        await expect(fs.access(path.join(installRoot, "node_modules", "dep-a"))).resolves.toBeUndefined();
    });

    // A changed web UI used to be deleted before its replacement was downloaded, and a failed download
    // was only logged: the update reported success with that web UI gone, and since later fast updates
    // compare package.json entries only, nothing downloaded it again.
    it("falls back to a full install and leaves the current install untouched when a changed web UI cannot be downloaded", async () => {
        setupMocks(MOCK_NEW_PKG_CHANGED_WEBUI);
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network disabled in test")));

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(false);
        expect(logOutput.some((m) => m.includes("network disabled in test"))).toBe(true);
        // The old install, including the web UI that was about to be replaced, is still in place
        const pkg = JSON.parse(await fs.readFile(path.join(installRoot, "package.json"), "utf-8"));
        expect(pkg.version).toBe("0.19.45");
        await expect(
            fs.access(path.join(installRoot, "dist", "webuis", "seedit-html-0.5.10", "index_backup_no_rpc.html"))
        ).resolves.toBeUndefined();
        await expect(fs.access(path.join(installRoot, "dist", "webuis", "plebones-html-0.1.27"))).resolves.toBeUndefined();
        await expect(fs.access(path.join(installRoot, "node_modules", "dep-a"))).resolves.toBeUndefined();
        await expect(fs.access(installRoot + ".__fast_update_staging")).rejects.toThrow();
    });

    it("downloads a changed web UI before the swap and replaces the old version", async () => {
        const changedSeedit = { url: "https://github.com/plebbit/seedit/releases/tag/v0.5.11", sha256OfHtmlZip: FAKE_ZIP_SHA256 };
        setupMocks({ ...MOCK_OLD_PKG, version: "0.19.46", webuis: [changedSeedit, MOCK_OLD_PKG.webuis[1]] });
        stubGithubReleases();

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        const webuisDir = path.join(installRoot, "dist", "webuis");
        expect((await fs.readdir(webuisDir)).sort()).toEqual(["plebones-html-0.1.27", "seedit-html-0.5.11"]);
        await expect(fs.access(path.join(webuisDir, "seedit-html-0.5.11", "index_backup_no_rpc.html"))).resolves.toBeUndefined();
        await expect(fs.access(path.join(webuisDir, "seedit-html-0.5.11", "index.html"))).rejects.toThrow();
    });

    it("downloads an unchanged web UI whose directory is missing from the current install", async () => {
        // Same plebones pin in the old and new package.json: only the disk says it is missing
        const plebones = { url: "https://github.com/plebbit/plebones/releases/tag/v0.1.27", sha256OfHtmlZip: FAKE_ZIP_SHA256 };
        const webuis = [MOCK_OLD_PKG.webuis[0], plebones];
        await fs.writeFile(path.join(installRoot, "package.json"), JSON.stringify({ ...MOCK_OLD_PKG, webuis }));
        await fs.rm(path.join(installRoot, "dist", "webuis", "plebones-html-0.1.27"), { recursive: true });
        setupMocks({ ...MOCK_OLD_PKG, version: "0.19.46", webuis });
        stubGithubReleases();

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        expect((await fs.readdir(path.join(installRoot, "dist", "webuis"))).sort()).toEqual(["plebones-html-0.1.27", "seedit-html-0.5.10"]);
    });

    // Older postinstalls extracted straight into dist/webuis, so an interrupted run could leave a directory
    // without index_backup_no_rpc.html. The daemon reads that file from every web UI directory and fails to
    // start without it, so such a directory must be downloaded again, not carried into the new install.
    it("downloads an unchanged web UI whose directory is incomplete", async () => {
        const plebones = { url: "https://github.com/plebbit/plebones/releases/tag/v0.1.27", sha256OfHtmlZip: FAKE_ZIP_SHA256 };
        const webuis = [MOCK_OLD_PKG.webuis[0], plebones];
        await fs.writeFile(path.join(installRoot, "package.json"), JSON.stringify({ ...MOCK_OLD_PKG, webuis }));
        await fs.rm(path.join(installRoot, "dist", "webuis", "plebones-html-0.1.27", "index_backup_no_rpc.html"));
        setupMocks({ ...MOCK_OLD_PKG, version: "0.19.46", webuis });
        stubGithubReleases();

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        const webuisDir = path.join(installRoot, "dist", "webuis");
        expect((await fs.readdir(webuisDir)).sort()).toEqual(["plebones-html-0.1.27", "seedit-html-0.5.10"]);
        await expect(fs.access(path.join(webuisDir, "plebones-html-0.1.27", "index_backup_no_rpc.html"))).resolves.toBeUndefined();
    });

    it("removes the web UI of an entry dropped from package.json", async () => {
        setupMocks({ ...MOCK_OLD_PKG, version: "0.19.46", webuis: [MOCK_OLD_PKG.webuis[0]] });

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        expect(await fs.readdir(path.join(installRoot, "dist", "webuis"))).toEqual(["seedit-html-0.5.10"]);
    });

    it("cleans up leftover staging dir from interrupted previous update", async () => {
        const stagingDir = installRoot + ".__fast_update_staging";
        await fs.mkdir(stagingDir, { recursive: true });
        await fs.writeFile(path.join(stagingDir, "leftover"), "stale");

        setupMocks(MOCK_NEW_PKG_SAME_DEPS);
        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        await expect(fs.access(stagingDir)).rejects.toThrow();
    });

    it("cleans up leftover backup dir from interrupted previous update", async () => {
        const backupDir = installRoot + ".__fast_update_backup";
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(path.join(backupDir, "leftover"), "stale");

        setupMocks(MOCK_NEW_PKG_SAME_DEPS);
        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(true);
        await expect(fs.access(backupDir)).rejects.toThrow();
    });

    it("returns false and restores node_modules when swap fails after node_modules move", async () => {
        setupMocks(MOCK_NEW_PKG_SAME_DEPS);

        // Make the decompress mock also write a package.json that will match deps,
        // but make the installRoot un-renamable after node_modules moves.
        // We'll achieve this by removing write permission from parent dir AFTER node_modules moves.
        // Instead, let's use a simpler approach: mock decompress to not create dist/ dir,
        // which will cause the webuis rename to fail in a way that tests rollback.

        // Actually, let's directly test: after the mocks set up a valid staging dir,
        // make fs.rename fail for the atomic swap by making installRoot a read-only parent.
        const originalRename = fs.rename;
        let renameCallCount = 0;
        vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
            renameCallCount++;
            // First rename: node_modules old -> staging (allow)
            // Second rename: webuis old -> staging (allow)
            // Third rename: installRoot -> backup (fail to test rollback)
            if (renameCallCount === 3) {
                throw new Error("simulated rename failure");
            }
            return originalRename(oldPath as string, newPath as string);
        });

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(false);
        // node_modules should be restored to installRoot
        await expect(
            fs.access(path.join(installRoot, "node_modules", "dep-a"))
        ).resolves.toBeUndefined();
    });

    it("returns false when runNpmPack fails", async () => {
        vi.mocked(runNpmPack).mockRejectedValue(new Error("npm pack failed"));

        const result = await fastInstallGlobal("0.19.46", installRoot, log);

        expect(result).toBe(false);
        expect(logOutput.some((m) => m.includes("npm pack failed"))).toBe(true);
        // staging dir should be cleaned up
        await expect(fs.access(installRoot + ".__fast_update_staging")).rejects.toThrow();
        // installRoot should be untouched
        const pkg = JSON.parse(await fs.readFile(path.join(installRoot, "package.json"), "utf-8"));
        expect(pkg.version).toBe("0.19.45");
    });
});
