import fs from "fs/promises";
import { directory as randomDirectory } from "tempy";
import { describe, expect, it } from "vitest";
import { ensureKuboNodeStopped, startPkcDaemonWithDynamicPorts, stopPkcDaemon, waitForCondition, waitForKuboReady } from "./daemon-helpers.js";

// #248: on Windows a kill ends the daemon at once, so it never stops the kubo it started. That kubo kept running after
// the suite and held repo.lock, and the run's temp directory could not be removed.
describe("stopPkcDaemon", () => {
    it("leaves no kubo running, so the daemon's data directory can be removed", { timeout: 120_000 }, async () => {
        const dataPath = randomDirectory();
        const daemon = await startPkcDaemonWithDynamicPorts((endpoints) => ["--pkcOptions.dataPath", dataPath, "--pkcRpcUrl", endpoints.rpcWsUrl]);
        const kuboAnswers = () => fetch(`${daemon.kuboApiUrl}/bitswap/stat`, { method: "POST" }).then((response) => response.ok, () => false);
        try {
            expect(await waitForKuboReady(daemon.kuboApiUrl), "kubo did not start").toBe(true);

            await stopPkcDaemon(daemon.daemonProcess);

            // Long enough for a kubo that was only just starting to come up.
            expect(await waitForCondition(kuboAnswers, 5000, 250), "kubo is still running after the daemon was stopped").toBe(false);
            await expect(fs.rm(dataPath, { recursive: true, force: true })).resolves.toBeUndefined();
        } finally {
            await stopPkcDaemon(daemon.daemonProcess);
            await ensureKuboNodeStopped(daemon.kuboApiUrl);
        }
    });
});
