import type { DaemonLogEntry } from "./daemon-file-logger.js";

/** Where the daemon's stdout and stderr hooks log what did not come through a logger. */
export const STDOUT_NAMESPACE = "bitsocial-cli:stdout";
export const STDERR_NAMESPACE = "bitsocial-cli:stderr";

/** An entry read back from a log file: a JSONL entry, or one from the timestamped text files of earlier versions. */
export interface ReadLogEntry {
    /** Null for text before the first timestamp in an old file. */
    time: number | null;
    level: DaemonLogEntry["level"];
    namespace: string | null;
    /** Whether the daemon's terminal showed it. */
    stream: "stdout" | "stderr" | null;
    entry?: DaemonLogEntry;
    /** Old text files only: the entry's lines as written, escapes included. */
    legacyLines?: string[];
}

// Matches the CSI sequences `debug` and chalk write (colors, bold, reset), and other CSI sequences.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
    return text.replace(ANSI_ESCAPE, "");
}

const isEntry = (value: unknown): value is DaemonLogEntry => {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.time === "number" &&
        (v.level === "log" || v.level === "error" || v.level === "trace") &&
        typeof v.namespace === "string" &&
        typeof v.msg === "string" &&
        !!v.tags &&
        typeof v.tags === "object"
    );
};

export function streamOfNamespace(namespace: string): "stdout" | "stderr" {
    return namespace === STDOUT_NAMESPACE ? "stdout" : "stderr";
}

/** Entries of a JSONL file. A line that does not parse (a write cut off by a crash) is skipped. */
export function parseJsonlEntries(content: string): ReadLogEntry[] {
    const entries: ReadLogEntry[] = [];
    for (const line of content.split("\n")) {
        if (!line) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isEntry(parsed)) continue;
        entries.push({ time: parsed.time, level: parsed.level, namespace: parsed.namespace, stream: streamOfNamespace(parsed.namespace), entry: parsed });
    }
    return entries;
}

const LEGACY_PREFIX = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] (?:\[(stdout|stderr)\] )?/;

/** Entries of a timestamped text file. Lines without a timestamp continue the entry above them. */
export function parseLegacyEntries(content: string): ReadLogEntry[] {
    const entries: ReadLogEntry[] = [];
    for (const line of content.split("\n")) {
        const match = LEGACY_PREFIX.exec(line);
        if (match) {
            const stream = (match[2] as "stdout" | "stderr" | undefined) ?? null;
            const namespace = stream === "stderr" ? stripAnsi(line.slice(match[0].length)).split(" ")[0] || null : null;
            // `debug` printed errors under the namespace's `:error` child
            const level = namespace?.endsWith(":error") ? "error" : "log";
            entries.push({ time: new Date(match[1]).getTime(), level, namespace, stream, legacyLines: [line] });
        } else if (entries.length > 0) {
            entries[entries.length - 1].legacyLines!.push(line);
        } else {
            entries.push({ time: null, level: "log", namespace: null, stream: null, legacyLines: [line] });
        }
    }
    // A file ending in a newline leaves an empty continuation line
    const last = entries[entries.length - 1];
    if (last?.legacyLines && last.legacyLines.length > 1 && last.legacyLines[last.legacyLines.length - 1] === "") last.legacyLines.pop();
    return entries;
}

// The six colors `debug` uses on a terminal without 256-color support, picked the same way, by hashing the namespace
const NAMESPACE_COLORS = [6, 2, 3, 4, 5, 1];
function namespaceColor(namespace: string): number {
    let hash = 0;
    for (let i = 0; i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
    }
    return NAMESPACE_COLORS[Math.abs(hash) % NAMESPACE_COLORS.length];
}

/**
 * The text form of an entry: `[time] [level] namespace [key=value, ...] msg`, with the tag block left out when there
 * are no tags. Old text entries print as written, with their escapes stripped unless `color` is set.
 */
export function renderLogEntry(read: ReadLogEntry, options: { color?: boolean } = {}): string {
    if (read.legacyLines) {
        const text = read.legacyLines.join("\n");
        return options.color ? text : stripAnsi(text);
    }
    const entry = read.entry!;
    const tagKeys = Object.keys(entry.tags);
    const tagBlock = tagKeys.length > 0 ? `[${tagKeys.map((key) => `${key}=${entry.tags[key]}`).join(", ")}] ` : "";
    let namespace = entry.namespace;
    let level: string = entry.level;
    if (options.color) {
        const c = namespaceColor(entry.namespace);
        namespace = `\u001b[3${c};1m${entry.namespace}\u001b[0m`;
        if (entry.level === "error") level = `\u001b[31m${entry.level}\u001b[0m`;
    }
    return `[${new Date(entry.time).toISOString()}] [${level}] ${namespace} ${tagBlock}${entry.msg}`;
}

/** The JSON form of an entry for `bitsocial logs --json`. An old text entry becomes one with no tags. */
export function jsonLogEntry(read: ReadLogEntry): string {
    if (read.entry) return JSON.stringify(read.entry);
    const lines = read.legacyLines!.map(stripAnsi);
    lines[0] = lines[0].replace(LEGACY_PREFIX, "");
    const entry: DaemonLogEntry = {
        time: read.time ?? 0,
        level: read.level,
        namespace: read.namespace ?? (read.stream === "stdout" ? STDOUT_NAMESPACE : STDERR_NAMESPACE),
        msg: lines.join("\n"),
        tags: {}
    };
    return JSON.stringify(entry);
}
