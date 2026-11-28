import { describe, it, expect } from "vitest";
import { createLogEntryWriter, stackIsInModuleDir } from "../../dist/common-utils/daemon-log-capture.js";
import type { DaemonLogEntry } from "../../dist/common-utils/daemon-file-logger.js";

// The daemon tells pkc-logger's own `debug` lines from other libraries' by looking for pkc-logger's directory in the
// stack. pkc-logger is ESM, so its frames are file:// URLs, not paths.
describe("stackIsInModuleDir", () => {
    it("finds an ESM frame on Windows", () => {
        const moduleUrl = "file:///C:/app/node_modules/@pkcprotocol/pkc-logger/dist/src/index.js";
        const stack = `Error
    at Function.log (file:///C:/app/dist/cli/commands/daemon.js:210:31)
    at debug (C:\\app\\node_modules\\debug\\src\\common.js:113:10)
    at emit (file:///C:/app/node_modules/@pkcprotocol/pkc-logger/dist/src/index.js:154:13)`;
        expect(stackIsInModuleDir(stack, moduleUrl, { windows: true })).toBe(true);
    });

    it("finds an ESM frame when the install path has a space", () => {
        const moduleUrl = "file:///home/me/my%20apps/node_modules/@pkcprotocol/pkc-logger/dist/src/index.js";
        const stack = `Error
    at debug (/home/me/my apps/node_modules/debug/src/common.js:113:10)
    at emit (file:///home/me/my%20apps/node_modules/@pkcprotocol/pkc-logger/dist/src/index.js:154:13)`;
        expect(stackIsInModuleDir(stack, moduleUrl, { windows: false })).toBe(true);
    });

    it("finds a CommonJS frame, which is a path", () => {
        const moduleUrl = "file:///srv/app/node_modules/some-lib/index.js";
        expect(stackIsInModuleDir("Error\n    at f (/srv/app/node_modules/some-lib/index.js:1:1)", moduleUrl, { windows: false })).toBe(true);
    });

    it("does not match another library's stack", () => {
        const moduleUrl = "file:///srv/app/node_modules/@pkcprotocol/pkc-logger/dist/src/index.js";
        const stack = `Error
    at debug (/srv/app/node_modules/debug/src/common.js:113:10)
    at Config.load (file:///srv/app/node_modules/@oclif/core/lib/config/config.js:20:5)`;
        expect(stackIsInModuleDir(stack, moduleUrl, { windows: false })).toBe(false);
    });

    it("does not match a sibling directory whose name starts the same", () => {
        const moduleUrl = "file:///srv/app/node_modules/@pkcprotocol/pkc-logger/dist/src/index.js";
        const stack = "Error\n    at f (file:///srv/app/node_modules/@pkcprotocol/pkc-logger/dist/src-other/index.js:1:1)";
        expect(stackIsInModuleDir(stack, moduleUrl, { windows: false })).toBe(false);
    });
});

const entry = (namespace: string, level: DaemonLogEntry["level"] = "log"): DaemonLogEntry => ({ time: 0, level, namespace, msg: "TEXT_MARKER", tags: {} });

describe("createLogEntryWriter", () => {
    it("prints an entry the file did not take", () => {
        const printed: string[] = [];
        const write = createLogEntryWriter({ writeToFile: () => false, print: (text) => printed.push(text) });
        write(entry("bitsocial-cli:daemon"));
        write(entry("bitsocial-cli:stderr", "error"));
        expect(printed).toHaveLength(2);
        expect(printed.every((text) => text.includes("TEXT_MARKER"))).toBe(true);
    });

    // The stdout hook printed the text before logging it, so printing the entry again would show it twice
    it("does not print a bitsocial-cli:stdout entry the file did not take", () => {
        const printed: string[] = [];
        const write = createLogEntryWriter({ writeToFile: () => false, print: (text) => printed.push(text) });
        write(entry("bitsocial-cli:stdout"));
        expect(printed).toEqual([]);
    });

    it("prints nothing when the file took the entry", () => {
        const printed: string[] = [];
        const write = createLogEntryWriter({ writeToFile: () => true, print: (text) => printed.push(text) });
        write(entry("bitsocial-cli:daemon"));
        expect(printed).toEqual([]);
    });
});
