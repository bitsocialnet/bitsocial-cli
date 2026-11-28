import fs from "fs";
import fsPromise from "fs/promises";
import path from "path";

/** One line of a daemon log file: a pkc-logger entry, as `getLogs` returns it. */
export interface DaemonLogEntry {
    /** The logger root's sequence number. Absent on entries from another root (see daemon.ts). */
    seq?: number;
    /** Unix epoch milliseconds. */
    time: number;
    level: "log" | "error" | "trace";
    namespace: string;
    /** Color-free; may span several lines (an error's stack). */
    msg: string;
    tags: Readonly<Record<string, string>>;
}

export const DAEMON_LOG_FILE_PREFIX = "bitsocial_cli_daemon_";
export const DEFAULT_LOG_MAX_FILE_BYTES = 20_000_000;
export const DEFAULT_LOG_MAX_TOTAL_BYTES = 200_000_000;
/** How many daemon starts keep their files. */
export const DEFAULT_LOG_MAX_STARTS = 5;

export interface DaemonLogFile {
    name: string;
    path: string;
    /** Identifies the daemon start: `bitsocial_cli_daemon_<start time>`. */
    stem: string;
    /** 0 for a start's first file, then 1, 2... as it rotates. */
    part: number;
    /** `log` for the timestamped text files written before JSONL. */
    format: "jsonl" | "log";
}

// The start time contains a "." (milliseconds), so the part number is only the digits right before the extension.
const LOG_FILE_NAME = /^(bitsocial_cli_daemon_.+?)(?:\.(\d+))?\.(jsonl|log)$/;

export function parseDaemonLogFileName(name: string): Omit<DaemonLogFile, "path"> | undefined {
    const match = LOG_FILE_NAME.exec(name);
    if (!match) return undefined;
    return { name, stem: match[1], part: match[2] ? Number(match[2]) : 0, format: match[3] as "jsonl" | "log" };
}

export function daemonLogFileName(stem: string, part: number): string {
    return part === 0 ? `${stem}.jsonl` : `${stem}.${part}.jsonl`;
}

/** The daemon's log files in `logDir`, oldest first: by start, then by part. */
export async function listDaemonLogFiles(logDir: string): Promise<DaemonLogFile[]> {
    const entries = await fsPromise.readdir(logDir, { withFileTypes: true });
    const files: DaemonLogFile[] = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const parsed = parseDaemonLogFileName(entry.name);
        if (parsed) files.push({ ...parsed, path: path.join(logDir, entry.name) });
    }
    return files.sort((a, b) => (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : a.part - b.part));
}

export function newDaemonLogStem(now = new Date()): string {
    return `${DAEMON_LOG_FILE_PREFIX}${now.toISOString().replace(/:/g, "-")}`;
}

export interface DaemonFileLoggerOptions {
    logDir: string;
    /** This daemon start's file stem, from newDaemonLogStem(). */
    stem: string;
    /** Move on to a new file before one grows past this. */
    maxFileBytes?: number;
    /** Delete the oldest files, other than the one being written, once all of them together are larger than this. */
    maxTotalBytes?: number;
    /** Delete every file of the oldest starts once more than this many starts have files. */
    maxStarts?: number;
}

export interface DaemonFileLogger {
    /** Append one entry as a JSON line. False when it was dropped (closed, or the file failed), so the caller can print it. */
    writeEntry(entry: DaemonLogEntry): boolean;
    close(): Promise<void>;
    /** The file being written now. */
    readonly currentPath: string;
    /** Files deleted so far, oldest first; for the daemon's startup line and tests. */
    readonly deletedFiles: readonly string[];
    /** Resolves once the deletions scheduled so far are done. For tests. */
    _settled(): Promise<void>;
}

export function serializeDaemonLogEntry(entry: DaemonLogEntry): string {
    const line: DaemonLogEntry = { time: entry.time, level: entry.level, namespace: entry.namespace, msg: entry.msg, tags: entry.tags };
    return JSON.stringify(entry.seq === undefined ? line : { seq: entry.seq, ...line }) + "\n";
}

