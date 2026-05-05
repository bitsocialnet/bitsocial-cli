import { describe, it, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import { createDaemonFileLogger } from "../../dist/common-utils/daemon-file-logger.js";

const PAYLOAD_LINE_LEN = 500;

const writeNLines = (
    logger: ReturnType<typeof createDaemonFileLogger>,
    n: number,
    label: (i: number) => string = (i) => `m${i}`
) => {
    for (let i = 0; i < n; i++) {
        const line = `${label(i)}-`.padEnd(PAYLOAD_LINE_LEN, "x") + "\n";
        logger.writeTimestampedLine(line, "stderr");
    }
};

describe("daemon file logger", () => {
    it("does NOT silently freeze writes after the cap is exceeded (regression for #37 bug 1)", async () => {
        const dir = randomDirectory();
        const logFile = path.join(dir, "test.log");
        const logger = createDaemonFileLogger({ logFilePath: logFile, maxBytes: 100_000, trimToBytes: 60_000 });

        // Write enough volume to exceed 100 KB cap multiple times over
        writeNLines(logger, 800, (i) => `early-${i}`);
        // Force any pending trim to complete
        await logger._trimNow();
        // Now write a sentinel that MUST appear in the file (would have been silently dropped before fix)
        const sentinel = `LATE_SENTINEL_LINE_${Date.now()}`;
        logger.writeTimestampedLine(sentinel + "\n", "stderr");
        await logger._trimNow();
        await logger.close();

        const content = await fsPromise.readFile(logFile, "utf-8");
        expect(content).toContain(sentinel);
    });

    it("keeps the file size bounded near maxBytes after sustained over-cap writes", async () => {
        const dir = randomDirectory();
        const logFile = path.join(dir, "test.log");
        const maxBytes = 80_000;
        const trimToBytes = 50_000;
        const logger = createDaemonFileLogger({ logFilePath: logFile, maxBytes, trimToBytes });

        // ~500 KB of writes across multiple trim cycles
        writeNLines(logger, 1000, (i) => `m${i}`);
        await logger._trimNow();
        await logger.close();

        const stat = await fsPromise.stat(logFile);
        // After trim, file should be ≤ maxBytes (trimmed down to ~trimToBytes plus pending drain)
        expect(stat.size).toBeLessThanOrEqual(maxBytes + PAYLOAD_LINE_LEN * 2);
    });

    it("preserves the most recent writes after trim, drops the oldest", async () => {
        const dir = randomDirectory();
        const logFile = path.join(dir, "test.log");
        const logger = createDaemonFileLogger({ logFilePath: logFile, maxBytes: 80_000, trimToBytes: 40_000 });

        // 400 lines * ~500 bytes = ~200 KB, well above cap
        writeNLines(logger, 400, (i) => `msg-${String(i).padStart(4, "0")}`);
        await logger._trimNow();
        await logger.close();

        const content = await fsPromise.readFile(logFile, "utf-8");
        // The very latest messages must survive
        expect(content).toContain("msg-0399");
        expect(content).toContain("msg-0398");
        // The oldest must have been trimmed
        expect(content).not.toMatch(/msg-000[0-5]/);
        // File should start on a line boundary (the timestamp prefix)
        const firstChar = content.charCodeAt(0);
        expect(firstChar).toBe(0x5b /* '[' */);
    });

    it("returns false from writeTimestampedLine after close so caller can fall back (regression for #37 bug 2)", async () => {
        const dir = randomDirectory();
        const logFile = path.join(dir, "test.log");
        const logger = createDaemonFileLogger({ logFilePath: logFile, maxBytes: 100_000, trimToBytes: 50_000 });

        expect(logger.writeTimestampedLine("first\n", "stderr")).toBe(true);
        await logger.close();
        expect(logger.writeTimestampedLine("after-close\n", "stderr")).toBe(false);
    });
});
