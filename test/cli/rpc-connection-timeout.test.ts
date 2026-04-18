import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EventEmitter from "events";

vi.mock("@pkcprotocol/pkc-js", () => {
    return {
        default: vi.fn()
    };
});

// Also mock the logger so BaseCommand.init() doesn't fail
vi.mock("../../src/util.js", () => {
    const noopLogger = Object.assign(() => () => {}, { disable: () => {}, enable: () => {}, enabled: () => false });
    return {
        PKCLogger: noopLogger,
        setupDebugLogger: vi.fn()
    };
});

describe("RPC connection timeout", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("should throw if communitieschange is not emitted within 20s", async () => {
        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        const fakePkc = new EventEmitter();
        vi.mocked(PKCMock).mockResolvedValue(fakePkc as any);

        const { BaseCommand } = await import("../../src/cli/base-command.js");
        class TestCommand extends BaseCommand {
            async run() {}
            connectToPkcRpc(url: string) {
                return this._connectToPkcRpc(url);
            }
        }
        const cmd = new TestCommand([], {} as any);

        const connectPromise = cmd.connectToPkcRpc("ws://localhost:9138/wrong-auth");
        // Prevent unhandled rejection warning — we assert on the error below
        let caughtError: Error | undefined;
        connectPromise.catch((err) => {
            caughtError = err;
        });

        await vi.advanceTimersByTimeAsync(20000);

        expect(caughtError).toBeDefined();
        expect(caughtError!.message).toMatch(/Could not connect to the daemon/);
        expect(caughtError!.message).toContain("bitsocial daemon");
    });

    it("should resolve immediately and clear timeout when communitieschange is emitted", async () => {
        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        const fakePkc = new EventEmitter();
        vi.mocked(PKCMock).mockResolvedValue(fakePkc as any);

        const { BaseCommand } = await import("../../src/cli/base-command.js");
        class TestCommand extends BaseCommand {
            async run() {}
            connectToPkcRpc(url: string) {
                return this._connectToPkcRpc(url);
            }
        }
        const cmd = new TestCommand([], {} as any);

        const connectPromise = cmd.connectToPkcRpc("ws://localhost:9138");

        // Let the PKC() promise resolve so the listener is registered
        await vi.advanceTimersByTimeAsync(0);

        // Simulate successful connection
        fakePkc.emit("communitieschange", []);

        const result = await connectPromise;
        expect(result).toBe(fakePkc);

        // Advance past the 20s mark — if timeout wasn't cleared, this would reject
        await vi.advanceTimersByTimeAsync(25000);
    });

    it("should reject with the last pkc error if one was emitted before timeout", async () => {
        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        const fakePkc = new EventEmitter();
        vi.mocked(PKCMock).mockResolvedValue(fakePkc as any);

        const { BaseCommand } = await import("../../src/cli/base-command.js");
        class TestCommand extends BaseCommand {
            async run() {}
            connectToPkcRpc(url: string) {
                return this._connectToPkcRpc(url);
            }
        }
        const cmd = new TestCommand([], {} as any);

        const connectPromise = cmd.connectToPkcRpc("ws://localhost:9138/wrong-auth");
        let caughtError: Error | undefined;
        connectPromise.catch((err) => {
            caughtError = err;
        });

        // Wait a tick so the PKC() promise resolves and the error listener is registered
        await vi.advanceTimersByTimeAsync(0);

        // Simulate pkc emitting an auth error
        const authError = new Error("RPC server rejected the connection. The auth key is either missing or wrong.");
        Object.assign(authError, { code: "ERR_RPC_AUTH_REQUIRED" });
        fakePkc.emit("error", authError);

        await vi.advanceTimersByTimeAsync(20000);

        expect(caughtError).toBeDefined();
        expect(caughtError!.message).toMatch(/auth key is either missing or wrong/);
    });

    it("should show user-friendly message when a connection error is emitted before timeout", async () => {
        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        const fakePkc = new EventEmitter();
        vi.mocked(PKCMock).mockResolvedValue(fakePkc as any);

        const { BaseCommand } = await import("../../src/cli/base-command.js");
        class TestCommand extends BaseCommand {
            async run() {}
            connectToPkcRpc(url: string) {
                return this._connectToPkcRpc(url);
            }
        }
        const cmd = new TestCommand([], {} as any);

        const connectPromise = cmd.connectToPkcRpc("ws://localhost:9138");
        let caughtError: Error | undefined;
        connectPromise.catch((err) => {
            caughtError = err;
        });

        await vi.advanceTimersByTimeAsync(0);

        // Simulate a connection refused error
        fakePkc.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:9138"));

        await vi.advanceTimersByTimeAsync(20000);

        expect(caughtError).toBeDefined();
        expect(caughtError!.message).toMatch(/Could not connect to the daemon at ws:\/\/localhost:9138/);
        expect(caughtError!.message).toContain("bitsocial daemon");
    });

    it("should not dump errors to console.error when connection fails", async () => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const { default: PKCMock } = await import("@pkcprotocol/pkc-js");
        const fakePkc = new EventEmitter();
        vi.mocked(PKCMock).mockResolvedValue(fakePkc as any);

        const { BaseCommand } = await import("../../src/cli/base-command.js");
        class TestCommand extends BaseCommand {
            async run() {}
            connectToPkcRpc(url: string) {
                return this._connectToPkcRpc(url);
            }
        }
        const cmd = new TestCommand([], {} as any);

        const connectPromise = cmd.connectToPkcRpc("ws://localhost:9138");
        connectPromise.catch(() => {});

        await vi.advanceTimersByTimeAsync(0);
        fakePkc.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:9138"));
        await vi.advanceTimersByTimeAsync(20000);

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
