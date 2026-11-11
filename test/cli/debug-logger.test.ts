import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "child_process";
import { PKCLogger, setupDebugLogger, type PKCLoggerType } from "../../dist/util.js";
import { allocateFreePort } from "../helpers/daemon-helpers.js";

describe("setupDebugLogger", () => {
    let savedDebug: string | undefined;
    let savedPkcDebug: string | undefined;
    let savedDebugDepth: string | undefined;

    afterEach(() => {
        // Restore env vars
        if (savedDebug === undefined) delete process.env["DEBUG"];
        else process.env["DEBUG"] = savedDebug;
        if (savedPkcDebug === undefined) delete process.env["_PKC_DEBUG"];
        else process.env["_PKC_DEBUG"] = savedPkcDebug;
        if (savedDebugDepth === undefined) delete process.env["DEBUG_DEPTH"];
        else process.env["DEBUG_DEPTH"] = savedDebugDepth;
        savedDebug = savedPkcDebug = savedDebugDepth = undefined;
    });

    const saveEnv = () => {
        savedDebug = process.env["DEBUG"];
        savedPkcDebug = process.env["_PKC_DEBUG"];
        savedDebugDepth = process.env["DEBUG_DEPTH"];
    };

    // Helper: disable logger first, then set env vars (Logger.disable() deletes process.env.DEBUG)
    const resetLoggerAndSetEnv = (env: { DEBUG?: string; _PKC_DEBUG?: string; DEBUG_DEPTH?: string }) => {
        PKCLogger.disable(); // This deletes process.env.DEBUG as a side effect
        // Set env vars AFTER disable
        if ("DEBUG" in env) {
            if (env.DEBUG === undefined) delete process.env["DEBUG"];
            else process.env["DEBUG"] = env.DEBUG;
        }
        if ("_PKC_DEBUG" in env) {
            if (env._PKC_DEBUG === undefined) delete process.env["_PKC_DEBUG"];
            else process.env["_PKC_DEBUG"] = env._PKC_DEBUG;
        }
        if ("DEBUG_DEPTH" in env) {
            if (env.DEBUG_DEPTH === undefined) delete process.env["DEBUG_DEPTH"];
            else process.env["DEBUG_DEPTH"] = env.DEBUG_DEPTH;
        }
        return PKCLogger;
    };

    it("enables namespace from DEBUG env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "bitsocial*,pkc*", _PKC_DEBUG: undefined });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBe("bitsocial*,pkc*");
        expect(Logger.enabled("bitsocial-cli:commands:community:list")).toBe(true);
    });

    it("enables namespace from _PKC_DEBUG env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PKC_DEBUG: "bitsocial*" });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBe("bitsocial*");
        expect(Logger.enabled("bitsocial-cli:commands:community:list")).toBe(true);
    });

    it("_PKC_DEBUG takes priority over DEBUG", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "pkc*", _PKC_DEBUG: "bitsocial*" });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBe("bitsocial*");
        expect(Logger.enabled("bitsocial-cli")).toBe(true);
    });

    it("does NOT enable any namespace when no env var set and enableDefaultNamespace is false", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PKC_DEBUG: undefined });

        setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(Logger.enabled("bitsocial-cli")).toBe(false);
        expect(Logger.enabled("pkc-js")).toBe(false);
    });

    it("enables default namespace when enableDefaultNamespace is true and no env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PKC_DEBUG: undefined });

        setupDebugLogger(Logger, { enableDefaultNamespace: true });

        expect(Logger.enabled("bitsocial-cli")).toBe(true);
        expect(Logger.enabled("pkc-js")).toBe(true);
        // trace should be excluded by default namespace
        expect(Logger.enabled("pkc-js:trace")).toBe(false);
    });

    it("respects DEBUG_DEPTH env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PKC_DEBUG: undefined, DEBUG_DEPTH: "5" }) as PKCLoggerType;

        const result = setupDebugLogger(Logger);

        expect(result.debugDepth).toBe(5);
        expect(Logger.inspectOpts?.depth).toBe(5);
    });

    it("defaults DEBUG_DEPTH to 10", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PKC_DEBUG: undefined, DEBUG_DEPTH: undefined }) as PKCLoggerType;

        const result = setupDebugLogger(Logger);

        expect(result.debugDepth).toBe(10);
        expect(Logger.inspectOpts?.depth).toBe(10);
    });

    it("treats DEBUG='0' as disabled", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "0", _PKC_DEBUG: undefined });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBeUndefined();
        expect(Logger.enabled("bitsocial-cli")).toBe(false);
    });

    it("treats DEBUG='' as disabled", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "", _PKC_DEBUG: undefined });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBeUndefined();
        expect(Logger.enabled("bitsocial-cli")).toBe(false);
    });
});

// bin/run moves DEBUG aside before the debug module loads, and setupDebugLogger reads it back from
// _PKC_DEBUG. The launcher kept writing the old _PLEBBIT_DEBUG name, so DEBUG did nothing on an
// installed CLI: commands logged nothing and the daemon fell back to its default namespaces.
describe("DEBUG through bin/run", () => {
    it("enables the namespaces DEBUG names", { timeout: 60_000 }, async () => {
        const namespace = "bitsocial-cli:commands:community:list";
        const nothingListening = `ws://127.0.0.1:${await allocateFreePort()}`;
        const env: NodeJS.ProcessEnv = { ...process.env, DEBUG: namespace };
        delete env["_PKC_DEBUG"];
        const child = spawn("node", ["./bin/run", "community", "list", "--pkcRpcUrl", nothingListening], {
            stdio: ["ignore", "ignore", "pipe"],
            env
        });
        let stderr = "";
        // The command logs its flags under this namespace before it tries to reach the daemon, so stop as soon as that
        // line shows up instead of waiting out the connect timeout.
        await new Promise<void>((resolve, reject) => {
            child.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
                // Match the whole prefix: stderr arrives in chunks, which can split the line after the namespace
                if (stderr.includes(`${namespace} flags:`)) resolve();
            });
            child.on("error", reject);
            child.on("close", () => resolve());
        });
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        expect(stderr).toContain(`${namespace} flags:`);
    });
});
