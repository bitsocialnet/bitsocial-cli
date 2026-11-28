import path from "path";
import { EOL } from "node:os";
import { fileURLToPath } from "node:url";
import type { DaemonLogEntry } from "./daemon-file-logger.js";
import { renderLogEntry, streamOfNamespace, STDOUT_NAMESPACE } from "./daemon-log-format.js";

/**
 * Whether `stack` has a frame in the directory of the module at `moduleUrl`. An ES module's frames are `file://` URLs
 * (percent-encoded, forward slashes on Windows too) and a CommonJS module's are paths, so both forms are looked for.
 */
export function stackIsInModuleDir(stack: string, moduleUrl: string, options: { windows?: boolean } = {}): boolean {
    const windows = options.windows ?? process.platform === "win32";
    const pathModule = windows ? path.win32 : path.posix;
    const dirUrl = new URL(".", moduleUrl).href;
    const dirPath = pathModule.dirname(fileURLToPath(moduleUrl, { windows })) + pathModule.sep;
    return stack.includes(dirUrl) || stack.includes(dirPath);
}

/**
 * The daemon's one way into the log file: an entry the file cannot take (closed, or its stream failed) is printed
 * with `print`, so it is not lost. A bitsocial-cli:stdout entry is not: the stdout hook printed its text already.
 */
export function createLogEntryWriter(options: {
    writeToFile: (entry: DaemonLogEntry) => boolean;
    print: (text: string) => void;
}): (entry: DaemonLogEntry) => void {
    return (entry) => {
        if (options.writeToFile(entry) || entry.namespace === STDOUT_NAMESPACE) return;
        options.print(renderLogEntry({ time: entry.time, level: entry.level, namespace: entry.namespace, stream: streamOfNamespace(entry.namespace), entry }) + EOL);
    };
}
