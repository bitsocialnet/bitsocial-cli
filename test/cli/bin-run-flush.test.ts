import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";

describe("bin/run", () => {
    // The warning only exists on newer Node versions, so this watches the value itself, which is wrong on all of them.
    it("keeps flush's default wait on a command that returns a value", { timeout: 60_000 }, async () => {
        const preload = path.join(randomDirectory(), "record-timeouts.mjs");
        await fs.writeFile(
            preload,
            `const real = globalThis.setTimeout;
             globalThis.setTimeout = (callback, ms, ...rest) => {
                 if (typeof ms !== "number" && ms !== undefined) process.stderr.write("NON_NUMERIC_TIMEOUT\\n");
                 if (ms === 10000) process.stderr.write("FLUSH_DEFAULT_TIMEOUT\\n");
                 return real(callback, ms, ...rest);
             };`
        );
        const { stderr, exitCode } = await new Promise<{ stderr: string; exitCode: number | null }>((resolve, reject) => {
            const child = spawn("node", ["--import", `file://${preload}`, "./bin/run", "reachability", "status", "--json", "--pkcOptions.dataPath", randomDirectory()], {
                stdio: ["ignore", "ignore", "pipe"],
                env: { ...process.env, KUBO_RPC_URL: "http://127.0.0.1:9/api/v0", IPFS_PATH: "" }
            });
            let stderr = "";
            child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ stderr, exitCode }));
        });
        expect(exitCode).toBe(0);
        expect(stderr).not.toContain("NON_NUMERIC_TIMEOUT");
        expect(stderr).toContain("FLUSH_DEFAULT_TIMEOUT");
    });
});
