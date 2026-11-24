// Issue #280: on a Node older than package.json's engines.node the daemon started kubo and then died with
// "Cannot read properties of undefined (reading 'bind')", which says nothing about Node.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8")) as { engines: { node: string } };
const fakeOldNode = pathToFileURL(path.resolve("test/fixtures/fake-old-node.mjs")).href;

type Guard = { unsupportedNodeMessage: (running: string, range: string) => string | undefined };
// A plain .js file with no types, so it is loaded by path.
const loadGuard = async (): Promise<Guard> => import(pathToFileURL(path.resolve("bin/node-version-guard.js")).href);

const run = (args: string[], nodeArgs: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        const proc = spawn("node", [...nodeArgs, "./bin/run", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        // Never leave a CLI process behind, whatever it turned out to do.
        const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
        proc.on("error", reject);
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });

describe("unsupportedNodeMessage", () => {
    it.each(["22.12.0", "22.18.9", "20.19.5", "18.0.0", "9.11.2"])("refuses Node %s, naming it and the required version", async (running) => {
        const { unsupportedNodeMessage } = await loadGuard();
        const message = unsupportedNodeMessage(running, ">=22.19.0")!;
        expect(message).toContain(`Node.js ${running}`);
        expect(message).toContain("22.19.0 or later");
    });

    it.each(["22.19.0", "22.19.1", "22.23.4", "24.14.1", "100.0.0", "23.0.0-nightly20250101"])("accepts Node %s", async (running) => {
        const { unsupportedNodeMessage } = await loadGuard();
        expect(unsupportedNodeMessage(running, ">=22.19.0")).toBeUndefined();
    });

    it("compares numbers, not strings", async () => {
        const { unsupportedNodeMessage } = await loadGuard();
        expect(unsupportedNodeMessage("22.9.0", ">=22.19.0")).toBeDefined();
        expect(unsupportedNodeMessage("22.100.0", ">=22.19.0")).toBeUndefined();
    });

    it.each(["", "^22.19.0", ">=22.19.0 <25", "22.x", "garbage"])("lets the CLI run when it cannot read the requirement (%j) or the running version, rather than lock everyone out", async (range) => {
        const { unsupportedNodeMessage } = await loadGuard();
        expect(unsupportedNodeMessage("18.0.0", range)).toBeUndefined();
        expect(unsupportedNodeMessage("not-a-version", ">=22.19.0")).toBeUndefined();
    });

    it("understands the requirement package.json really declares", async () => {
        const { unsupportedNodeMessage } = await loadGuard();
        // If engines.node becomes a range the guard cannot read, the guard goes quiet. This fails first.
        expect(unsupportedNodeMessage("0.0.1", packageJson.engines.node)).toBeDefined();
    });
});

describe("bin/run on an unsupported Node version", () => {
    it("prints the required and the running version and exits 1, for any command", { timeout: 30_000 }, async () => {
        const required = packageJson.engines.node.replace(">=", "");
        // Commands that only print, so that a guard that failed to stop them would start nothing on this machine.
        for (const args of [["daemon", "--help"], ["--version"], ["reachability", "--help"]]) {
            const { stdout, stderr, exitCode } = await run(args, ["--import", fakeOldNode], { FAKE_NODE_VERSION: "22.12.0" });
            expect(exitCode).toBe(1);
            expect(stderr).toContain("Node.js 22.12.0");
            expect(stderr).toContain(`${required} or later`);
            expect(stderr).not.toContain("bind");
            // Nothing of the CLI ran: no banner, no version line, no daemon output.
            expect(stdout).toBe("");
        }
    });

    it("still runs on a supported version", { timeout: 30_000 }, async () => {
        const { stdout, exitCode } = await run(["--version"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("bitsocial");
    });

    it("loads nothing but the guard before the check, since any import may be what breaks on an old Node", () => {
        const source = fs.readFileSync("bin/run", "utf-8");
        // Static imports load before any code runs, so these two are all bin/run may have.
        expect(source.match(/^import .*$/gm)).toEqual(['import { readFileSync } from "fs";', 'import { unsupportedNodeMessage } from "./node-version-guard.js";']);
        // The CLI, and with it every other import, comes after the check.
        expect([...source.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1])).toEqual(["./run-cli.js"]);
        expect(source.indexOf("unsupportedNodeMessage(process")).toBeLessThan(source.indexOf('import("./run-cli.js")'));
    });

    // Node parses a whole file before running any of it. Syntax an old Node does not know would be a SyntaxError
    // before the check, and the operator would never see the message.
    it.each(["bin/run", "bin/node-version-guard.js"])("keeps %s to syntax that Node 12 already had", (file) => {
        const code = fs
            .readFileSync(file, "utf-8")
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n");
        expect(code).not.toMatch(/\bawait\b/);
        expect(code).not.toMatch(/\?\.|\?\?|\|\|=|&&=/);
        expect(code).not.toMatch(/\bcatch\s*\{/);
        expect(code).not.toMatch(/from "node:|import\("node:/);
    });
});
