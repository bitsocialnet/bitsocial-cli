import { describe, expect, it } from "vitest";
import { renderBanner } from "../../dist/cli/ascii-banner.js";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

describe("ASCII banner", () => {
    it("renders plain readable output when color is disabled", () => {
        const banner = renderBanner({ env: { NO_COLOR: "1" }, stdoutIsTTY: true });

        expect(banner).not.toMatch(ANSI_PATTERN);
        expect(banner).toContain("888888b.");
        expect(banner).toContain("⣿");
    });

    it("uses only a blue accent and terminal default foreground in color mode", () => {
        const banner = renderBanner({ env: {}, stdoutIsTTY: true });

        expect(banner).toContain("\x1b[94m");
        expect(banner).toContain("\x1b[39m");
        expect(banner).not.toContain("\x1b[38;2;229;231;235m");
    });

    it("keeps non-TTY output plain unless color is forced", () => {
        const banner = renderBanner({ env: {}, stdoutIsTTY: false });

        expect(banner).not.toMatch(ANSI_PATTERN);
    });

    it("supports forced color for captured terminal logs", () => {
        const banner = renderBanner({ env: {}, forceColor: true, stdoutIsTTY: false });

        expect(banner).toContain("\x1b[94m");
    });

    it("supports FORCE_COLOR for standard CLI color control", () => {
        const banner = renderBanner({ env: { FORCE_COLOR: "1" }, stdoutIsTTY: false });

        expect(banner).toContain("\x1b[94m");
    });

    it("lets FORCE_COLOR=0 disable color", () => {
        const banner = renderBanner({ env: { FORCE_COLOR: "0" }, stdoutIsTTY: true });

        expect(banner).not.toMatch(ANSI_PATTERN);
    });
});
