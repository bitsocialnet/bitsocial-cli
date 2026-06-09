import { describe, it, expect } from "vitest";
import { systemctlRestart } from "../../dist/update/systemctl.js";

// The actual side effect `update install` uses to restart a supervised daemon (issue #82).

describe("systemctlRestart", () => {
    it("invokes `systemctl restart <unit>`", async () => {
        const calls: Array<[string, string[]]> = [];
        await systemctlRestart("bitsocial.service", async (cmd, args) => {
            calls.push([cmd, args]);
            return undefined;
        });
        expect(calls).toEqual([["systemctl", ["restart", "bitsocial.service"]]]);
    });

    it("propagates the failure when systemctl fails (so the caller can surface it)", async () => {
        await expect(
            systemctlRestart("bitsocial.service", async () => {
                throw new Error("Failed to restart: Access denied");
            })
        ).rejects.toThrow(/Access denied/);
    });
});
