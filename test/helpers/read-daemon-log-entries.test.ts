import { describe, it, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import { readDaemonLogEntries } from "./daemon-helpers.js";

describe("readDaemonLogEntries", () => {
    // Tests poll a live daemon's file, so a read can end partway through the line the daemon is writing
    it("skips a last line the daemon has not finished writing", async () => {
        const dir = randomDirectory();
        const complete = { seq: 1, time: 1, level: "log", namespace: "a", msg: "done", tags: {} };
        await fsPromise.writeFile(
            path.join(dir, "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z.jsonl"),
            JSON.stringify(complete) + "\n" + '{"seq":2,"time":2,"lev'
        );
        expect(await readDaemonLogEntries(dir)).toEqual([complete]);
    });

    it("still fails on a malformed line that is complete", async () => {
        const dir = randomDirectory();
        await fsPromise.writeFile(path.join(dir, "bitsocial_cli_daemon_2026-01-01T00-00-00.000Z.jsonl"), "not json\n");
        await expect(readDaemonLogEntries(dir)).rejects.toThrow();
    });
});
