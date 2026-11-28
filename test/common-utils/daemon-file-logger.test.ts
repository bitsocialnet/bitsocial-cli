import { describe, it, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import {
    createDaemonFileLogger,
    listDaemonLogFiles,
    parseDaemonLogFileName,
    type DaemonLogEntry
} from "../../dist/common-utils/daemon-file-logger.js";

const entry = (i: number, extra: Partial<DaemonLogEntry> = {}): DaemonLogEntry => ({
    seq: i,
    time: 1_760_000_000_000 + i,
    level: "log",
    namespace: "test:ns",
    msg: `m${String(i).padStart(5, "0")}-`.padEnd(400, "x"),
    tags: { publicKey: "12D3KooWtest" },
    ...extra
});

const totalSize = async (dir: string) => {
    let total = 0;
    for (const file of await listDaemonLogFiles(dir)) total += (await fsPromise.stat(file.path)).size;
    return total;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("daemon file logger", () => {
    it("writes one JSON line per entry, with seq, time, level, namespace, msg and tags", async () => {
        const dir = randomDirectory();
        const logger = await createDaemonFileLogger({ logDir: dir, stem: "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z" });
        logger.writeEntry(entry(1));
        logger.writeEntry(entry(2, { level: "error", msg: "boom\n    at stack line", tags: {}, seq: undefined }));
        await logger.close();

        const lines = (await fsPromise.readFile(logger.currentPath, "utf-8")).trimEnd().split("\n");
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0])).toEqual(entry(1));
        const second = JSON.parse(lines[1]);
        expect(second).toEqual({ time: entry(2).time, level: "error", namespace: "test:ns", msg: "boom\n    at stack line", tags: {} });
        expect(second).not.toHaveProperty("seq");
        expect(path.basename(logger.currentPath)).toBe("bitsocial_cli_daemon_2026-01-01T00-00-00.000Z.jsonl");
    });

    // The text logger this replaces trimmed in place, and counted bytes from 0 again after each trim, so its file grew
    // to trimToBytes + maxBytes (about 35 MB with the 20 MB default) before the next trim
    it("never lets one file grow past maxFileBytes, nor all of them past maxTotalBytes plus one file", async () => {
        const dir = randomDirectory();
        const maxFileBytes = 20_000;
        const maxTotalBytes = 60_000;
        const logger = await createDaemonFileLogger({ logDir: dir, stem: "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z", maxFileBytes, maxTotalBytes });
        let peakTotal = 0;
        for (let i = 0; i < 1000; i++) {
            logger.writeEntry(entry(i));
            if (i % 20 === 0) {
                await tick();
                await logger._settled();
                for (const file of await listDaemonLogFiles(dir)) expect((await fsPromise.stat(file.path)).size).toBeLessThanOrEqual(maxFileBytes);
                peakTotal = Math.max(peakTotal, await totalSize(dir));
            }
        }
        await logger.close();
        peakTotal = Math.max(peakTotal, await totalSize(dir));
        expect(peakTotal).toBeLessThanOrEqual(maxTotalBytes + maxFileBytes);
        expect(logger.deletedFiles.length).toBeGreaterThan(0);
    });

    it("keeps the newest entries in order across rotated files and deletes the oldest files", async () => {
        const dir = randomDirectory();
        const stem = "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z";
        const logger = await createDaemonFileLogger({ logDir: dir, stem, maxFileBytes: 10_000, maxTotalBytes: 30_000 });
        for (let i = 0; i < 300; i++) logger.writeEntry(entry(i));
        await logger.close();

        const files = await listDaemonLogFiles(dir);
        expect(files.length).toBeGreaterThan(1);
        expect(files.every((file) => file.stem === stem)).toBe(true);
        const seqs: number[] = [];
        for (const file of files)
            for (const line of (await fsPromise.readFile(file.path, "utf-8")).trimEnd().split("\n")) seqs.push(JSON.parse(line).seq);
        expect(seqs[seqs.length - 1]).toBe(299);
        expect(seqs[0]).toBeGreaterThan(0);
        // Contiguous: nothing lost between files
        expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => seqs[0] + i));
    });

    it("keeps the files of at most maxStarts daemon starts, counting this one, including old text logs", async () => {
        const dir = randomDirectory();
        const earlier = [
            "bitsocial_cli_daemon_2025-01-01T00-00-00.000Z.log",
            "bitsocial_cli_daemon_2025-02-01T00-00-00.000Z.jsonl",
            "bitsocial_cli_daemon_2025-02-01T00-00-00.000Z.1.jsonl",
            "bitsocial_cli_daemon_2025-03-01T00-00-00.000Z.jsonl"
        ];
        for (const name of earlier) await fsPromise.writeFile(path.join(dir, name), "x\n");
        const logger = await createDaemonFileLogger({ logDir: dir, stem: "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z", maxStarts: 3 });
        logger.writeEntry(entry(1));
        await logger.close();

        const names = (await listDaemonLogFiles(dir)).map((file) => file.name);
        // This start and the 2 newest earlier ones; every file of a start is kept or deleted together
        expect(names).toEqual([
            "bitsocial_cli_daemon_2025-02-01T00-00-00.000Z.jsonl",
            "bitsocial_cli_daemon_2025-02-01T00-00-00.000Z.1.jsonl",
            "bitsocial_cli_daemon_2025-03-01T00-00-00.000Z.jsonl",
            "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z.jsonl"
        ]);
        expect(logger.deletedFiles).toContain("bitsocial_cli_daemon_2025-01-01T00-00-00.000Z.log");
    });

    it("returns false from writeEntry after close so the caller can print the entry instead (regression for #37 bug 2)", async () => {
        const dir = randomDirectory();
        const logger = await createDaemonFileLogger({ logDir: dir, stem: "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z" });
        expect(logger.writeEntry(entry(1))).toBe(true);
        await logger.close();
        expect(logger.writeEntry(entry(2))).toBe(false);
    });

    it("parses file names whose start time contains a dot, with and without a part number", () => {
        expect(parseDaemonLogFileName("bitsocial_cli_daemon_2026-11-13T13-25-40.108Z.jsonl")).toMatchObject({
            stem: "bitsocial_cli_daemon_2026-11-13T13-25-40.108Z",
            part: 0,
            format: "jsonl"
        });
        expect(parseDaemonLogFileName("bitsocial_cli_daemon_2026-11-13T13-25-40.108Z.12.jsonl")).toMatchObject({
            stem: "bitsocial_cli_daemon_2026-11-13T13-25-40.108Z",
            part: 12
        });
        expect(parseDaemonLogFileName("bitsocial_cli_daemon_2026-11-13T13-25-40.108Z.log")).toMatchObject({ format: "log", part: 0 });
        expect(parseDaemonLogFileName("other.jsonl")).toBeUndefined();
    });
    // rotate() ended the previous stream without keeping it, so close() waited for the newest stream only: with part 0
    // still flushing a burst, close() resolved while its entries were not on disk yet
    it("resolves close() only once every rotated file is fully written", async () => {
        const dir = randomDirectory();
        const maxFileBytes = 8_000_000;
        const logger = await createDaemonFileLogger({
            logDir: dir,
            stem: "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z",
            maxFileBytes,
            maxTotalBytes: 10 * maxFileBytes
        });
        // A burst that fills part 0 synchronously, then one small entry in part 1
        const big = (i: number) => entry(i, { msg: `m${i}-`.padEnd(100_000, "x") });
        let written = 0;
        while (written * 100_000 < maxFileBytes - 200_000) logger.writeEntry(big(written++));
        logger.writeEntry(big(written++));
        logger.writeEntry(big(written++));
        logger.writeEntry(entry(written++));
        await logger.close();

        let lines = 0;
        for (const file of await listDaemonLogFiles(dir))
            lines += (await fsPromise.readFile(file.path, "utf-8")).split("\n").filter(Boolean).length;
        expect((await listDaemonLogFiles(dir)).length).toBeGreaterThan(1);
        expect(lines).toBe(written);
    });
});
