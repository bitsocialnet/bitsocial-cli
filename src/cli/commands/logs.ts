import { Flags, Command } from "@oclif/core";
import defaults from "../../common-utils/defaults.js";
import fs from "fs";
import fsPromise from "fs/promises";
import path from "path";

interface LogEntry {
    timestamp: Date | null;
    stream: "stdout" | "stderr" | null;
    lines: string[];
}

export default class Logs extends Command {
    static override description =
        "View the latest BitSocial daemon log file. By default dumps the full log and exits. Use --follow to stream new output in real-time (like tail -f).";

    static override flags = {
        follow: Flags.boolean({
            char: "f",
            description: "Follow log output in real-time (like tail -f)",
            default: false
        }),
        tail: Flags.string({
            char: "n",
            description: 'Number of log entries to show from the end. Use "all" to show everything.',
            default: "all"
        }),
        since: Flags.string({
            description:
                "Show logs since timestamp (ISO 8601, e.g. 2026-01-02T13:23:37Z) or relative time (e.g. 30s, 42m, 2h, 1d)",
            required: false
        }),
        until: Flags.string({
            description:
                "Show logs before timestamp (ISO 8601, e.g. 2026-01-02T13:23:37Z) or relative time (e.g. 30s, 42m, 2h, 1d)",
            required: false
        }),
        logPath: Flags.directory({
            description: "Specify the directory containing log files",
            required: false
        }),
        stdout: Flags.boolean({
            description: "Show only stdout log entries",
            default: false,
            exclusive: ["stderr"]
        }),
        stderr: Flags.boolean({
            description: "Show only stderr log entries (output of pkc-logger library)",
            default: false,
            exclusive: ["stdout"]
        })
    };

    static override examples = [
        "bitsocial logs",
        "bitsocial logs -f",
        "bitsocial logs -n 50",
        "bitsocial logs --since 5m",
        "bitsocial logs --since 2026-01-02T13:23:37Z --until 2026-01-02T14:00:00Z",
        "bitsocial logs --since 1h -f",
        "bitsocial logs --stdout",
        "bitsocial logs --stderr",
        "bitsocial logs --stdout -f"
    ];

    private async _findLatestLogFile(logPath: string): Promise<string> {
        let entries: fs.Dirent[];
        try {
            entries = await fsPromise.readdir(logPath, { withFileTypes: true });
        } catch {
            this.error(`Log directory does not exist: ${logPath}\nHave you started the daemon yet?`);
        }

        const logFiles = entries
            .filter((entry) => entry.isFile() && entry.name.startsWith("bitsocial_cli_daemon_") && entry.name.endsWith(".log"))
            .map((entry) => entry.name)
            .sort();

        if (logFiles.length === 0) {
            this.error(`No log files found in ${logPath}\nHave you started the daemon yet?`);
        }

        return path.join(logPath, logFiles[logFiles.length - 1]);
    }

