import { describe, it, expect, beforeAll } from "vitest";
import { Config, Parser } from "@oclif/core";
import os from "node:os";
import path from "node:path";

// Runs the prerun hook and then oclif's parser on the loaded command class, the way `this.parse` does inside run().
// run() itself is never called, so no daemon starts.
describe("prerun hook: `bitsocial daemon --no-<flag>`", () => {
    let config: Config;
    const logPath = path.join(os.tmpdir(), "bitsocial-hook-test-logs");

    beforeAll(async () => {
        config = await Config.load(process.cwd());
    });

    const parseDaemonFlags = async (argv: string[]) => {
        const Daemon = await config.findCommand("daemon")!.load();
        const hookResult = await config.runHook("prerun", { Command: Daemon, argv: [...argv] });
        expect(hookResult.failures).toEqual([]);
        const { flags } = await Parser.parse([...argv], {
            flags: { ...Daemon.baseFlags, ...Daemon.flags },
            args: Daemon.args,
            strict: Daemon.strict
        });
        return flags;
    };

    // The hook registered `--no-allowPrivateKeyExport` as a new dynamic boolean flag named "no-allowPrivateKeyExport".
    // oclif matches a flag's exact name before it tries negation, so allowPrivateKeyExport stayed true and the daemon
    // kept serving private-key exports while the operator thought they were off.
    it.each([
        { name: "alone", argv: ["--no-allowPrivateKeyExport"] },
        { name: "before another flag", argv: ["--no-allowPrivateKeyExport", "--logPath", logPath] },
        { name: "after another flag", argv: ["--logPath", logPath, "--no-allowPrivateKeyExport"] },
        { name: "next to a dynamic flag", argv: ["--pkcOptions.dataPath=/data", "--no-allowPrivateKeyExport"] }
    ])("--no-allowPrivateKeyExport $name turns private-key export off", async ({ argv }) => {
        const flags = await parseDaemonFlags(argv);
        expect(flags.allowPrivateKeyExport).toBe(false);
        expect(flags).not.toHaveProperty("no-allowPrivateKeyExport");
    });

    it.each([
        { name: "alone", argv: ["--no-enableIpfsGc"] },
        { name: "before another flag", argv: ["--no-enableIpfsGc", "--logPath", logPath] },
        { name: "after another flag", argv: ["--logPath", logPath, "--no-enableIpfsGc"] }
    ])("--no-enableIpfsGc $name turns IPFS GC off", async ({ argv }) => {
        const flags = await parseDaemonFlags(argv);
        expect(flags.enableIpfsGc).toBe(false);
        expect(flags).not.toHaveProperty("no-enableIpfsGc");
    });

    // Issue #283: how often the daemon checks its announced WSS addresses is a flag, not an environment variable.
    it("checks announced WSS addresses every 15 minutes by default, and takes another interval or 0 for off", async () => {
        expect((await parseDaemonFlags(["--logPath", logPath])).wssCheckIntervalMinutes).toBe(15);
        expect((await parseDaemonFlags(["--logPath", logPath, "--wssCheckIntervalMinutes", "5"])).wssCheckIntervalMinutes).toBe(5);
        expect((await parseDaemonFlags(["--logPath", logPath, "--wssCheckIntervalMinutes=0"])).wssCheckIntervalMinutes).toBe(0);
        await expect(parseDaemonFlags(["--logPath", logPath, "--wssCheckIntervalMinutes", "-1"])).rejects.toThrow();
        // A timer longer than 2^31-1 ms fires after 1 ms in Node, which would turn "monthly" into "continuously".
        expect((await parseDaemonFlags(["--logPath", logPath, "--wssCheckIntervalMinutes", "35791"])).wssCheckIntervalMinutes).toBe(35791);
        await expect(parseDaemonFlags(["--logPath", logPath, "--wssCheckIntervalMinutes", "43200"])).rejects.toThrow();
    });

    it("keeps both flags on by default and still registers dynamic flags", async () => {
        const flags = await parseDaemonFlags(["--pkcOptions.dataPath=/data", "--logPath", logPath]);
        expect(flags.allowPrivateKeyExport).toBe(true);
        expect(flags.enableIpfsGc).toBe(true);
        expect(flags.logPath).toBe(logPath);
        expect((flags as Record<string, unknown>)["pkcOptions.dataPath"]).toBe("/data");
    });
});
