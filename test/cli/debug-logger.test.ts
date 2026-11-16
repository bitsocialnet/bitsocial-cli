import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import fsPromise from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PKCLogger, setupDebugLogger, type PKCLoggerType } from "../../dist/util.js";

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

// bin/run strips DEBUG before oclif loads (so the debug module does not print to stderr on its own) and hands
// it to the CLI under another name. That name has to be the one the CLI reads (issue #271).
describe("DEBUG passed through bin/run", () => {
    it("reaches the daemon as its debug namespace", { timeout: 60000 }, async () => {
        // An occupied RPC port makes the daemon exit right after it logged its namespace, before it touches kubo.
        const occupied = createServer();
        await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
        const port = (occupied.address() as AddressInfo).port;
        const logPath = await fsPromise.mkdtemp(path.join(os.tmpdir(), "bitsocial-debug-env-"));
        try {
            const env: NodeJS.ProcessEnv = { ...process.env, DEBUG: "bitsocial-cli:daemon" };
            delete env["_PKC_DEBUG"];
            await new Promise<void>((resolve, reject) => {
                const proc = spawn("node", ["./bin/run", "daemon", "--pkcRpcUrl", `ws://127.0.0.1:${port}`, "--logPath", logPath], {
                    env,
                    stdio: "ignore"
                });
                proc.once("error", reject);
                proc.once("exit", () => resolve());
            });
            const logFiles = await fsPromise.readdir(logPath);
            expect(logFiles).toHaveLength(1);
            const log = await fsPromise.readFile(path.join(logPath, logFiles[0]), "utf-8");
            expect(log).toContain('Debug logs is on with namespace "bitsocial-cli:daemon"');
        } finally {
            await new Promise<void>((resolve) => occupied.close(() => resolve()));
            await fsPromise.rm(logPath, { recursive: true, force: true });
        }
    });
});
