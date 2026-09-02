// Regression test for issue #143: a fresh daemon start must not go through a kubo
// shutdown/restart cycle.
//
// pkc-js (>= 0.0.46) rewrites the connected kubo node's Routing config during its init and, when
// the router endpoint set changed — previously always true on a fresh repo — POSTs /shutdown to
// kubo, expecting the daemon's keepKuboUp to restart it. That restart opens a multi-second window
// where kubo's API refuses connections, and early CLI commands (e.g. `community create`) can burn
// their whole budget inside it (observed on windows-latest CI, run 33471620931).
//
// The daemon now pre-seeds the equivalent Routing config into the kubo config file before
// spawning kubo, so pkc-js's endpoint comparison is a no-op and no shutdown is issued. This test
// also guards against pkc-js upgrades changing the Routing mapping (which would silently bring
// the restart back): the pre-seed must keep matching what pkc-js computes.
//
// pkc-js's own router-setup log lines don't reach the daemon log (its bundled logger doesn't pick
// up the daemon's debug config), so the assertions anchor on the daemon's own logging instead:
// "Kubo node with pid (...) exited. Will attempt to restart it" and the count of
// "Started kubo ipfs process with pid" lines, both logged by the default `bitsocial*` namespace.
import { spawn } from "child_process";
import { describe, it, expect, afterAll } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import dns from "node:dns";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    startPkcDaemonWithDynamicPorts,
    waitForCondition,
    ensureKuboNodeStopped
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first"); // to be able to resolve localhost

const runBitsocialCommand = (args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", ...args], { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
        proc.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error(`Command timed out after ${timeoutMs}ms: bitsocial ${args.join(" ")}\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, timeoutMs);
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });

describe("fresh daemon start does not restart kubo (issue #143)", () => {
    let daemonProcess: ManagedChildProcess | undefined;
    let kuboApiUrl: string | undefined;

    afterAll(async () => {
        if (daemonProcess) await stopPkcDaemon(daemonProcess);
        if (kuboApiUrl) await ensureKuboNodeStopped(kuboApiUrl);
    }, 60_000);

    it("pkc-js init finds the pre-seeded Routing config and never shuts kubo down", { timeout: 180_000 }, async () => {
        const logDir = randomDirectory();
        const readDaemonLog = async (): Promise<string> => {
            const files = (await fsPromise.readdir(logDir).catch(() => [] as string[])).filter((f) => f.endsWith(".log"));
            let combined = "";
            for (const file of files) combined += await fsPromise.readFile(path.join(logDir, file), "utf8");
            return combined;
        };

        const daemon = await startPkcDaemonWithDynamicPorts((e) => [
            "--logPath",
            logDir,
            "--pkcOptions.dataPath",
            randomDirectory(),
            "--pkcRpcUrl",
            e.rpcWsUrl
        ]);
        daemonProcess = daemon.daemonProcess;
        kuboApiUrl = daemon.kuboApiUrl;

        // A full `community create` forces pkc-js through its kubo interactions (routing setup,
        // signer key import), so by the time it returns, the shutdown — if pkc-js decided on one —
        // has long been issued and the daemon has logged the restart.
        const createResult = await runBitsocialCommand(
            ["community", "create", "--description", "issue 143 regression", "--pkcRpcUrl", daemon.rpcWsUrl],
            90_000
        );
        expect(createResult.exitCode, `stderr: ${createResult.stderr}\nstdout: ${createResult.stdout}`).toBe(0);

        // Bounded observation window: a restart in flight surfaces in the log within milliseconds
        // of kubo's exit, so 5 quiet seconds after a successful create means no restart happened.
        const restartAppeared = await waitForCondition(
            async () => (await readDaemonLog()).includes("Will attempt to restart it"),
            5_000,
            250
        );
        const logContent = await readDaemonLog();
        expect(restartAppeared, "daemon restarted kubo during a fresh start (pkc-js issued a shutdown)").toBe(false);
        const kuboStarts = logContent.match(/Started kubo ipfs process with pid/g) ?? [];
        expect(kuboStarts, "daemon started kubo more than once during a fresh start").toHaveLength(1);
    });
});
