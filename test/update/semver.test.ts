import { describe, it, expect } from "vitest";
import { compareVersions } from "../../src/update/semver.js";

describe("compareVersions", () => {
    it("returns -1 when a < b", () => {
        expect(compareVersions("0.19.39", "0.19.40")).toBe(-1);
        expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
        expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    });

    it("returns 1 when a > b", () => {
        expect(compareVersions("0.19.40", "0.19.39")).toBe(1);
        expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    });

    it("returns 0 when equal", () => {
        expect(compareVersions("0.19.39", "0.19.39")).toBe(0);
        expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("strips leading v", () => {
        expect(compareVersions("v0.19.39", "0.19.39")).toBe(0);
        expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
        expect(compareVersions("v0.19.39", "v0.19.40")).toBe(-1);
    });

    it("handles different segment counts", () => {
        expect(compareVersions("1.0", "1.0.0")).toBe(0);
        expect(compareVersions("1.0.1", "1.0")).toBe(1);
    });
});
