import { ChildProcess, spawn } from "child_process";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import dns from "node:dns";
import {
    type ManagedChildProcess,
    stopPkcDaemon,
    startPkcDaemonWithDynamicPorts,
    waitForCondition
} from "../helpers/daemon-helpers.js";
dns.setDefaultResultOrder("ipv4first");

// Ports/URLs are allocated dynamically per run and assigned in beforeAll (issue #87).
let rpcWsUrl: string;

const createLogDir = async () => {
    const logDir = randomDirectory();
    await fsPromise.mkdir(logDir, { recursive: true });
    return { logDir };
};

const runBitsocialLogs = (args: string[], logDir: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", "logs", "--logPath", logDir, ...args], {
            stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error("bitsocial logs timed out"));
        }, 30000);
        proc.on("close", (exitCode) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        });
    });
};

// Helper to build synthetic log content with ISO timestamps
const buildLogLine = (date: Date, message: string, stream?: "stdout" | "stderr") =>
    stream ? `[${date.toISOString()}] [${stream}] ${message}` : `[${date.toISOString()}] ${message}`;

// Drive a `bitsocial logs -f ...` process by observing its output. `onChunk` runs on every stdout
// chunk (use it to trigger file writes once a marker appears). The process is SIGINT-killed as soon
// as `doneWhen(stdout, stderr)` returns true — plus an optional `graceMs` afterwards so any late or
// erroneously-unfiltered output can still surface — or after `maxMs` as a safety cap. Anchoring the
// kill to observed output rather than a fixed wall-clock window from spawn keeps these tests robust
// on slow/loaded CI runners, where CLI cold-start alone can consume several seconds and a fixed
// window would kill the process before the awaited line is ever emitted (issue #77).
const runFollowUntil = (
    args: string[],
    logDir: string,
    opts: {
        onChunk?: (stdout: string) => void;
        doneWhen: (stdout: string, stderr: string) => boolean;
        graceMs?: number;
        maxMs?: number;
        env?: NodeJS.ProcessEnv;
    }
): Promise<{ stdout: string; stderr: string; timedOut: boolean }> => {
    const { onChunk, doneWhen, graceMs = 0, maxMs = 25000, env } = opts;
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["./bin/run", "logs", "--logPath", logDir, ...args], {
            stdio: ["pipe", "pipe", "pipe"],
            env: env ? { ...process.env, ...env } : undefined
        });

        let stdout = "";
        let stderr = "";
        let killed = false;
        let finishing = false;
        let timedOut = false;
        const kill = () => {
            if (killed) return;
            killed = true;
            proc.kill("SIGINT");
        };
        const safety = setTimeout(() => {
            timedOut = true;
            kill();
        }, maxMs);
        const maybeFinish = () => {
            if (finishing || killed) return;
            if (doneWhen(stdout, stderr)) {
                finishing = true;
                if (graceMs > 0) setTimeout(kill, graceMs);
                else kill();
            }
        };
        proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
            onChunk?.(stdout);
            maybeFinish();
        });
        proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
            maybeFinish();
        });
        proc.on("close", () => {
            clearTimeout(safety);
            resolve({ stdout, stderr, timedOut });
        });
        proc.on("error", (err) => {
            clearTimeout(safety);
            reject(err);
        });
    });
};

