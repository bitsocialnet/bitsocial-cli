import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { _gatherChildOutput } from "../../dist/ipfs/startIpfs.js";

const noopLog = Object.assign(() => {}, { trace: () => {}, error: () => {} });

const makeFakeChild = () =>
    Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: new EventEmitter(),
        pid: 12345
    }) as any;

describe("_gatherChildOutput", () => {
    it("captures stderr even when the child's 'exit' event fires before stderr 'data' (macOS race)", async () => {
        const child = makeFakeChild();
        const promise = _gatherChildOutput(noopLog, child);

        // Simulate the macOS-style ordering: process exits first, stderr drains
        // afterwards, 'close' fires last. The previous 'exit'-based listener would
        // settle the promise with an empty errorMessage at the first emit and miss
        // the stderr payload entirely.
        queueMicrotask(() => {
            child.emit("exit", 1, null);
            setImmediate(() => {
                child.stderr.emit("data", Buffer.from("Error: ipfs configuration file already exists!\n"));
                child.emit("close", 1, null);
            });
        });

        await expect(promise).rejects.toThrow(/ipfs configuration file already exists!/);
    });

    it("resolves cleanly when the child exits with code 0", async () => {
        const child = makeFakeChild();
        const promise = _gatherChildOutput(noopLog, child);
        queueMicrotask(() => child.emit("close", 0, null));
        await expect(promise).resolves.toBeNull();
    });
});
