import { spawn } from "child_process";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
//@ts-ignore
import Sinon from "sinon";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import fs from "fs";
import path from "path";
import dns from "node:dns";
import PKC from "@pkcprotocol/pkc-js";
import { findPageSortUsages, loadPageSortsIntoPKC, reloadPageSortsInDaemon } from "../../src/page-sort-packages/page-sort-utils.js";
import { reloadUrlFromPkcRpcUrl } from "../../src/common-utils/package-registry.js";
import { PAGE_SORT_PACKAGE_KIND } from "../../src/page-sort-packages/page-sort-utils.js";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";
dns.setDefaultResultOrder("ipv4first");

// Page sort packages (issue #164): same install machinery as challenges, registered into PKC.pageSorts.

const createMinimalPageSortDir = async (dir: string, name: string, opts?: { version?: string; description?: string; sortName?: string }): Promise<void> => {
    await fsPromise.mkdir(dir, { recursive: true });
    await fsPromise.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name, version: opts?.version, description: opts?.description, type: "module" }, null, 2)
    );
    await fsPromise.writeFile(
        path.join(dir, "index.js"),
        `export default function () {
    return { sortName: ${JSON.stringify(opts?.sortName ?? "fromPackage")}, description: ${JSON.stringify(opts?.description ?? "A test sort")}, score: ({ comment }) => comment.timestamp };
}
`
    );
};

const runBitsocialPageSort = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", "page-sort", ...args], { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error("bitsocial page-sort command timed out"));
        }, 60000); // 60s timeout because npm install can be slow
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });
};

// No daemon listens on this port, so remove's in-use check cannot connect
const NO_DAEMON_RPC_URL = "ws://127.0.0.1:1";