    _parseTimestamp(value: string): Date {
        // Try relative duration first: 30s, 42m, 2h, 1d
        const relativeMatch = value.match(/^(\d+)([smhd])$/);
        if (relativeMatch) {
            const amount = parseInt(relativeMatch[1], 10);
            const unit = relativeMatch[2];
            const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
            return new Date(Date.now() - amount * multipliers[unit]);
        }

        // Try ISO timestamp
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            this.error(
                `Invalid timestamp: "${value}". Use ISO 8601 format (e.g. 2026-01-02T13:23:37Z) or relative time (e.g. 30s, 42m, 2h, 1d)`
            );
        }
        return date;
    }

    _extractTimestamp(line: string): Date | null {
        const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] /);
        if (!match) return null;
        return new Date(match[1]);
    }

    _extractStream(line: string): "stdout" | "stderr" | null {
        const match = line.match(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[(stdout|stderr)\] /);
        if (!match) return null;
        return match[1] as "stdout" | "stderr";
    }

    _parseLogEntries(content: string): LogEntry[] {
        const lines = content.split("\n");
        const entries: LogEntry[] = [];

        for (const line of lines) {
            const timestamp = this._extractTimestamp(line);
            if (timestamp !== null) {
                // New timestamped entry
                const stream = this._extractStream(line);
                entries.push({ timestamp, stream, lines: [line] });
            } else if (entries.length > 0) {
                // Continuation line — belongs to the previous entry
                entries[entries.length - 1].lines.push(line);
            } else {
                // Line before any timestamped entry (legacy/header)
                entries.push({ timestamp: null, stream: null, lines: [line] });
            }
        }

        return entries;
    }

    _filterEntries(entries: LogEntry[], since?: Date, until?: Date): LogEntry[] {
        return entries.filter((entry) => {
            if (entry.timestamp === null) {
                // Legacy entries with no timestamp: exclude if --since is set, include otherwise
                return !since;
            }
            if (since && entry.timestamp < since) return false;
            if (until && entry.timestamp > until) return false;
            return true;
        });
    }

    _filterByStream(entries: LogEntry[], stream: "stdout" | "stderr"): LogEntry[] {
        return entries.filter((entry) => entry.stream === stream);
    }

    _tailEntries(entries: LogEntry[], tailValue: string): LogEntry[] {
        if (tailValue === "all") return entries;
        const n = parseInt(tailValue, 10);
        if (isNaN(n) || n < 0) {
            this.error(`Invalid --tail value: "${tailValue}". Must be a non-negative integer or "all".`);
        }
        if (n === 0) return [];
        return entries.slice(-n);
    }

    async run() {
        const { flags } = await this.parse(Logs);
        const logPath = flags.logPath ?? defaults.PKC_LOG_PATH;
        const latestLogFile = await this._findLatestLogFile(logPath);

        const since = flags.since ? this._parseTimestamp(flags.since) : undefined;
        const until = flags.until ? this._parseTimestamp(flags.until) : undefined;
        const streamFilter = flags.stdout ? "stdout" as const : flags.stderr ? "stderr" as const : undefined;

        if (!flags.follow) {
            const content = await fsPromise.readFile(latestLogFile, "utf-8");
            const entries = this._parseLogEntries(content);
            const filtered = this._filterEntries(entries, since, until);
            const streamFiltered = streamFilter ? this._filterByStream(filtered, streamFilter) : filtered;
            const tailed = this._tailEntries(streamFiltered, flags.tail);
            const output = tailed.map((e) => e.lines.join("\n")).join("\n");
            if (output) process.stdout.write(output + "\n");
            return;
        }

        // Follow mode: dump existing content (filtered + tailed) then watch for new data
        let currentLogFile = latestLogFile;

        const existingContent = await fsPromise.readFile(currentLogFile, "utf-8");
        // Anchor the follow offset to exactly the bytes we just read, NOT a separate
        // fsPromise.stat() taken afterwards. A later stat is racy: any append landing between
        // this read and the stat is skipped (position jumps past it) yet was never in the dump
        // above, so follow mode silently drops those lines. Under load that window widens — this
        // was the cause of the intermittent CI failure where an appended line was never surfaced
        // (issue #77). Byte length (not string length) because position indexes bytes in the file.
        let position = Buffer.byteLength(existingContent, "utf-8");
        let pendingBuffer = "";

        const entries = this._parseLogEntries(existingContent);
        const filtered = this._filterEntries(entries, since, until);
        const streamFiltered = streamFilter ? this._filterByStream(filtered, streamFilter) : filtered;
        const tailed = this._tailEntries(streamFiltered, flags.tail);
        const initialOutput = tailed.map((e) => e.lines.join("\n")).join("\n");
        if (initialOutput) process.stdout.write(initialOutput + "\n");

        // Watch for new data by reading directly from `position`. We intentionally do
        // NOT gate on fsPromise.stat().size — on Windows + NTFS, stat() returns a stale
        // size for a short window after another process appends, which causes the gate
        // to miss new bytes. read() sees the true file end at syscall time.
        const READ_BUF_SIZE = 64 * 1024;
        const readBuf = Buffer.alloc(READ_BUF_SIZE);
        const readNewData = async () => {
            let fd: fsPromise.FileHandle | undefined;
            try {
                fd = await fsPromise.open(currentLogFile, "r");
                let chunk = "";
                while (true) {
                    const { bytesRead } = await fd.read(readBuf, 0, readBuf.length, position);
                    if (bytesRead === 0) break;
                    position += bytesRead;
                    chunk += readBuf.subarray(0, bytesRead).toString("utf-8");
                    if (bytesRead < readBuf.length) break;
                }
                if (!chunk) return;

                const combined = pendingBuffer + chunk;
                const lastNewline = combined.lastIndexOf("\n");
                if (lastNewline === -1) {
                    pendingBuffer = combined;
                    return;
                }
                pendingBuffer = combined.slice(lastNewline + 1);
                const completeText = combined.slice(0, lastNewline + 1);

                if (!since && !until && !streamFilter) {
                    // No filtering — pass through directly
                    process.stdout.write(completeText);
                } else {
                    const newEntries = this._parseLogEntries(completeText.replace(/\n$/, ""));
                    const filteredNew = this._filterEntries(newEntries, since, until);
                    const streamFilteredNew = streamFilter ? this._filterByStream(filteredNew, streamFilter) : filteredNew;
                    const output = streamFilteredNew.map((e) => e.lines.join("\n")).join("\n");
                    if (output) process.stdout.write(output + "\n");
                }
            } catch {
                // File may have been rotated or deleted
            } finally {
                if (fd) await fd.close().catch(() => {});
            }
        };

        // Periodically check if a newer log file has appeared (e.g. after daemon restart)
        const checkForNewLogFile = async () => {
            try {
                const newestFile = await this._findLatestLogFile(logPath);
                if (newestFile === currentLogFile) return;

                // Flush any remaining partial line from old file
                if (pendingBuffer) {
                    if (!since && !until && !streamFilter) {
                        process.stdout.write(pendingBuffer + "\n");
                    } else {
                        const pbEntries = this._parseLogEntries(pendingBuffer);
                        const pbFiltered = this._filterEntries(pbEntries, since, until);
                        const pbStreamFiltered = streamFilter ? this._filterByStream(pbFiltered, streamFilter) : pbFiltered;
                        const pbOutput = pbStreamFiltered.map((e) => e.lines.join("\n")).join("\n");
                        if (pbOutput) process.stdout.write(pbOutput + "\n");
                    }
                }

                currentLogFile = newestFile;
                pendingBuffer = "";

                process.stderr.write(`\n--- switched to new log file: ${path.basename(newestFile)} ---\n\n`);

                // Read and output entire new file content (with filters, no tail limit)
                const newContent = await fsPromise.readFile(currentLogFile, "utf-8");
                if (newContent) {
                    if (!since && !until && !streamFilter) {
                        process.stdout.write(newContent);
                    } else {
                        const newEntries = this._parseLogEntries(newContent.replace(/\n$/, ""));
                        const filteredNew = this._filterEntries(newEntries, since, until);
                        const streamFilteredNew = streamFilter
                            ? this._filterByStream(filteredNew, streamFilter)
                            : filteredNew;
                        const output = streamFilteredNew.map((e) => e.lines.join("\n")).join("\n");
                        if (output) process.stdout.write(output + "\n");
                    }
                }

                const newStat = await fsPromise.stat(currentLogFile);
                position = newStat.size;
            } catch {
                // Directory listing failed or file disappeared — retry next cycle
            }
        };

        // Userspace polling instead of fs.watchFile — libuv's uv_fs_poll_t doesn't
        // reliably notify on cross-process appends on Windows (see nodejs/node#36888).
        let polling = true;
        let pollTimer: NodeJS.Timeout | null = null;
        const pollLoop = async () => {
            if (!polling) return;
            try {
                await readNewData();
            } finally {
                if (polling) pollTimer = setTimeout(pollLoop, 300);
            }
        };
        pollTimer = setTimeout(pollLoop, 300);
        const newFileCheckInterval = setInterval(checkForNewLogFile, 3000);

        const shutdown = () => {
            polling = false;
            if (pollTimer) clearTimeout(pollTimer);
            clearInterval(newFileCheckInterval);
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        // Keep process alive
        await new Promise(() => {});
    }
}