/**
 * Writes the daemon's log entries as JSONL, rotating by size. Files are only ever appended to, so a reader can follow
 * one by offset. Disk use is bounded by deleting whole files, oldest first: `maxTotalBytes` plus at most one file.
 */
export async function createDaemonFileLogger(options: DaemonFileLoggerOptions): Promise<DaemonFileLogger> {
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_LOG_MAX_FILE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_LOG_MAX_TOTAL_BYTES;
    const maxStarts = options.maxStarts ?? DEFAULT_LOG_MAX_STARTS;
    if (maxFileBytes <= 0) throw new Error(`maxFileBytes (${maxFileBytes}) must be positive`);
    if (maxTotalBytes < maxFileBytes) throw new Error(`maxTotalBytes (${maxTotalBytes}) must be at least maxFileBytes (${maxFileBytes})`);
    if (maxStarts < 1) throw new Error(`maxStarts (${maxStarts}) must be at least 1`);
    const { logDir, stem } = options;
    await fsPromise.mkdir(logDir, { recursive: true });

    let part = 0;
    let currentPath = path.join(logDir, daemonLogFileName(stem, part));
    let currentBytes = 0;
    let failed = false;
    let closed = false;
    const deletedFiles: string[] = [];

    // One per stream opened, resolved once it is closed (all its data written) or failed. A rotated stream may still be
    // flushing a burst after the next one is opened, so close() waits for all of them.
    const streamsDone: Promise<void>[] = [];
    const openStream = (filePath: string) => {
        const s = fs.createWriteStream(filePath, { flags: "a" });
        s.on("error", () => {
            if (s === stream) failed = true;
        });
        streamsDone.push(
            new Promise<void>((resolve) => {
                s.once("close", () => resolve());
                s.once("error", () => resolve());
            })
        );
        return s;
    };
    let stream = openStream(currentPath);

    const prune = async () => {
        const files = await listDaemonLogFiles(logDir).catch(() => [] as DaemonLogFile[]);
        const withSizes = await Promise.all(
            files.map(async (file) => ({ ...file, size: (await fsPromise.stat(file.path).catch(() => null))?.size ?? 0 }))
        );
        const remove = async (file: DaemonLogFile) => {
            await fsPromise.rm(file.path, { force: true });
            deletedFiles.push(file.name);
        };
        let remaining = withSizes.filter((file) => file.path !== currentPath);
        // This start counts as one, so `maxStarts - 1` earlier starts keep their files
        const earlierStarts = [...new Set(remaining.filter((file) => file.stem !== stem).map((file) => file.stem))];
        const startsToDrop = new Set(earlierStarts.slice(0, Math.max(0, earlierStarts.length - (maxStarts - 1))));
        for (const file of remaining.filter((file) => startsToDrop.has(file.stem))) await remove(file);
        remaining = remaining.filter((file) => !startsToDrop.has(file.stem));
        // The file being written is not on disk at its final size yet; count what this logger has handed it
        let total = remaining.reduce((sum, file) => sum + file.size, 0) + currentBytes;
        for (const file of remaining) {
            if (total <= maxTotalBytes) break;
            await remove(file);
            total -= file.size;
        }
    };
    let pruning: Promise<void> = prune().catch(() => {});
    const schedulePrune = () => {
        pruning = pruning.then(prune).catch(() => {});
    };

    const rotate = () => {
        const previous = stream;
        previous.end();
        part++;
        currentPath = path.join(logDir, daemonLogFileName(stem, part));
        currentBytes = 0;
        failed = false;
        stream = openStream(currentPath);
        schedulePrune();
    };

    return {
        writeEntry(entry) {
            if (closed || failed) return false;
            const line = serializeDaemonLogEntry(entry);
            const bytes = Buffer.byteLength(line);
            if (currentBytes > 0 && currentBytes + bytes > maxFileBytes) rotate();
            stream.write(line);
            currentBytes += bytes;
            return true;
        },
        async close() {
            if (closed) return;
            closed = true;
            await pruning;
            stream.end();
            await Promise.all(streamsDone);
        },
        get currentPath() {
            return currentPath;
        },
        get deletedFiles() {
            return deletedFiles;
        },
        async _settled() {
            await pruning;
        }
    };
}
