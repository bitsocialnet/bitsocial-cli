// The daemon passes the cli's logger root to pkc-js, so pkc-js's lines follow the DEBUG the daemon enables and reach the
// log file and the getLogs buffer whatever order modules load in (issue #292). This checkout has no oclif.manifest.json,
// so oclif loads every command module and pkc-js is imported before the daemon enables anything: the order that left
// pkc-js silent before the fix.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import dns from "node:dns";
import PKC from "@pkcprotocol/pkc-js";
import { type ManagedChildProcess, stopPkcDaemon, startPkcDaemonWithDynamicPorts, waitForCondition } from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first");

type Entry = { seq?: number; time: number; level: string; namespace: string; msg: string; tags: Record<string, string> };

const readEntries = async (logDir: string): Promise<Entry[]> => {
    const names = (await fsPromise.readdir(logDir)).filter((name) => name.endsWith(".jsonl")).sort();
    const entries: Entry[] = [];
    for (const name of names)
        for (const line of (await fsPromise.readFile(path.join(logDir, name), "utf-8")).split("\n")) if (line) entries.push(JSON.parse(line));
    return entries;
};

// Loaded into the daemon process: once the daemon has installed its stdout/stderr capture, writes to both the way a
// library would, outside any logger
const WRITE_MARKERS = `const originalStderrWrite = process.stderr.write; let i = 0;
const timer = setInterval(() => {
    if (process.stderr.write === originalStderrWrite) return;
    console.log("STDOUT_CAPTURE_MARKER 100%s done");
    console.error("STDERR_CAPTURE_MARKER");
    if (++i >= 40) clearInterval(timer);
}, 250); timer.unref();`;

const startDaemon = async (env: Record<string, string>) => {
    const logDir = randomDirectory();
    const daemon = await startPkcDaemonWithDynamicPorts(
        (e) => ["--logPath", logDir, "--pkcRpcUrl", e.rpcWsUrl],
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
