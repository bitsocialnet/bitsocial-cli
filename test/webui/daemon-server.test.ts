import { describe, it, expect } from "vitest";
import net from "net";
import { directory as randomDirectory } from "tempy";
import { startDaemonServer } from "../../dist/webui/daemon-server.js";

// Regression test for issue #42:
// startDaemonServer used to call webuiExpressApp.listen(port) fire-and-forget — no
// await on 'listening', no 'error' handler. If bind failed, the promise still resolved
// and the bind error showed up later as an uncaughtException, crashing the daemon
// AFTER the test helper had already accepted "Communities in data path" as readiness.
// The contract we want: if the port can't be bound, startDaemonServer must reject.
describe("startDaemonServer bind contract", () => {
    it("rejects when the RPC port is already taken (regression for issue #42)", async () => {
        // Blocker must bind to 0.0.0.0 because express.listen(port) (no host arg) also
        // binds to 0.0.0.0. On BSD-derived stacks (macOS, Windows) a wildcard bind and
        // a 127.0.0.1 bind on the same port can coexist, so binding the blocker to
        // 127.0.0.1 would let the daemon's wildcard bind succeed and the test wouldn't
        // exercise the EADDRINUSE path.
        const blocker = net.createServer();
        const port = await new Promise<number>((resolve, reject) => {
            blocker.once("listening", () => {
                const addr = blocker.address();
                if (addr && typeof addr === "object") resolve(addr.port);
                else reject(new Error(`unexpected address ${JSON.stringify(addr)}`));
            });
            blocker.once("error", reject);
            blocker.listen(0, "0.0.0.0");
        });

        // Swallow any stray uncaughtException emitted by an unguarded server.listen()
        // so the test process survives long enough to assert the actual behavior.
        const stray: Error[] = [];
        const uncaughtHandler = (err: Error) => stray.push(err);
        process.on("uncaughtException", uncaughtHandler);

        try {
            await expect(
                startDaemonServer(
                    new URL(`ws://127.0.0.1:${port}`),
                    new URL("http://127.0.0.1:6754"),
                    { dataPath: randomDirectory() }
                )
            ).rejects.toThrow(/EADDRINUSE|address already in use/i);
            // And no stray uncaughtException either — the bind error must come back
            // through the promise, not the process.
            expect(stray).toEqual([]);
        } finally {
            process.off("uncaughtException", uncaughtHandler);
            await new Promise<void>((resolve) => blocker.close(() => resolve()));
        }
    });
});
