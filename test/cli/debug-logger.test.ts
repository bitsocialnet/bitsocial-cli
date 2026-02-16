import { describe, it, expect, afterEach } from "vitest";
import { getPlebbitLogger, setupDebugLogger, type PlebbitLogger } from "../../dist/util.js";

describe("setupDebugLogger", () => {
    let savedDebug: string | undefined;
    let savedPlebbitDebug: string | undefined;
    let savedDebugDepth: string | undefined;

    afterEach(() => {
        // Restore env vars
        if (savedDebug === undefined) delete process.env["DEBUG"];
        else process.env["DEBUG"] = savedDebug;
        if (savedPlebbitDebug === undefined) delete process.env["_PLEBBIT_DEBUG"];
        else process.env["_PLEBBIT_DEBUG"] = savedPlebbitDebug;
        if (savedDebugDepth === undefined) delete process.env["DEBUG_DEPTH"];
        else process.env["DEBUG_DEPTH"] = savedDebugDepth;
        savedDebug = savedPlebbitDebug = savedDebugDepth = undefined;
    });

    const saveEnv = () => {
        savedDebug = process.env["DEBUG"];
        savedPlebbitDebug = process.env["_PLEBBIT_DEBUG"];
        savedDebugDepth = process.env["DEBUG_DEPTH"];
    };

    // Helper: disable logger first, then set env vars (Logger.disable() deletes process.env.DEBUG)
    const resetLoggerAndSetEnv = async (env: { DEBUG?: string; _PLEBBIT_DEBUG?: string; DEBUG_DEPTH?: string }) => {
        const Logger = await getPlebbitLogger();
        Logger.disable(); // This deletes process.env.DEBUG as a side effect
        // Set env vars AFTER disable
        if ("DEBUG" in env) {
            if (env.DEBUG === undefined) delete process.env["DEBUG"];
            else process.env["DEBUG"] = env.DEBUG;
        }
        if ("_PLEBBIT_DEBUG" in env) {
            if (env._PLEBBIT_DEBUG === undefined) delete process.env["_PLEBBIT_DEBUG"];
            else process.env["_PLEBBIT_DEBUG"] = env._PLEBBIT_DEBUG;
        }
        if ("DEBUG_DEPTH" in env) {
            if (env.DEBUG_DEPTH === undefined) delete process.env["DEBUG_DEPTH"];
            else process.env["DEBUG_DEPTH"] = env.DEBUG_DEPTH;
        }
        return Logger;
    };

    it("enables namespace from DEBUG env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "bitsocial*,plebbit*", _PLEBBIT_DEBUG: undefined });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBe("bitsocial*,plebbit*");
        expect(Logger.enabled("bitsocial-cli:commands:community:list")).toBe(true);
    });

    it("enables namespace from _PLEBBIT_DEBUG env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PLEBBIT_DEBUG: "bitsocial*" });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBe("bitsocial*");
        expect(Logger.enabled("bitsocial-cli:commands:community:list")).toBe(true);
    });

    it("_PLEBBIT_DEBUG takes priority over DEBUG", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "plebbit*", _PLEBBIT_DEBUG: "bitsocial*" });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBe("bitsocial*");
        expect(Logger.enabled("bitsocial-cli")).toBe(true);
    });

    it("does NOT enable any namespace when no env var set and enableDefaultNamespace is false", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PLEBBIT_DEBUG: undefined });

        setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(Logger.enabled("bitsocial-cli")).toBe(false);
        expect(Logger.enabled("plebbit-js")).toBe(false);
    });

    it("enables default namespace when enableDefaultNamespace is true and no env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PLEBBIT_DEBUG: undefined });

        setupDebugLogger(Logger, { enableDefaultNamespace: true });

        expect(Logger.enabled("bitsocial-cli")).toBe(true);
        expect(Logger.enabled("plebbit-js")).toBe(true);
        // trace should be excluded by default namespace
        expect(Logger.enabled("plebbit-js:trace")).toBe(false);
    });

    it("respects DEBUG_DEPTH env var", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PLEBBIT_DEBUG: undefined, DEBUG_DEPTH: "5" }) as PlebbitLogger;

        const result = setupDebugLogger(Logger);

        expect(result.debugDepth).toBe(5);
        expect(Logger.inspectOpts?.depth).toBe(5);
    });

    it("defaults DEBUG_DEPTH to 10", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: undefined, _PLEBBIT_DEBUG: undefined, DEBUG_DEPTH: undefined }) as PlebbitLogger;

        const result = setupDebugLogger(Logger);

        expect(result.debugDepth).toBe(10);
        expect(Logger.inspectOpts?.depth).toBe(10);
    });

    it("treats DEBUG='0' as disabled", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "0", _PLEBBIT_DEBUG: undefined });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBeUndefined();
        expect(Logger.enabled("bitsocial-cli")).toBe(false);
    });

    it("treats DEBUG='' as disabled", async () => {
        saveEnv();
        const Logger = await resetLoggerAndSetEnv({ DEBUG: "", _PLEBBIT_DEBUG: undefined });

        const result = setupDebugLogger(Logger, { enableDefaultNamespace: false });

        expect(result.debugNamespace).toBeUndefined();
        expect(Logger.enabled("bitsocial-cli")).toBe(false);
    });
});
