// The daemon passes the cli's logger root to pkc-js, so pkc-js's lines follow the DEBUG the daemon enables and reach the
// log file and the getLogs buffer whatever order modules load in (issue #292). This checkout has no oclif.manifest.json,
// so oclif loads every command module and pkc-js is imported before the daemon enables anything: the order that left
// pkc-js silent before the fix.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import path from "path";
import dns from "node:dns";
import { createRequire } from "node:module";
import PKC from "@pkcprotocol/pkc-js";
import {
    type ManagedChildProcess,
    readDaemonLogEntries,
    stopPkcDaemon,
    startPkcDaemonWithDynamicPorts,
    waitForCondition
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first");

const readEntries = readDaemonLogEntries;

// Loaded into the daemon process: once the daemon has installed its stdout/stderr capture, writes to both the way a
// library would, outside any logger
const WRITE_MARKERS = `const originalStderrWrite = process.stderr.write; let i = 0;
const originalStdoutWrite = process.stdout.write;
process.stdout.write = function (chunk, ...rest) {
    if (String(chunk).includes("Communities in data path")) setTimeout(() => console.log("LATE_STDOUT_MARKER"), 1000).unref();
    return originalStdoutWrite.call(this, chunk, ...rest);
};
const timer = setInterval(() => {
    if (process.stderr.write === originalStderrWrite) return;
    console.log("STDOUT_CAPTURE_MARKER 100%s done");
    console.error("STDERR_CAPTURE_MARKER");
    if (++i >= 40) clearInterval(timer);
}, 250); timer.unref();`;

const startDaemon = async (env: Record<string, string>, extraArgs: string[] = []) => {
    const logDir = randomDirectory();
    const daemon = await startPkcDaemonWithDynamicPorts(
        (e) => ["--logPath", logDir, "--pkcRpcUrl", e.rpcWsUrl, ...extraArgs],
        () => env
    );
    return { logDir, daemon };
};

const createCommunity = async (rpcWsUrl: string) => {
    const pkc = await PKC({ pkcRpcClientsOptions: [rpcWsUrl] });
    const community = await pkc.createCommunity();
    return { pkc, community, publicKey: community.publicKey as string };
};

describe("daemon logs pkc-js through the cli's logger root (default namespaces)", () => {
    let daemonProcess: ManagedChildProcess;
    let logDir: string;
    let rpcWsUrl: string;
    let pkc: Awaited<ReturnType<typeof PKC>>;
    let publicKey: string;

    beforeAll(async () => {
        const started = await startDaemon({
            DEBUG: "",
            _PKC_DEBUG: "",
            NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(WRITE_MARKERS)}`
        });
        logDir = started.logDir;
        daemonProcess = started.daemon.daemonProcess;
        rpcWsUrl = started.daemon.rpcWsUrl;
        ({ pkc, publicKey } = await createCommunity(rpcWsUrl));
    });

    afterAll(async () => {
        await pkc?.destroy().catch(() => {});
        await stopPkcDaemon(daemonProcess);
    });

    it("writes pkc-js entries tagged with the community's publicKey to the log file", async () => {
        expect(publicKey).toBeTruthy();
        await waitForCondition(
            async () => (await readEntries(logDir)).some((entry) => entry.namespace.startsWith("pkc-js") && entry.tags.publicKey === publicKey),
            20000,
            500
        );
        const entries = await readEntries(logDir);
        expect(entries.some((entry) => entry.namespace.startsWith("pkc-js") && entry.tags.publicKey === publicKey)).toBe(true);
        // The default selection leaves pkc-js trace out
        expect(entries.some((entry) => entry.namespace.startsWith("pkc") && entry.level === "trace")).toBe(false);
    });

    it("answers getLogs over RPC with entries tagged with that publicKey", async () => {
        const result = await pkc.getLogs({ tags: { publicKey }, rpcUrl: rpcWsUrl });
        expect(result.entries.length).toBeGreaterThan(0);
        expect(result.entries.every((entry) => entry.tags.publicKey === publicKey)).toBe(true);
    });

    it("logs what reaches stdout outside a logger as bitsocial-cli:stdout, and still prints it", async () => {
        await waitForCondition(async () => (await readEntries(logDir)).some((entry) => entry.msg.includes("STDOUT_CAPTURE_MARKER")), 20000, 500);
        const entry = (await readEntries(logDir)).find((e) => e.msg.includes("STDOUT_CAPTURE_MARKER"))!;
        expect(entry).toMatchObject({ namespace: "bitsocial-cli:stdout", level: "log", tags: {} });
        // "%s" in the text is not a placeholder
        expect(entry.msg).toBe("STDOUT_CAPTURE_MARKER 100%s done");
        expect(daemonProcess.capturedStdout).toContain("STDOUT_CAPTURE_MARKER");
    });

    // The helper stopped reading stdout once the daemon was ready, so anything printed after that was missing from
    // capturedStdout even though the daemon printed it
    it("captures what the daemon prints to stdout after it is ready", async () => {
        await waitForCondition(async () => (await readEntries(logDir)).some((entry) => entry.msg === "LATE_STDOUT_MARKER"), 20000, 250);
        await waitForCondition(async () => Boolean(daemonProcess.capturedStdout?.includes("LATE_STDOUT_MARKER")), 5000, 100);
        expect(daemonProcess.capturedStdout).toContain("LATE_STDOUT_MARKER");
    });

    it("logs what reaches stderr outside a logger as a bitsocial-cli:stderr error, and keeps it off the terminal", async () => {
        await waitForCondition(async () => (await readEntries(logDir)).some((entry) => entry.msg.includes("STDERR_CAPTURE_MARKER")), 20000, 500);
        const entry = (await readEntries(logDir)).find((e) => e.msg.includes("STDERR_CAPTURE_MARKER"))!;
        expect(entry).toMatchObject({ namespace: "bitsocial-cli:stderr", level: "error", msg: "STDERR_CAPTURE_MARKER" });
        expect(daemonProcess.capturedStderr).not.toContain("STDERR_CAPTURE_MARKER");
        expect(daemonProcess.capturedStdout).not.toContain("STDERR_CAPTURE_MARKER");
    });

    it("writes the daemon's own lines and pkc-js's lines with seq numbers of one root", async () => {
        const entries = (await readEntries(logDir)).filter((entry) => entry.seq !== undefined);
        const seqs = entries.map((entry) => entry.seq!);
        expect(new Set(seqs).size).toBe(seqs.length);
        expect(entries.some((entry) => entry.namespace.startsWith("bitsocial-cli:daemon"))).toBe(true);
        expect(entries.some((entry) => entry.namespace.startsWith("pkc-js"))).toBe(true);
    });
});

describe("daemon with pkc-js namespaces left out of DEBUG", () => {
    let daemonProcess: ManagedChildProcess;
    let logDir: string;
    let pkc: Awaited<ReturnType<typeof PKC>> | undefined;

    beforeAll(async () => {
        const started = await startDaemon({ DEBUG: "bitsocial*", _PKC_DEBUG: "" });
        logDir = started.logDir;
        daemonProcess = started.daemon.daemonProcess;
        ({ pkc } = await createCommunity(started.daemon.rpcWsUrl));
    });

    afterAll(async () => {
        await pkc?.destroy().catch(() => {});
        await stopPkcDaemon(daemonProcess);
    });

    it("writes no pkc-js entry, while bitsocial-cli entries and the stdout capture still are", async () => {
        // Give pkc-js time to log the community's creation, had it been enabled
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const entries = await readEntries(logDir);
        expect(entries.some((entry) => entry.namespace.startsWith("bitsocial-cli:daemon"))).toBe(true);
        expect(entries.some((entry) => entry.namespace === "bitsocial-cli:stdout")).toBe(true);
        expect(entries.filter((entry) => entry.namespace.startsWith("pkc-js"))).toEqual([]);
    });
});

// With "-bitsocial*" in DEBUG, debug's exclusion wins over the bitsocial-cli:stderr namespace the daemon appends, so
// the stderr capture logs nothing. It must not swallow the write: it goes to the terminal instead.
describe("daemon with bitsocial* excluded from DEBUG", () => {
    let daemonProcess: ManagedChildProcess;
    let logDir: string;

    beforeAll(async () => {
        const started = await startDaemon({
            DEBUG: "pkc*,-pkc*trace,-bitsocial*",
            _PKC_DEBUG: "",
            NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(WRITE_MARKERS)}`
        });
        logDir = started.logDir;
        daemonProcess = started.daemon.daemonProcess;
    });

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
    });

    it("still delivers what reaches stderr outside a logger, to the file or the terminal", async () => {
        const delivered = async () =>
            Boolean(daemonProcess.capturedStderr?.includes("STDERR_CAPTURE_MARKER")) ||
            (await readEntries(logDir)).some((entry) => entry.msg.includes("STDERR_CAPTURE_MARKER"));
        await waitForCondition(delivered, 15000, 250);
        expect(await delivered()).toBe(true);
    });
});

