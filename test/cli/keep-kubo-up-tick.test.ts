import { describe, it, expect } from "vitest";
import { runKeepKuboUpTick } from "../../dist/cli/commands/daemon.js";

const collectUnhandledRejections = (fn: () => Promise<void>) => {
    return new Promise<unknown[]>((resolve, reject) => {
        const collected: unknown[] = [];
        const handler = (err: unknown) => collected.push(err);
        process.on("unhandledRejection", handler);
        fn()
            .catch((err) => {
                process.off("unhandledRejection", handler);
                reject(err);
            })
            .then(() => {
                // Yield enough microtask cycles so any pending unhandledRejection has fired
                setImmediate(() => setImmediate(() => {
                    process.off("unhandledRejection", handler);
                    resolve(collected);
                }));
            });
    });
};

describe("runKeepKuboUpTick", () => {
    it("does not produce an unhandledRejection when tcpPortUsedCheck rejects with ETIMEDOUT (regression for #37 bug 3)", async () => {
        const errors: string[] = [];
        const unhandled = await collectUnhandledRejections(async () => {
            await runKeepKuboUpTick({
                pkcRpcUrl: new URL("ws://localhost:9138"),
                tcpPortUsedCheck: () => {
                    const err = new Error("connect ETIMEDOUT 127.0.0.1:9138");
                    Object.assign(err, { code: "ETIMEDOUT" });
                    return Promise.reject(err);
                },
                pkcOptionsFromFlag: undefined,
                usingDifferentProcessRpc: false,
                hasKuboProcess: false,
                hasPendingKuboStart: false,
                keepKuboUp: async () => {},
                createOrConnectRpc: async () => {},
                onError: (msg) => errors.push(msg)
            });
        });

        expect(unhandled).toHaveLength(0);
        // The error should have been routed to onError instead
        expect(errors.some((m) => m.includes("ETIMEDOUT"))).toBe(true);
    });

    it("does not produce an unhandledRejection when keepKuboUp throws", async () => {
        const errors: string[] = [];
        const unhandled = await collectUnhandledRejections(async () => {
            await runKeepKuboUpTick({
                pkcRpcUrl: new URL("ws://localhost:9138"),
                tcpPortUsedCheck: async () => false,
                pkcOptionsFromFlag: undefined,
                usingDifferentProcessRpc: false,
                hasKuboProcess: false,
                hasPendingKuboStart: false,
                keepKuboUp: async () => {
                    throw new Error("kubo boot failure");
                },
                createOrConnectRpc: async () => {},
                onError: (msg) => errors.push(msg)
            });
        });

        expect(unhandled).toHaveLength(0);
        expect(errors.some((m) => m.includes("kubo boot failure"))).toBe(true);
    });

    it("does not produce an unhandledRejection when createOrConnectRpc throws", async () => {
        const errors: string[] = [];
        const unhandled = await collectUnhandledRejections(async () => {
            await runKeepKuboUpTick({
                pkcRpcUrl: new URL("ws://localhost:9138"),
                tcpPortUsedCheck: async () => true,
                pkcOptionsFromFlag: undefined,
                usingDifferentProcessRpc: true,
                hasKuboProcess: true,
                hasPendingKuboStart: false,
                keepKuboUp: async () => {},
                createOrConnectRpc: async () => {
                    throw new Error("rpc connect failure");
                },
                onError: (msg) => errors.push(msg)
            });
        });

        expect(unhandled).toHaveLength(0);
        expect(errors.some((m) => m.includes("rpc connect failure"))).toBe(true);
    });

    it("calls keepKuboUp when port is free (no other process owns RPC)", async () => {
        let kuboCalls = 0;
        let rpcCalls = 0;
        await runKeepKuboUpTick({
            pkcRpcUrl: new URL("ws://localhost:9138"),
            tcpPortUsedCheck: async () => false,
            pkcOptionsFromFlag: undefined,
            usingDifferentProcessRpc: false,
            hasKuboProcess: false,
            hasPendingKuboStart: false,
            keepKuboUp: async () => {
                kuboCalls++;
            },
            createOrConnectRpc: async () => {
                rpcCalls++;
            },
            onError: () => {}
        });
        expect(kuboCalls).toBe(1);
        expect(rpcCalls).toBe(1);
    });
});
