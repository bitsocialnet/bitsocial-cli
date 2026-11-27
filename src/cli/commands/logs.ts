import { Flags, Command } from "@oclif/core";
import defaults from "../../common-utils/defaults.js";
import fsPromise from "fs/promises";
import path from "path";
import { listDaemonLogFiles, type DaemonLogFile } from "../../common-utils/daemon-file-logger.js";
import {
    jsonLogEntry,
    parseJsonlEntries,
    parseLegacyEntries,
    renderLogEntry,
    type ReadLogEntry
} from "../../common-utils/daemon-log-format.js";

const LEVELS = ["log", "error", "trace"] as const;

export default class Logs extends Command {
    static override description =
        "View the latest BitSocial daemon log. By default prints the newest daemon run's log and exits. Use --follow to stream new output in real-time (like tail -f). Output has no colors unless --color is given, so it can be piped into grep; --json prints one JSON object per entry for jq.";

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
            description: "Show only what the daemon printed to its terminal (stdout)",
            default: false,
            exclusive: ["stderr"]
        }),
        stderr: Flags.boolean({
            description: "Show only what the daemon did not print to its terminal (debug output and stderr)",
            default: false,
            exclusive: ["stdout"]
        }),
        level: Flags.string({
            description: "Show only entries of this level. Can be given more than once",
            options: [...LEVELS],
            multiple: true
        }),
        json: Flags.boolean({
            description:
                "Print each entry as one JSON object ({ seq, time, level, namespace, msg, tags }), for filtering with jq",
            default: false,
            exclusive: ["color"]
        }),
        color: Flags.boolean({
            description: "Color namespaces and errors (off by default, so piped output has no escape sequences)",
            default: false,
            exclusive: ["json"]
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
        "bitsocial logs --level error",
        "bitsocial logs --color | less -R",
        {
            description: "Lines of one community",
            command: 'bitsocial logs | grep -F "publicKey=$PUBLIC_KEY"'
        },
        {
            description: "Lines of one comment (by cid) or one challenge exchange (by signature)",
            command: 'bitsocial logs | grep -F "cid=$CID"'
        },
        {
            description: "Follow one community's lines as they arrive",
            command: 'bitsocial logs -f -n 0 | grep --line-buffered -F "publicKey=$PUBLIC_KEY"'
        },
        {
            description: "Errors of one community, stack traces included",
            command: `bitsocial logs --json --level error | jq -r 'select(.tags.publicKey == "'"$PUBLIC_KEY"'") | .msg'`
        }
    ];

    /** The newest daemon run's files, in order. */
    private async _findLatestRunFiles(logPath: string): Promise<DaemonLogFile[]> {
        let files: DaemonLogFile[];
        try {
            files = await listDaemonLogFiles(logPath);
        } catch {
            this.error(`Log directory does not exist: ${logPath}\nHave you started the daemon yet?`);
        }
        if (files.length === 0) {
            this.error(`No log files found in ${logPath}\nHave you started the daemon yet?`);
        }
        const newestStem = files[files.length - 1].stem;
        return files.filter((file) => file.stem === newestStem);
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

    _parseEntries(content: string, format: DaemonLogFile["format"]): ReadLogEntry[] {
        return format === "jsonl" ? parseJsonlEntries(content) : parseLegacyEntries(content);
    }

    _tailEntries(entries: ReadLogEntry[], tailValue: string): ReadLogEntry[] {
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
        const runFiles = await this._findLatestRunFiles(logPath);

        const since = flags.since ? this._parseTimestamp(flags.since).getTime() : undefined;
        const until = flags.until ? this._parseTimestamp(flags.until).getTime() : undefined;
        const streamFilter = flags.stdout ? ("stdout" as const) : flags.stderr ? ("stderr" as const) : undefined;
        const levels = flags.level && flags.level.length > 0 ? new Set(flags.level) : undefined;

        // --since and --until first, then --stdout/--stderr and --level, then -n
        const filter = (entries: ReadLogEntry[]) =>
            entries.filter((entry) => {
                if (entry.time === null) {
                    // Text before the first timestamp of an old file: only without --since
                    if (since !== undefined) return false;
                } else {
                    if (since !== undefined && entry.time < since) return false;
                    if (until !== undefined && entry.time > until) return false;
                }
                if (streamFilter && entry.stream !== streamFilter) return false;
                if (levels && !levels.has(entry.level)) return false;
                return true;
            });
        const format = (entry: ReadLogEntry) => (flags.json ? jsonLogEntry(entry) : renderLogEntry(entry, { color: flags.color }));
        const print = (entries: ReadLogEntry[]) => {
            if (entries.length > 0) process.stdout.write(entries.map(format).join("\n") + "\n");
        };

        // Read each file once, as bytes, so follow mode continues from exactly what was printed (issue #77)
        const contents = await Promise.all(runFiles.map((file) => fsPromise.readFile(file.path)));
        const existing = runFiles.flatMap((file, i) => this._parseEntries(contents[i].toString("utf-8"), file.format));
        print(this._tailEntries(filter(existing), flags.tail));

        if (!flags.follow) return;

        // Follow mode. The daemon only appends to a file, then moves on to the next one (rotation, or a new run), so
        // each file is read from an offset to its end, then the next one from its start.
        let current = runFiles[runFiles.length - 1];
        let position = contents[contents.length - 1].length;
        let pendingBuffer = "";
        // Set when a later file shows up. The switch waits one more poll, so the daemon's last writes to this file,
        // which its stream flushes after opening the next one, are read first.
        let nextFileSeen: DaemonLogFile | undefined;

        const READ_BUF_SIZE = 64 * 1024;
        const readBuf = Buffer.alloc(READ_BUF_SIZE);

        const printChunk = (text: string) => {
            // An old text file's entry can span lines; the whole chunk is parsed together
            print(filter(this._parseEntries(text, current.format)));
        };

        // Reads from `position` with read(), not gated on stat().size: on Windows + NTFS stat() returns a stale size for
        // a short time after another process appends, and read() sees the real end
        const readNewData = async () => {
            let fd: fsPromise.FileHandle | undefined;
            try {
                fd = await fsPromise.open(current.path, "r");
                const size = (await fd.stat()).size;
                if (size < position) {
                    // Only an old daemon (text log, trimmed in place) or something other than the daemon shrinks a file
                    position = 0;
                    pendingBuffer = "";
                    process.stderr.write(`\n--- log file was truncated, following it from its start ---\n\n`);
                }
                const readChunks: Buffer[] = [];
                while (true) {
                    const { bytesRead } = await fd.read(readBuf, 0, readBuf.length, position);
                    if (bytesRead === 0) break;
                    position += bytesRead;
                    readChunks.push(Buffer.from(readBuf.subarray(0, bytesRead)));
                    if (bytesRead < readBuf.length) break;
                }
                if (readChunks.length === 0) return;
                const combined = pendingBuffer + Buffer.concat(readChunks).toString("utf-8");
                const lastNewline = combined.lastIndexOf("\n");
                if (lastNewline === -1) {
                    pendingBuffer = combined;
                    return;
                }
                pendingBuffer = combined.slice(lastNewline + 1);
                printChunk(combined.slice(0, lastNewline));
            } catch {
                // The file may have been deleted to stay within the daemon's log limits
            } finally {
                if (fd) await fd.close().catch(() => {});
            }
        };

        const findNextFile = async (): Promise<DaemonLogFile | undefined> => {
            const files = await listDaemonLogFiles(logPath).catch(() => [] as DaemonLogFile[]);
            return files.find((file) => file.stem > current.stem || (file.stem === current.stem && file.part > current.part));
        };

        const switchToNextFile = (next: DaemonLogFile) => {
            if (pendingBuffer) printChunk(pendingBuffer);
            const newRun = next.stem !== current.stem;
            current = next;
            position = 0;
            pendingBuffer = "";
            if (newRun) process.stderr.write(`\n--- switched to new log file: ${path.basename(next.path)} ---\n\n`);
        };

        // Userspace polling instead of fs.watchFile — libuv's uv_fs_poll_t doesn't
        // reliably notify on cross-process appends on Windows (see nodejs/node#36888).
        let polling = true;
        let pollTimer: NodeJS.Timeout | null = null;
        const pollLoop = async () => {
            if (!polling) return;
            try {
                await readNewData();
                if (nextFileSeen) {
                    // Read this file to its end once more before leaving it, in this loop so a read never runs halfway
                    // through a switch
                    switchToNextFile(nextFileSeen);
                    nextFileSeen = undefined;
                    await readNewData();
                }
                nextFileSeen = await findNextFile();
            } finally {
                if (polling) pollTimer = setTimeout(pollLoop, 300);
            }
        };
        pollTimer = setTimeout(pollLoop, 300);

        const shutdown = () => {
            polling = false;
            if (pollTimer) clearTimeout(pollTimer);
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        // Keep process alive
        await new Promise(() => {});
    }
}