describe("bitsocial logs (synthetic log file tests)", () => {
    let logDir: string;
    let logFile: string;

    beforeAll(async () => {
        ({ logDir } = await createLogDir());
        logFile = path.join(logDir, "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z.log");
    });

    it("--tail N shows exactly last N entries", async () => {
        const lines = [];
        for (let i = 0; i < 10; i++) {
            const ts = new Date("2026-01-01T00:00:00.000Z");
            ts.setMinutes(i);
            lines.push(buildLogLine(ts, `entry ${i}`));
        }
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["-n", "3"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("entry 7");
        expect(result.stdout).toContain("entry 8");
        expect(result.stdout).toContain("entry 9");
        expect(result.stdout).not.toContain("entry 6");
    });

    it("--tail 0 produces empty output", async () => {
        const lines = [];
        for (let i = 0; i < 5; i++) {
            const ts = new Date("2026-01-01T00:00:00.000Z");
            ts.setMinutes(i);
            lines.push(buildLogLine(ts, `entry ${i}`));
        }
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["-n", "0"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("");
    });

    it("--since with absolute timestamp filters correctly", async () => {
        const lines = [
            buildLogLine(new Date("2026-01-01T00:00:00.000Z"), "old entry"),
            buildLogLine(new Date("2026-01-01T01:00:00.000Z"), "mid entry"),
            buildLogLine(new Date("2026-01-01T02:00:00.000Z"), "new entry")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--since", "2026-01-01T00:30:00.000Z"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("old entry");
        expect(result.stdout).toContain("mid entry");
        expect(result.stdout).toContain("new entry");
    });

    it("--until filters correctly", async () => {
        const lines = [
            buildLogLine(new Date("2026-01-01T00:00:00.000Z"), "old entry"),
            buildLogLine(new Date("2026-01-01T01:00:00.000Z"), "mid entry"),
            buildLogLine(new Date("2026-01-01T02:00:00.000Z"), "new entry")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--until", "2026-01-01T01:30:00.000Z"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("old entry");
        expect(result.stdout).toContain("mid entry");
        expect(result.stdout).not.toContain("new entry");
    });

    it("--since + --tail applies since first then tail", async () => {
        const lines = [
            buildLogLine(new Date("2026-01-01T00:00:00.000Z"), "before cutoff"),
            buildLogLine(new Date("2026-01-01T01:00:00.000Z"), "after cutoff 1"),
            buildLogLine(new Date("2026-01-01T02:00:00.000Z"), "after cutoff 2"),
            buildLogLine(new Date("2026-01-01T03:00:00.000Z"), "after cutoff 3")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--since", "2026-01-01T00:30:00.000Z", "-n", "2"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("before cutoff");
        expect(result.stdout).not.toContain("after cutoff 1");
        expect(result.stdout).toContain("after cutoff 2");
        expect(result.stdout).toContain("after cutoff 3");
    });

    it("--since with relative time filters correctly", async () => {
        const now = new Date();
        const oldDate = new Date(now.getTime() - 3600000); // 1 hour ago
        const recentDate = new Date(now.getTime() - 60000); // 1 minute ago

        const lines = [buildLogLine(oldDate, "old entry"), buildLogLine(recentDate, "recent entry")];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--since", "5m"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("old entry");
        expect(result.stdout).toContain("recent entry");
    });

    it("multi-line entries are kept together", async () => {
        const content = [
            `[2026-01-01T00:00:00.000Z] bitsocial-cli:daemon flags:  {`,
            `  pkcRpcUrl: URL { }`,
            `} +0ms`,
            `[2026-01-01T01:00:00.000Z] second entry`
        ].join("\n");
        await fsPromise.writeFile(logFile, content + "\n");

        const result = await runBitsocialLogs(["-n", "1"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("second entry");
        expect(result.stdout).not.toContain("flags");
    });

    it("multi-line entries include continuation lines", async () => {
        const content = [
            `[2026-01-01T00:00:00.000Z] bitsocial-cli:daemon flags:  {`,
            `  pkcRpcUrl: URL { }`,
            `} +0ms`,
            `[2026-01-01T01:00:00.000Z] second entry`
        ].join("\n");
        await fsPromise.writeFile(logFile, content + "\n");

        const result = await runBitsocialLogs(["-n", "2"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("flags");
        expect(result.stdout).toContain("pkcRpcUrl");
        expect(result.stdout).toContain("} +0ms");
        expect(result.stdout).toContain("second entry");
    });

    it("invalid --tail value produces error", async () => {
        const lines = [buildLogLine(new Date("2026-01-01T00:00:00.000Z"), "entry")];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["-n", "abc"], logDir);
        expect(result.exitCode).not.toBe(0);
    });

    it("invalid --since value produces error", async () => {
        const lines = [buildLogLine(new Date("2026-01-01T00:00:00.000Z"), "entry")];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--since", "not-a-date"], logDir);
        expect(result.exitCode).not.toBe(0);
    });

    it("bitsocial logs errors when no log files exist", async () => {
        const { logDir: emptyLogDir } = await createLogDir();
        const result = await runBitsocialLogs([], emptyLogDir);
        expect(result.exitCode).not.toBe(0);
    });
});

describe("bitsocial logs --stdout/--stderr filtering (synthetic)", () => {
    let logDir: string;
    let logFile: string;

    beforeAll(async () => {
        ({ logDir } = await createLogDir());
        logFile = path.join(logDir, "bitsocial_cli_daemon_2026-02-01T00-00-00.000Z.log");
    });

    it("--stdout filters to only stdout entries", async () => {
        const ts1 = new Date("2026-02-01T00:00:00.000Z");
        const ts2 = new Date("2026-02-01T00:01:00.000Z");
        const ts3 = new Date("2026-02-01T00:02:00.000Z");
        const lines = [
            buildLogLine(ts1, "stdout message", "stdout"),
            buildLogLine(ts2, "stderr message", "stderr"),
            buildLogLine(ts3, "another stdout", "stdout")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--stdout"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("stdout message");
        expect(result.stdout).toContain("another stdout");
        expect(result.stdout).not.toContain("stderr message");
    });

    it("--stderr filters to only stderr entries", async () => {
        const ts1 = new Date("2026-02-01T00:00:00.000Z");
        const ts2 = new Date("2026-02-01T00:01:00.000Z");
        const lines = [
            buildLogLine(ts1, "stdout message", "stdout"),
            buildLogLine(ts2, "stderr message", "stderr")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--stderr"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("stderr message");
        expect(result.stdout).not.toContain("stdout message");
    });

    it("--stdout excludes untagged (legacy) entries", async () => {
        const ts1 = new Date("2026-02-01T00:00:00.000Z");
        const ts2 = new Date("2026-02-01T00:01:00.000Z");
        const lines = [
            buildLogLine(ts1, "legacy entry"),
            buildLogLine(ts2, "stdout entry", "stdout")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--stdout"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("stdout entry");
        expect(result.stdout).not.toContain("legacy entry");
    });

    it("--stdout and --stderr are mutually exclusive", async () => {
        const lines = [buildLogLine(new Date("2026-02-01T00:00:00.000Z"), "entry", "stdout")];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--stdout", "--stderr"], logDir);
        expect(result.exitCode).not.toBe(0);
    });

    it("no stream flag shows all entries including tagged and untagged", async () => {
        const ts1 = new Date("2026-02-01T00:00:00.000Z");
        const ts2 = new Date("2026-02-01T00:01:00.000Z");
        const ts3 = new Date("2026-02-01T00:02:00.000Z");
        const lines = [
            buildLogLine(ts1, "legacy entry"),
            buildLogLine(ts2, "stdout entry", "stdout"),
            buildLogLine(ts3, "stderr entry", "stderr")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs([], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("legacy entry");
        expect(result.stdout).toContain("stdout entry");
        expect(result.stdout).toContain("stderr entry");
    });

    it("--stdout composes with --since and --tail", async () => {
        const ts1 = new Date("2026-02-01T00:00:00.000Z");
        const ts2 = new Date("2026-02-01T01:00:00.000Z");
        const ts3 = new Date("2026-02-01T02:00:00.000Z");
        const ts4 = new Date("2026-02-01T03:00:00.000Z");
        const lines = [
            buildLogLine(ts1, "old stdout", "stdout"),
            buildLogLine(ts2, "stderr after cutoff", "stderr"),
            buildLogLine(ts3, "stdout after cutoff 1", "stdout"),
            buildLogLine(ts4, "stdout after cutoff 2", "stdout")
        ];
        await fsPromise.writeFile(logFile, lines.join("\n") + "\n");

        const result = await runBitsocialLogs(["--stdout", "--since", "2026-02-01T00:30:00.000Z", "-n", "1"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("old stdout");
        expect(result.stdout).not.toContain("stderr after cutoff");
        expect(result.stdout).not.toContain("stdout after cutoff 1");
        expect(result.stdout).toContain("stdout after cutoff 2");
    });

    it("multi-line entries preserve stream tag filtering", async () => {
        const content = [
            `[2026-02-01T00:00:00.000Z] [stderr] bitsocial-cli:daemon flags:  {`,
            `  pkcRpcUrl: URL { }`,
            `} +0ms`,
            `[2026-02-01T00:01:00.000Z] [stdout] community created successfully`
        ].join("\n");
        await fsPromise.writeFile(logFile, content + "\n");

        const result = await runBitsocialLogs(["--stdout"], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("community created successfully");
        expect(result.stdout).not.toContain("flags");
        expect(result.stdout).not.toContain("pkcRpcUrl");
    });
});

describe("bitsocial logs -f log file rotation (synthetic)", () => {
    it("switches to new log file when one appears", async () => {
        const { logDir } = await createLogDir();
        const file1 = path.join(logDir, "bitsocial_cli_daemon_2026-03-01T00-00-00.000Z.log");
        await fsPromise.writeFile(file1, buildLogLine(new Date("2026-03-01T00:00:00.000Z"), "INITIAL_MARKER") + "\n");

        let createdNewFile = false;
        const result = await runFollowUntil(["-f"], logDir, {
            // Wait for initial output before creating the new file
            onChunk: (stdout) => {
                if (!createdNewFile && stdout.includes("INITIAL_MARKER")) {
                    createdNewFile = true;
                    const file2 = path.join(logDir, "bitsocial_cli_daemon_2026-03-01T01-00-00.000Z.log");
                    fsPromise.writeFile(file2, buildLogLine(new Date("2026-03-01T01:00:00.000Z"), "NEW_FILE_MARKER") + "\n");
                }
            },
            doneWhen: (stdout, stderr) => stdout.includes("NEW_FILE_MARKER") && stderr.includes("switched to new log file")
        });

        expect(result.stdout).toContain("INITIAL_MARKER");
        expect(result.stdout).toContain("NEW_FILE_MARKER");
        expect(result.stderr).toContain("switched to new log file");
    });

    it("applies --stdout filter after switching to new log file", async () => {
        const { logDir } = await createLogDir();
        const file1 = path.join(logDir, "bitsocial_cli_daemon_2026-04-01T00-00-00.000Z.log");
        await fsPromise.writeFile(file1, buildLogLine(new Date("2026-04-01T00:00:00.000Z"), "initial stdout", "stdout") + "\n");

        let createdNewFile = false;
        const result = await runFollowUntil(["--stdout", "-f"], logDir, {
            onChunk: (stdout) => {
                if (!createdNewFile && stdout.includes("initial stdout")) {
                    createdNewFile = true;
                    const file2 = path.join(logDir, "bitsocial_cli_daemon_2026-04-01T01-00-00.000Z.log");
                    const content = [
                        buildLogLine(new Date("2026-04-01T01:00:00.000Z"), "new stdout msg", "stdout"),
                        buildLogLine(new Date("2026-04-01T01:01:00.000Z"), "new stderr msg", "stderr")
                    ].join("\n") + "\n";
                    fsPromise.writeFile(file2, content);
                }
            },
            doneWhen: (stdout) => stdout.includes("new stdout msg"),
            // Both lines are written together; grace period lets an erroneously-unfiltered
            // stderr line surface before we kill, so the negative assertion stays meaningful.
            graceMs: 1000
        });

        expect(result.stdout).toContain("initial stdout");
        expect(result.stdout).toContain("new stdout msg");
        expect(result.stdout).not.toContain("new stderr msg");
    });

    it("continues watching old file if no new file appears", async () => {
        const { logDir } = await createLogDir();
        const file1 = path.join(logDir, "bitsocial_cli_daemon_2026-05-01T00-00-00.000Z.log");
        await fsPromise.writeFile(file1, buildLogLine(new Date("2026-05-01T00:00:00.000Z"), "initial line") + "\n");

        let appended = false;
        let appendError: unknown;
        const result = await runFollowUntil(["-f"], logDir, {
            // Only append after initial line has been observed, so CLI startup time doesn't matter
            onChunk: (stdout) => {
                if (!appended && stdout.includes("initial line")) {
                    appended = true;
                    fsPromise
                        .appendFile(file1, buildLogLine(new Date("2026-05-01T00:01:00.000Z"), "APPENDED_LINE") + "\n")
                        .catch((err) => {
                            appendError = err;
                        });
                }
            },
            doneWhen: (stdout) => stdout.includes("APPENDED_LINE")
        });

        if (!result.stdout.includes("APPENDED_LINE")) {
            // Diagnostics for the flaky-on-CI failure (issue #77): the test waited the full safety cap
            // without ever seeing APPENDED_LINE. Distinguish the three possible causes so the next CI
            // run is conclusive instead of a guess:
            //   - append never reached disk  -> appendTriggered/appendError + on-disk content show it
            //   - logs -f never detected it  -> on-disk has APPENDED_LINE but captured stdout does not
            //   - output truncated on exit   -> timedOut true and the line is on disk but not captured
            const onDisk = await fsPromise.readFile(file1, "utf-8").catch((err) => `<read failed: ${err}>`);
            console.log(`[follow-append diagnostics] timedOut=${result.timedOut} appendTriggered=${appended} appendError=${String(appendError)}`);
            console.log(`[follow-append diagnostics] file1 on disk (${file1}):\n${onDisk}`);
            console.log(`[follow-append diagnostics] captured stdout (${result.stdout.length} bytes):\n${JSON.stringify(result.stdout)}`);
            console.log(`[follow-append diagnostics] captured stderr:\n${JSON.stringify(result.stderr)}`);
        }

        expect(result.stdout).toContain("initial line");
        expect(result.stdout).toContain("APPENDED_LINE");
    });

    // Switching to a new file used to set the file, read it, print it and only then take the offset from a stat(), while
    // the 300ms poll kept reading the new file at the old file's offset. Lines appended between the read and the stat
    // were skipped, and a poll inside that window printed part of the new file twice. Delaying stat() of the log files
    // widens that window the way a loaded machine does.
    it("prints every line of the new log file exactly once, including those written during the switch", async () => {
        const { logDir } = await createLogDir();
        const file1 = path.join(logDir, "bitsocial_cli_daemon_2026-05-02T00-00-00.000Z.log");
        const file2 = path.join(logDir, "bitsocial_cli_daemon_2026-05-02T01-00-00.000Z.log");
        await fsPromise.writeFile(file1, buildLogLine(new Date("2026-05-02T00:00:00.000Z"), "OLD_FILE_MARKER") + "\n");
        const slowLogStat = `import fs from "node:fs/promises"; const real = fs.stat; fs.stat = async (target, ...rest) => { if (String(target).includes("bitsocial_cli_daemon_")) await new Promise((resolve) => setTimeout(resolve, 1500)); return real(target, ...rest); };`;

        const firstLines = Array.from({ length: 50 }, (_, i) => buildLogLine(new Date(Date.UTC(2026, 4, 2, 1, 0, i)), `FIRST_LINE_${i}_`));
        const APPENDED = 250;
        let started = false;
        const result = await runFollowUntil(["-f"], logDir, {
            env: { NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(slowLogStat)}` },
            onChunk: (stdout) => {
                if (started || !stdout.includes("OLD_FILE_MARKER")) return;
                started = true;
                void (async () => {
                    await fsPromise.writeFile(file2, firstLines.join("\n") + "\n");
                    // Keep writing for longer than the 3s new-file check plus the delayed stat, so lines land mid-switch
                    for (let i = 0; i < APPENDED; i++) {
                        await fsPromise.appendFile(file2, buildLogLine(new Date(Date.UTC(2026, 4, 2, 2, 0, 0, i)), `SWITCH_LINE_${i}_`) + "\n");
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    await fsPromise.appendFile(file2, buildLogLine(new Date("2026-05-02T03:00:00.000Z"), "LAST_LINE") + "\n");
                })();
            },
            doneWhen: (stdout) => stdout.includes("LAST_LINE"),
            graceMs: 1000,
            maxMs: 30000
        });

        const count = (needle: string) => result.stdout.split(needle).length - 1;
        expect(result.stderr).toContain("switched to new log file");
        expect(result.stdout).toContain("LAST_LINE");
        const wrongCounts: string[] = [];
        for (let i = 0; i < firstLines.length; i++) if (count(`FIRST_LINE_${i}_`) !== 1) wrongCounts.push(`FIRST_LINE_${i}_ x${count(`FIRST_LINE_${i}_`)}`);
        for (let i = 0; i < APPENDED; i++) if (count(`SWITCH_LINE_${i}_`) !== 1) wrongCounts.push(`SWITCH_LINE_${i}_ x${count(`SWITCH_LINE_${i}_`)}`);
        expect(wrongCounts).toEqual([]);
    });
});

// The daemon trims its log in place (daemon-file-logger.ts: once it has written 20MB it rewrites the same file to the
// last 15MB), so the file the follower reads can end before the offset it reached. `logs -f` used to read nothing from
// then on and went silent while the daemon kept logging.
describe("bitsocial logs -f after an old text log file shrinks in place (synthetic)", () => {
    const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

    it("follows a log file that was emptied from its start", async () => {
        const { logDir } = await createLogDir();
        const file = path.join(logDir, "bitsocial_cli_daemon_2026-06-02T00-00-00.000Z.log");
        await fsPromise.writeFile(file, buildLogLine(new Date("2026-06-02T00:00:00.000Z"), `BEFORE_EMPTY_MARKER ${"x".repeat(200)}`) + "\n");

        let emptied = false;
        const result = await runFollowUntil(["-f"], logDir, {
            onChunk: (stdout) => {
                if (emptied || !stdout.includes("BEFORE_EMPTY_MARKER")) return;
                emptied = true;
                void fsPromise.writeFile(file, buildLogLine(new Date("2026-06-02T00:00:01.000Z"), "AFTER_EMPTY_MARKER") + "\n");
            },
            doneWhen: (stdout) => stdout.includes("AFTER_EMPTY_MARKER"),
            maxMs: 20000
        });

        expect(result.stdout).toContain("AFTER_EMPTY_MARKER");
        expect(countOf(result.stdout, "BEFORE_EMPTY_MARKER")).toBe(1);
        expect(result.stderr).toContain("truncated");
    });
});

describe("bitsocial logs (live daemon tests)", async () => {
    let daemonProcess: ManagedChildProcess;
    let logDir: string;

    beforeAll(async () => {
        ({ logDir } = await createLogDir());
        const daemon = await startPkcDaemonWithDynamicPorts((e) => ["--logPath", logDir, "--pkcRpcUrl", e.rpcWsUrl]);
        daemonProcess = daemon.daemonProcess;
        rpcWsUrl = daemon.rpcWsUrl;
        // Wait for log file to be written
        await waitForCondition(async () => {
            const files = await fsPromise.readdir(logDir);
            return files.some((f) => f.startsWith("bitsocial_cli_daemon_") && f.endsWith(".jsonl"));
        }, 10000, 500);
    });

    afterAll(async () => {
        await stopPkcDaemon(daemonProcess);
    });

    const readNewestJsonl = async () => {
        const files = (await fsPromise.readdir(logDir)).filter((f) => f.startsWith("bitsocial_cli_daemon_") && f.endsWith(".jsonl"));
        expect(files.length).toBeGreaterThan(0);
        return fsPromise.readFile(path.join(logDir, files.sort().pop()!), "utf-8");
    };

    it("daemon writes debug output to log file even when DEBUG is not set", async () => {
        const entries = (await readNewestJsonl()).trimEnd().split("\n").map((line) => JSON.parse(line));
        expect(entries.some((entry) => entry.namespace.startsWith("bitsocial-cli:daemon"))).toBe(true);
    });

    it("log file has one JSON entry per line, with seq, time, level, namespace, msg and tags", async () => {
        const lines = (await readNewestJsonl()).trimEnd().split("\n");
        for (const line of lines) {
            const entry = JSON.parse(line);
            expect(typeof entry.time).toBe("number");
            expect(["log", "error", "trace"]).toContain(entry.level);
            expect(typeof entry.namespace).toBe("string");
            expect(typeof entry.msg).toBe("string");
            expect(typeof entry.tags).toBe("object");
        }
        // What the daemon printed to its terminal is in the file too
        expect(lines.some((line) => JSON.parse(line).namespace === "bitsocial-cli:stdout")).toBe(true);
    });

    it("log file and bitsocial logs output contain no ANSI escape codes; --color adds them", async () => {
        expect(await readNewestJsonl()).not.toMatch(/\u001b\[/);
        const plain = await runBitsocialLogs([], logDir);
        expect(plain.stdout).not.toMatch(/\u001b\[/);
        const colored = await runBitsocialLogs(["--color"], logDir);
        expect(colored.stdout).toMatch(/\u001b\[/);
    });

    it("bitsocial logs dumps log file content and exits", async () => {
        const result = await runBitsocialLogs([], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.length).toBeGreaterThan(0);
        expect(result.stdout).toMatch(/bitsocial|pkc/i);
    });

    it("bitsocial logs --tail N limits output", async () => {
        const resultAll = await runBitsocialLogs([], logDir);
        const resultTail = await runBitsocialLogs(["-n", "2"], logDir);

        expect(resultAll.exitCode).toBe(0);
        expect(resultTail.exitCode).toBe(0);
        // Tail output should be shorter than full output (assuming more than 2 entries)
        expect(resultTail.stdout.length).toBeLessThan(resultAll.stdout.length);
    });

    it("bitsocial logs --since filters recent entries", async () => {
        const result = await runBitsocialLogs(["--since", "5m"], logDir);
        expect(result.exitCode).toBe(0);
        // Should have some recent output since daemon is running
        expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("bitsocial logs -f streams new log data", async () => {
        const result = await new Promise<{ stdout: string }>((resolve, reject) => {
            const proc = spawn("node", ["./bin/run", "logs", "--logPath", logDir, "-f"], {
                stdio: ["pipe", "pipe", "pipe"]
            });

            let stdout = "";
            let killed = false;
            proc.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
                // Kill once we've received data
                if (!killed) {
                    killed = true;
                    proc.kill("SIGINT");
                }
            });

            // Fallback: kill after 10 seconds if no data received
            const timer = setTimeout(() => {
                if (!killed) {
                    killed = true;
                    proc.kill("SIGINT");
                }
            }, 10000);

            proc.on("close", () => {
                clearTimeout(timer);
                resolve({ stdout });
            });
            proc.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });

        // Should have received some log content (at least the existing log file content)
        expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("bitsocial logs --tail N -f shows N initial entries then streams", async () => {
        const result = await new Promise<{ stdout: string }>((resolve, reject) => {
            const proc = spawn("node", ["./bin/run", "logs", "--logPath", logDir, "-n", "3", "-f"], {
                stdio: ["pipe", "pipe", "pipe"]
            });

            let stdout = "";
            let killed = false;
            proc.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
                if (!killed) {
                    killed = true;
                    proc.kill("SIGINT");
                }
            });

            const timer = setTimeout(() => {
                if (!killed) {
                    killed = true;
                    proc.kill("SIGINT");
                }
            }, 10000);

            proc.on("close", () => {
                clearTimeout(timer);
                resolve({ stdout });
            });
            proc.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });

        expect(result.stdout.length).toBeGreaterThan(0);
    });
});

const jsonlEntry = (time: string, namespace: string, msg: string, extra: { level?: string; tags?: Record<string, string>; seq?: number } = {}) =>
    JSON.stringify({ seq: extra.seq ?? 0, time: new Date(time).getTime(), level: extra.level ?? "log", namespace, msg, tags: extra.tags ?? {} });

describe("bitsocial logs on JSONL files (synthetic)", () => {
    const KEY = "12D3KooWAbc";
    const writeRun = async (logDir: string) => {
        const stem = "bitsocial_cli_daemon_2026-07-01T00-00-00.000Z";
        await fsPromise.writeFile(
            path.join(logDir, `${stem}.jsonl`),
            [
                jsonlEntry("2026-07-01T00:00:00.000Z", "bitsocial-cli:stdout", "PART0_STDOUT_MARKER", { seq: 1 }),
                jsonlEntry("2026-07-01T00:00:01.000Z", "pkc-js:local-community", "storeComment: stored", { seq: 2, tags: { publicKey: KEY, cid: "QmCid" } })
            ].join("\n") + "\n"
        );
        await fsPromise.writeFile(
            path.join(logDir, `${stem}.1.jsonl`),
            [
                jsonlEntry("2026-07-01T00:00:02.000Z", "pkc-js:comment", "boom\n    at stack line 1\n    at stack line 2", { seq: 3, level: "error", tags: { publicKey: KEY } }),
                jsonlEntry("2026-07-01T00:00:03.000Z", "bitsocial-cli:daemon", "PART1_LAST_MARKER", { seq: 4 })
            ].join("\n") + "\n"
        );
        // An earlier run, which `bitsocial logs` does not read
        await fsPromise.writeFile(
            path.join(logDir, "bitsocial_cli_daemon_2026-06-30T00-00-00.000Z.jsonl"),
            jsonlEntry("2026-06-30T00:00:00.000Z", "bitsocial-cli:daemon", "EARLIER_RUN_MARKER") + "\n"
        );
    };

    it("prints every file of the newest run in order, as [time] [level] namespace [tags] msg", async () => {
        const { logDir } = await createLogDir();
        await writeRun(logDir);
        const result = await runBitsocialLogs([], logDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("EARLIER_RUN_MARKER");
        const lines = result.stdout.trimEnd().split("\n");
        expect(lines[0]).toBe("[2026-07-01T00:00:00.000Z] [log] bitsocial-cli:stdout PART0_STDOUT_MARKER");
        expect(lines[1]).toBe(`[2026-07-01T00:00:01.000Z] [log] pkc-js:local-community [publicKey=${KEY}, cid=QmCid] storeComment: stored`);
        expect(lines[2]).toBe(`[2026-07-01T00:00:02.000Z] [error] pkc-js:comment [publicKey=${KEY}] boom`);
        expect(lines[3]).toBe("    at stack line 1");
        expect(lines[lines.length - 1]).toContain("PART1_LAST_MARKER");
    });

    // issue #291: a pattern spanning the namespace and the tag block must match piped output
    it("output has no escape sequences, so a namespace-plus-tag pattern matches", async () => {
        const { logDir } = await createLogDir();
        await writeRun(logDir);
        const result = await runBitsocialLogs([], logDir);
        expect(result.stdout).not.toMatch(/\u001b\[/);
        const pattern = new RegExp(`pkc-js:local-community \\[publicKey=${KEY}`);
        expect(result.stdout.split("\n").filter((line) => pattern.test(line))).toHaveLength(1);
        const anchored = /^\[[^\]]+\] \[[a-z]+\] [^ ]+ (\[[^\]]*\] )?storeComment: /;
        expect(result.stdout.split("\n").filter((line) => anchored.test(line))).toHaveLength(1);
    });

    it("--color colors namespaces; --color and --json are mutually exclusive", async () => {
        const { logDir } = await createLogDir();
        await writeRun(logDir);
        const colored = await runBitsocialLogs(["--color"], logDir);
        expect(colored.stdout).toMatch(/\u001b\[3\d;1mpkc-js:comment\u001b\[0m/);
        const both = await runBitsocialLogs(["--color", "--json"], logDir);
        expect(both.exitCode).not.toBe(0);
    });

    it("--json prints the stored entries, one per line, with the stack inside msg", async () => {
        const { logDir } = await createLogDir();
        await writeRun(logDir);
        const result = await runBitsocialLogs(["--json", "--level", "error"], logDir);
        const lines = result.stdout.trimEnd().split("\n");
        expect(lines).toHaveLength(1);
        const entry = JSON.parse(lines[0]);
        expect(entry).toMatchObject({ seq: 3, level: "error", namespace: "pkc-js:comment", tags: { publicKey: KEY } });
        expect(entry.msg).toContain("at stack line 2");
    });

    it("--level and --stdout/--stderr filter by entry level and by whether the terminal showed it", async () => {
        const { logDir } = await createLogDir();
        await writeRun(logDir);
        const errors = await runBitsocialLogs(["--level", "error"], logDir);
        expect(errors.stdout.trimEnd().split("\n")[0]).toContain("[error] pkc-js:comment");
        expect(errors.stdout).not.toContain("storeComment");
        const stdout = await runBitsocialLogs(["--stdout"], logDir);
        expect(stdout.stdout.trimEnd()).toBe("[2026-07-01T00:00:00.000Z] [log] bitsocial-cli:stdout PART0_STDOUT_MARKER");
        const stderr = await runBitsocialLogs(["--stderr", "-n", "1"], logDir);
        expect(stderr.stdout).toContain("PART1_LAST_MARKER");
        expect(stderr.stdout).not.toContain("PART0_STDOUT_MARKER");
    });

    it("strips escape sequences from old text log files unless --color is given", async () => {
        const { logDir } = await createLogDir();
        const file = path.join(logDir, "bitsocial_cli_daemon_2026-05-01T00-00-00.000Z.log");
        await fsPromise.writeFile(
            file,
            `[2026-05-01T00:00:00.000Z] [stderr] \u001b[36;1mpkc-js:local-community \u001b[0m[publicKey=${KEY}] hello \u001b[36m+0ms\u001b[0m\n`
        );
        const plain = await runBitsocialLogs([], logDir);
        expect(plain.stdout.trimEnd()).toBe(`[2026-05-01T00:00:00.000Z] [stderr] pkc-js:local-community [publicKey=${KEY}] hello +0ms`);
        const colored = await runBitsocialLogs(["--color"], logDir);
        expect(colored.stdout).toMatch(/\u001b\[36;1m/);
        const json = JSON.parse((await runBitsocialLogs(["--json"], logDir)).stdout.trim());
        expect(json).toMatchObject({ namespace: "pkc-js:local-community", level: "log" });
        expect(json.msg).not.toMatch(/\u001b/);
    });

    it("-f follows the daemon onto its next rotated file without a switch notice, and prints each line once", async () => {
        const { logDir } = await createLogDir();
        const stem = "bitsocial_cli_daemon_2026-07-02T00-00-00.000Z";
        await fsPromise.writeFile(path.join(logDir, `${stem}.jsonl`), jsonlEntry("2026-07-02T00:00:00.000Z", "t:ns", "FIRST_MARKER") + "\n");
        let rotated = false;
        const result = await runFollowUntil(["-f"], logDir, {
            onChunk: (stdout) => {
                if (rotated || !stdout.includes("FIRST_MARKER")) return;
                rotated = true;
                void (async () => {
                    // The last line of the old file lands after the next file exists, as when the daemon's stream flushes late
                    await fsPromise.writeFile(path.join(logDir, `${stem}.1.jsonl`), jsonlEntry("2026-07-02T00:00:02.000Z", "t:ns", "NEXT_FILE_MARKER") + "\n");
                    await fsPromise.appendFile(path.join(logDir, `${stem}.jsonl`), jsonlEntry("2026-07-02T00:00:01.000Z", "t:ns", "LATE_FLUSH_MARKER") + "\n");
                })();
            },
            doneWhen: (stdout) => stdout.includes("NEXT_FILE_MARKER"),
            graceMs: 1000
        });
        const count = (needle: string) => result.stdout.split(needle).length - 1;
        expect(count("FIRST_MARKER")).toBe(1);
        expect(count("LATE_FLUSH_MARKER")).toBe(1);
        expect(count("NEXT_FILE_MARKER")).toBe(1);
        expect(result.stdout.indexOf("LATE_FLUSH_MARKER")).toBeLessThan(result.stdout.indexOf("NEXT_FILE_MARKER"));
        expect(result.stderr).not.toContain("switched to new log file");
    });

    it("-f with --level only prints new entries of that level", async () => {
        const { logDir } = await createLogDir();
        const file = path.join(logDir, "bitsocial_cli_daemon_2026-07-03T00-00-00.000Z.jsonl");
        await fsPromise.writeFile(file, jsonlEntry("2026-07-03T00:00:00.000Z", "t:ns", "READY_MARKER", { level: "error" }) + "\n");
        let appended = false;
        const result = await runFollowUntil(["-f", "--level", "error"], logDir, {
            onChunk: (stdout) => {
                if (appended || !stdout.includes("READY_MARKER")) return;
                appended = true;
                void fsPromise.appendFile(
                    file,
                    jsonlEntry("2026-07-03T00:00:01.000Z", "t:ns", "LOG_LEVEL_MARKER") +
                        "\n" +
                        jsonlEntry("2026-07-03T00:00:02.000Z", "t:ns", "ERROR_LEVEL_MARKER", { level: "error" }) +
                        "\n"
                );
            },
            doneWhen: (stdout) => stdout.includes("ERROR_LEVEL_MARKER"),
            graceMs: 500
        });
        expect(result.stdout).toContain("ERROR_LEVEL_MARKER");
        expect(result.stdout).not.toContain("LOG_LEVEL_MARKER");
    });
});