describe("bitsocial page-sort install / list / remove", () => {
    let srcDir: string;
    let scopedSrcDir: string;

    beforeAll(async () => {
        const tmpDir = randomDirectory();
        srcDir = path.join(tmpDir, "test-page-sort");
        await createMinimalPageSortDir(srcDir, "test-page-sort", { version: "1.0.0" });
        scopedSrcDir = path.join(tmpDir, "scoped-page-sort");
        await createMinimalPageSortDir(scopedSrcDir, "@test-scope/scoped-page-sort", { version: "2.0.0" });
    });

    it("installs into <dataPath>/page-sorts and lists it", async () => {
        const dataPath = randomDirectory();
        const install = await runBitsocialPageSort(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(install.exitCode).toBe(0);
        expect(install.stdout).toContain("added test-page-sort@1.0.0 in");
        expect(fs.existsSync(path.join(dataPath, "page-sorts", "test-page-sort", "package.json"))).toBe(true);

        const list = await runBitsocialPageSort(["list", "--pkcOptions.dataPath", dataPath]);
        expect(list.stdout).toContain(path.resolve(dataPath, "page-sorts"));
        expect(list.stdout).toContain("└── test-page-sort@1.0.0 (sortName: fromPackage)");
    });

    // The sortName is the key a package publishes under in pageCids, and need not match the package name (issue #173)
    it("lists each package's sortName and reports a package that fails to load without dropping the others", async () => {
        const dataPath = randomDirectory();
        await runBitsocialPageSort(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        // Planted directly: install would refuse it
        const brokenDir = path.join(dataPath, "page-sorts", "broken-page-sort");
        await createMinimalPageSortDir(brokenDir, "broken-page-sort", { version: "0.1.0" });
        await fsPromise.writeFile(path.join(brokenDir, "index.js"), `throw new Error("broken page sort");\n`);

        const list = await runBitsocialPageSort(["list", "--pkcOptions.dataPath", dataPath]);
        expect(list.exitCode).toBe(0);
        expect(list.stdout).toContain("├── broken-page-sort@0.1.0 (failed to load: broken page sort)");
        expect(list.stdout).toContain("└── test-page-sort@1.0.0 (sortName: fromPackage)");

        const quiet = await runBitsocialPageSort(["list", "-q", "--pkcOptions.dataPath", dataPath]);
        expect(quiet.stdout.trim().split(/\r?\n/)).toEqual(["broken-page-sort", "test-page-sort"]);
    });

    it("warns when an upgrade changes the package's sortName, and not when it keeps it", async () => {
        const dataPath = randomDirectory();
        const first = await runBitsocialPageSort(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        expect(first.stderr).not.toContain("sortName");

        const sameNameDir = path.join(randomDirectory(), "test-page-sort");
        await createMinimalPageSortDir(sameNameDir, "test-page-sort", { version: "1.1.0" });
        const sameName = await runBitsocialPageSort(["install", sameNameDir, "--pkcOptions.dataPath", dataPath]);
        expect(sameName.exitCode).toBe(0);
        expect(sameName.stderr).not.toContain("sortName");

        const renamedDir = path.join(randomDirectory(), "test-page-sort");
        await createMinimalPageSortDir(renamedDir, "test-page-sort", { version: "2.0.0", sortName: "renamedSort" });
        const renamed = await runBitsocialPageSort(["install", renamedDir, "--pkcOptions.dataPath", dataPath]);
        expect(renamed.exitCode).toBe(0);
        expect(renamed.stdout).toContain("changed test-page-sort@2.0.0 in");
        const warning = renamed.stderr.replace(/[›»]/g, " ").replace(/\s+/g, " ");
        expect(warning).toContain('test-page-sort changed its sortName from "fromPackage" to "renamedSort"');
    });

    it("installs a scoped package and lists names only with -q", async () => {
        const dataPath = randomDirectory();
        await runBitsocialPageSort(["install", scopedSrcDir, "--pkcOptions.dataPath", dataPath]);
        expect(fs.existsSync(path.join(dataPath, "page-sorts", "@test-scope", "scoped-page-sort", "package.json"))).toBe(true);
        const list = await runBitsocialPageSort(["ls", "-q", "--pkcOptions.dataPath", dataPath]);
        expect(list.stdout.trim()).toBe("@test-scope/scoped-page-sort");
    });

    it("refuses a package whose default export is not a page sort (e.g. a challenge) and keeps the existing install", async () => {
        const dataPath = randomDirectory();
        await runBitsocialPageSort(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        // Same package name, but the new version is a challenge: it must not replace the working page sort
        const challengeDir = path.join(randomDirectory(), "test-page-sort");
        await fsPromise.mkdir(challengeDir, { recursive: true });
        await fsPromise.writeFile(path.join(challengeDir, "package.json"), JSON.stringify({ name: "test-page-sort", version: "2.0.0" }));
        await fsPromise.writeFile(
            path.join(challengeDir, "index.js"),
            "export default function () { return { type: 'text/plain', getChallenge: async () => ({ success: true }) }; }\n"
        );
        const result = await runBitsocialPageSort(["install", challengeDir, "--pkcOptions.dataPath", dataPath]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("ERR_PAGE_SORT_FILE_INVALID");
        const installed = JSON.parse(fs.readFileSync(path.join(dataPath, "page-sorts", "test-page-sort", "package.json"), "utf8"));
        expect(installed.version).toBe("1.0.0");
    });

    it("shows 'No page sort packages installed' when empty", async () => {
        const list = await runBitsocialPageSort(["list", "--pkcOptions.dataPath", randomDirectory()]);
        expect(list.stdout).toContain("No page sort packages installed");
    });

    it("refuses to remove when the daemon cannot be reached to check usage", async () => {
        const dataPath = randomDirectory();
        await runBitsocialPageSort(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
        const remove = await runBitsocialPageSort(["remove", "test-page-sort", "--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", NO_DAEMON_RPC_URL]);
        expect(remove.exitCode).not.toBe(0);
        expect(remove.stderr).toContain("--force");
        expect(fs.existsSync(path.join(dataPath, "page-sorts", "test-page-sort"))).toBe(true);
    });

    it("removes with --force and cleans up the empty @scope dir", async () => {
        const dataPath = randomDirectory();
        await runBitsocialPageSort(["install", scopedSrcDir, "--pkcOptions.dataPath", dataPath]);
        const remove = await runBitsocialPageSort([
            "rm",
            "@test-scope/scoped-page-sort",
            "--force",
            "--pkcOptions.dataPath",
            dataPath,
            "--pkcRpcUrl",
            NO_DAEMON_RPC_URL
        ]);
        expect(remove.exitCode).toBe(0);
        expect(remove.stdout).toContain("removed @test-scope/scoped-page-sort@2.0.0");
        // oclif wraps warnings at the terminal width and prefixes each line with "›" ("»" on Windows)
        expect(remove.stderr.replace(/[›»]/g, " ").replace(/\s+/g, " ")).toContain(
            'Skipped the in-use check. A community whose settings.pages still names "@test-scope/scoped-page-sort" keeps publishing without this sort.'
        );
        expect(fs.existsSync(path.join(dataPath, "page-sorts", "@test-scope"))).toBe(false);
    });

    // Checked before the daemon, so the error names the real problem rather than an unreachable daemon
    it("errors on a page sort that is not installed without contacting the daemon", async () => {
        const remove = await runBitsocialPageSort(["remove", "nope", "--pkcOptions.dataPath", randomDirectory(), "--pkcRpcUrl", NO_DAEMON_RPC_URL]);
        expect(remove.exitCode).not.toBe(0);
        expect(remove.stderr).toContain('Page sort "nope" is not installed.');
        expect(remove.stderr).not.toContain("Could not check");
    });
});

describe("bitsocial page-sort remove: in-use check against the daemon", () => {
    const sandbox = Sinon.createSandbox();
    let dataPath: string;

    const settingsByAddress: Record<string, unknown> = {
        "board.bso": { pages: { posts: [{ name: "hot" }, { name: "test-page-sort", preloaded: true }] } },
        "other.bso": { pages: { replies: [{ name: "test-page-sort" }] } },
        "unrelated.bso": {}
    };

    beforeAll(async () => {
        dataPath = randomDirectory();
        const srcDir = path.join(randomDirectory(), "test-page-sort");
        await createMinimalPageSortDir(srcDir, "test-page-sort", { version: "1.0.0" });
        await runBitsocialPageSort(["install", srcDir, "--pkcOptions.dataPath", dataPath]);
    });

    afterEach(() => clearPkcRpcConnectOverride());
    afterAll(() => sandbox.restore());

    const fakeDaemon = (settings: Record<string, unknown>) =>
        setPkcRpcConnectOverride(
            sandbox.fake.resolves({
                communities: Object.keys(settings).map((address) => ({ address, publicKey: address, started: true })),
                createCommunity: async ({ address }: { address: string }) => ({ address, settings: settings[address] }),
                destroy: async () => {}
            })
        );

    it("refuses and lists every community entry that names the package", async () => {
        fakeDaemon(settingsByAddress);
        const { result } = await runCliCommand(["page-sort", "remove", "test-page-sort", "--pkcOptions.dataPath", dataPath]);
        expect(result.error?.message).toContain("board.bso settings.pages.posts[1]");
        expect(result.error?.message).toContain("other.bso settings.pages.replies[0]");
        expect(result.error?.message).not.toContain("unrelated.bso");
        expect(fs.existsSync(path.join(dataPath, "page-sorts", "test-page-sort"))).toBe(true);
    });

    it("removes when no community uses it", async () => {
        fakeDaemon({ "unrelated.bso": {} });
        const { result, stdout } = await runCliCommand([
            "page-sort",
            "remove",
            "test-page-sort",
            "--pkcOptions.dataPath",
            dataPath,
            "--pkcRpcUrl",
            NO_DAEMON_RPC_URL
        ]);
        expect(result.error).toBeUndefined();
        expect(stdout).toContain("removed test-page-sort@1.0.0");
        expect(fs.existsSync(path.join(dataPath, "page-sorts", "test-page-sort"))).toBe(false);
    });
});

describe("page sort packages in the daemon", () => {
    it("findPageSortUsages reports each scope and index", () => {
        expect(findPageSortUsages({ posts: [{ name: "a" }, { name: "b" }], replies: [{ name: "b" }] }, "b")).toEqual(["posts[1]", "replies[0]"]);
        expect(findPageSortUsages(undefined, "b")).toEqual([]);
    });

    it("loadPageSortsIntoPKC registers packages into PKC.pageSorts and hands a shadowed built-in back on removal", async () => {
        const dataPath = randomDirectory();
        const registry = (PKC as unknown as { pageSorts: Record<string, unknown> }).pageSorts;
        const builtInActive = registry["active"];
        // An unscoped package named after a built-in shadows it, like a challenge package does
        await createMinimalPageSortDir(path.join(dataPath, "page-sorts", "active"), "active", { version: "9.9.9", description: "shadow" });
        await createMinimalPageSortDir(path.join(dataPath, "page-sorts", "@test-scope", "loaded-sort"), "@test-scope/loaded-sort", {
            version: "1.0.0"
        });
        try {
            const loaded = await loadPageSortsIntoPKC(dataPath);
            expect(loaded.map((p) => p.name).sort()).toEqual(["@test-scope/loaded-sort", "active"]);
            expect(typeof registry["@test-scope/loaded-sort"]).toBe("function");
            expect((registry["active"] as () => { description: string })().description).toBe("shadow");

            await fsPromise.rm(path.join(dataPath, "page-sorts"), { recursive: true });
            await loadPageSortsIntoPKC(dataPath);
            expect(registry["active"]).toBe(builtInActive);
            expect("@test-scope/loaded-sort" in registry).toBe(false);
        } finally {
            registry["active"] = builtInActive;
            delete registry["@test-scope/loaded-sort"];
        }
    });

    it("targets /api/page-sorts/reload and reports no daemon as not reloaded", async () => {
        expect(reloadUrlFromPkcRpcUrl(PAGE_SORT_PACKAGE_KIND, "ws://0.0.0.0:9138/")).toBe("http://127.0.0.1:9138/api/page-sorts/reload");
        expect(await reloadPageSortsInDaemon(NO_DAEMON_RPC_URL, 2000)).toBe(false);
    });
});