// Other libraries in the daemon (oclif, acme-client, ...) log through the same hoisted `debug` copy as pkc-logger
const debugModulePath = createRequire(path.resolve("node_modules/@pkcprotocol/pkc-logger/package.json")).resolve("debug");
const WRITE_THIRD_PARTY_DEBUG = `import { createRequire } from "node:module";
const debug = createRequire(${JSON.stringify(debugModulePath)})(${JSON.stringify(debugModulePath)});
const originalStderrWrite = process.stderr.write; let i = 0;
const timer = setInterval(() => {
    if (process.stderr.write === originalStderrWrite) return;
    debug("thirdparty:test")("THIRDPARTY_DEBUG_MARKER");
    if (++i >= 40) clearInterval(timer);
}, 250); timer.unref();`;

const SECRET_PROVIDER_KEY = "SECRETPROVIDERKEY0123456789";

describe("daemon with a third-party debug namespace and a chain provider URL carrying a key", () => {
    let daemonProcess: ManagedChildProcess;
    let logDir: string;
    let rpcWsUrl: string;
    let pkc: Awaited<ReturnType<typeof PKC>> | undefined;

    beforeAll(async () => {
        const started = await startDaemon(
            {
                DEBUG: "bitsocial*,pkc*,-pkc*trace,thirdparty*",
                _PKC_DEBUG: "",
                NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(WRITE_THIRD_PARTY_DEBUG)}`
            },
            ["--chainProviderUrls", `https://rpc.example.invalid/v3/${SECRET_PROVIDER_KEY}`]
        );
        logDir = started.logDir;
        daemonProcess = started.daemon.daemonProcess;
        rpcWsUrl = started.daemon.rpcWsUrl;
        ({ pkc } = await createCommunity(rpcWsUrl));
    });

    afterAll(async () => {
        await pkc?.destroy().catch(() => {});
        await stopPkcDaemon(daemonProcess);
    });

    it("writes another library's enabled debug output to the log file", async () => {
        await waitForCondition(async () => (await readEntries(logDir)).some((entry) => entry.msg.includes("THIRDPARTY_DEBUG_MARKER")), 15000, 250);
        expect((await readEntries(logDir)).some((entry) => entry.msg.includes("THIRDPARTY_DEBUG_MARKER"))).toBe(true);
    });

    // getLogs serves the buffer to any RPC client with the auth key, and a provider URL can carry an API key
    it("keeps the chain provider URL's key out of the log file and getLogs", async () => {
        const fileEntries = await readEntries(logDir);
        expect(fileEntries.length).toBeGreaterThan(0);
        expect(fileEntries.filter((entry) => JSON.stringify(entry).includes(SECRET_PROVIDER_KEY))).toEqual([]);
        const result = await pkc!.getLogs({ limit: 10000, rpcUrl: rpcWsUrl });
        expect(result.entries.length).toBeGreaterThan(0);
        expect(result.entries.filter((entry) => JSON.stringify(entry).includes(SECRET_PROVIDER_KEY))).toEqual([]);
    });
});

// pkc-js 0.0.165 rejects pkcOptions.logger with both instance and buffer
describe("daemon with --pkcOptions.logger.buffer.maxBytes", () => {
    let daemonProcess: ManagedChildProcess | undefined;
    let startError: unknown;

    beforeAll(async () => {
        try {
            daemonProcess = (await startDaemon({ DEBUG: "", _PKC_DEBUG: "" }, ["--pkcOptions.logger.buffer.maxBytes", "100000"])).daemon
                .daemonProcess;
        } catch (error) {
            startError = error;
        }
    });

    afterAll(async () => {
        if (daemonProcess) await stopPkcDaemon(daemonProcess);
    });

    it("starts", () => {
        expect(startError).toBeUndefined();
        expect(daemonProcess).toBeDefined();
    });
});
