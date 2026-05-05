import fs from "fs";
import fsPromise from "fs/promises";

export interface DaemonFileLoggerOptions {
    logFilePath: string;
    /** Trigger a trim once the current writer's bytesWritten exceeds this. Defaults to 20 MB. */
    maxBytes?: number;
    /** Target file size after trim. Must be < maxBytes. Defaults to 15 MB. */
    trimToBytes?: number;
    /** Bound on how many bytes of writes are buffered while a trim cycle is running. */
    pendingByteCap?: number;
}

export interface DaemonFileLogger {
    /**
     * Append a timestamped line to the log file. Returns false when the write was
     * dropped (e.g. the logger is closed or the in-flight pending buffer is full),
     * letting the caller decide whether to fall back to terminal output.
     */
    writeTimestampedLine(text: string, stream: "stdout" | "stderr"): boolean;
    close(): Promise<void>;
    /** Force-run a trim cycle — for tests. */
    _trimNow(): Promise<void>;
    readonly currentPath: string;
    readonly bytesWritten: number;
}

const DEFAULT_MAX = 20_000_000;
const DEFAULT_TRIM_TO = 15_000_000;
const DEFAULT_PENDING_CAP = 5_000_000;

export function createDaemonFileLogger(options: DaemonFileLoggerOptions): DaemonFileLogger {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX;
    const trimToBytes = options.trimToBytes ?? DEFAULT_TRIM_TO;
    const pendingByteCap = options.pendingByteCap ?? DEFAULT_PENDING_CAP;
    if (trimToBytes >= maxBytes) {
        throw new Error(`trimToBytes (${trimToBytes}) must be less than maxBytes (${maxBytes})`);
    }
    const logFilePath = options.logFilePath;

    let stream = fs.createWriteStream(logFilePath, { flags: "a" });
    stream.on("error", () => {});
    let trimming: Promise<void> | undefined;
    let pending: string[] = [];
    let pendingBytes = 0;
    let closed = false;

    const reopenStream = () => {
        stream.removeAllListeners("error");
        stream = fs.createWriteStream(logFilePath, { flags: "a" });
        stream.on("error", () => {});
    };

    const trim = async () => {
        // End the current stream first so its buffered writes flush to disk before we read the file
        await new Promise<void>((res) => stream.end(() => res()));

        const stat = await fsPromise.stat(logFilePath).catch(() => null);
        if (stat && stat.size > trimToBytes) {
            const fd = await fsPromise.open(logFilePath, "r");
            try {
                const buf = Buffer.alloc(trimToBytes);
                await fd.read(buf, 0, trimToBytes, stat.size - trimToBytes);
                // Skip a partial line at the start so the file always starts on a line boundary
                const firstNewline = buf.indexOf(0x0a);
                const tail = firstNewline >= 0 ? buf.subarray(firstNewline + 1) : buf;
                await fsPromise.writeFile(logFilePath, tail);
            } finally {
                await fd.close();
            }
        }
        reopenStream();
    };

    const drainPending = () => {
        if (pending.length === 0) return;
        const drained = pending;
        pending = [];
        pendingBytes = 0;
        for (const chunk of drained) {
            stream.write(chunk);
        }
    };

    const scheduleTrim = () => {
        if (trimming) return;
        trimming = trim()
            .catch(() => {
                // If trim fails (FS error, etc.) we drop the pending buffer rather than
                // hold memory forever. The next write will hit the same condition and retry.
                pending = [];
                pendingBytes = 0;
            })
            .finally(() => {
                trimming = undefined;
                drainPending();
            });
    };

    const writeTimestampedLine = (text: string, streamLabel: "stdout" | "stderr"): boolean => {
        if (closed) return false;
        if (!text || text.trim().length === 0) return false;
        const timestamp = `[${new Date().toISOString()}] [${streamLabel}] `;
        const lines = text.split("\n");
        const timestamped = lines.map((line, i) => (i === 0 ? timestamp + line : line)).join("\n");

        if (trimming) {
            // A trim cycle is in flight — buffer up to pendingByteCap, then drop with false
            // so the caller can fall back to writing to the terminal.
            if (pendingBytes + timestamped.length > pendingByteCap) return false;
            pending.push(timestamped);
            pendingBytes += timestamped.length;
            return true;
        }

        stream.write(timestamped);

        if (stream.bytesWritten > maxBytes) scheduleTrim();
        return true;
    };

    return {
        writeTimestampedLine,
        async close() {
            closed = true;
            if (trimming) await trimming.catch(() => {});
            await new Promise<void>((res) => stream.end(() => res()));
        },
        async _trimNow() {
            scheduleTrim();
            if (trimming) await trimming;
        },
        get currentPath() {
            return logFilePath;
        },
        get bytesWritten() {
            return stream.bytesWritten;
        }
    };
}
