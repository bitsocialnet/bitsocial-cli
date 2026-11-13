import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { directory as randomDirectory } from "tempy";
import { describe, expect, it, vi } from "vitest";
import { removeStaleRuns } from "./temp-root.global-setup.js";

// #248: the suite used to leave every temp directory behind in the OS temp dir.
describe("the run's temp directory", () => {
    it("holds what tests create through os.tmpdir() and tempy, so the teardown removes it all", () => {
        expect(path.basename(os.tmpdir())).toMatch(/^bsc-test-/);
        expect(path.dirname(randomDirectory())).toBe(os.tmpdir());
    });

    it("keeps the compile cache outside it, so the CLIs the tests start stay warm", () => {
        expect(process.env["NODE_COMPILE_CACHE"]).toBeDefined();
        expect(path.relative(os.tmpdir(), process.env["NODE_COMPILE_CACHE"]!).startsWith("..")).toBe(true);
    });

    it("removes the directory of a run that was killed over a day ago, and nothing else", async () => {
        const tempDirectory = randomDirectory();
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        for (const name of ["bsc-test-killed", "bsc-test-running", "someone-elses"]) await fs.mkdir(path.join(tempDirectory, name, "repo"), { recursive: true });
        for (const name of ["bsc-test-killed", "someone-elses"]) await fs.utimes(path.join(tempDirectory, name), twoDaysAgo, twoDaysAgo);

        await removeStaleRuns(tempDirectory);

        expect((await fs.readdir(tempDirectory)).sort()).toEqual(["bsc-test-running", "someone-elses"]);
    });

    it("keeps an old directory while the process that made it is alive, as a watch session idle for days is", async () => {
        const tempDirectory = randomDirectory();
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const exitedPid = spawnSync(process.execPath, ["-e", ""]).pid;
        const names = [`bsc-test-${process.pid}-watching`, `bsc-test-${exitedPid}-killed`];
        for (const name of names) {
            await fs.mkdir(path.join(tempDirectory, name, "repo"), { recursive: true });
            await fs.utimes(path.join(tempDirectory, name), twoDaysAgo, twoDaysAgo);
        }

        await removeStaleRuns(tempDirectory);

        expect(await fs.readdir(tempDirectory)).toEqual([`bsc-test-${process.pid}-watching`]);
    });

    it("says which directory it could not remove", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const rm = vi.spyOn(fs, "rm").mockRejectedValue(new Error("EBUSY: resource busy or locked"));
        const tempDirectory = randomDirectory();
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await fs.mkdir(path.join(tempDirectory, "bsc-test-locked"));
        await fs.utimes(path.join(tempDirectory, "bsc-test-locked"), twoDaysAgo, twoDaysAgo);

        try {
            await removeStaleRuns(tempDirectory);
            expect(warn).toHaveBeenCalledOnce();
            expect(warn.mock.calls[0].join(" ")).toContain(path.join(tempDirectory, "bsc-test-locked"));
            expect(warn.mock.calls[0].join(" ")).toContain("EBUSY");
        } finally {
            rm.mockRestore();
            warn.mockRestore();
        }
    });
});
