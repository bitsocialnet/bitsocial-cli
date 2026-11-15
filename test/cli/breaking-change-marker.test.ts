import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { directory as randomDirectory } from "tempy";
// The bump calculator release-it uses, through @release-it/conventional-changelog.
import { Bumper } from "conventional-recommended-bump";
import {
    accidentalBreakingNoteLines,
    breakingNoteLines,
    hasBreakingHeader,
    mergeCommitMessage,
    prTitleIsBreakingNote
} from "../../ci-bin/breaking-change-marker.js";

// Issue #265: a commit body line or a pull request title that starts with "breaking change" is read as a
// breaking note by the release tooling and, with preMajor, turns the next release into a minor.

const repoRoot = process.cwd();
const script = path.join(repoRoot, "ci-bin", "breaking-change-marker.ts");
const commitlintCli = path.join(repoRoot, "node_modules", "@commitlint", "cli", "cli.js");
const releaseItConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "config", ".release-it.json"), "utf-8"));
const preset = releaseItConfig.plugins["@release-it/conventional-changelog"].preset;

// The Bumper runs git with this process's environment, and every git call below must only see the temp repo:
// GIT_DIR and friends would point them at the developer's repository when the suite runs from a git hook.
for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
process.env["GIT_CONFIG_GLOBAL"] = process.platform === "win32" ? "NUL" : "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
        cwd,
        stdio: "pipe",
        encoding: "utf-8"
    });

const newRepo = () => {
    const repo = randomDirectory();
    git(repo, "init", "-q", "-b", "master");
    git(repo, "commit", "-q", "--allow-empty", "-m", "chore: init");
    git(repo, "tag", "v0.1.0");
    return repo;
};

const releaseTypeOf = async (repo: string): Promise<string | undefined> => {
    // The same calls @release-it/conventional-changelog makes in getRecommendedVersion().
    const bumper = new Bumper(repo);
    const loaded = await (bumper.loadPreset(preset) as any).preset;
    return (await bumper.bump(loaded.whatBump || loaded.recommendedBumpOpts.whatBump)).releaseType;
};

// [commit message, is the next release a minor?]
const samples: [string, boolean][] = [
    ["fix: a\n\nBreaking change in the parser: now strict", true],
    ["fix: a\n\n* breaking-change: bullets count", true],
    ["fix: a\n\n  | BREAKING CHANGE a space instead of a colon", true],
    ["fix: a\n\nBREAKING CHANGE: the documented footer", true],
    ["fix: a\n\nsome text\n\nmore text\nbreaking change: deep in the body", true],
    ["feat!: header marker only", true],
    ["feat(scope)!: header and footer\n\nBREAKING CHANGE: both", true],
    [mergeCommitMessage("Breaking change handling for X"), true],
    ["fix: a\n\nthis is not a breaking change: the words are mid-line", false],
    ["fix: a\n\nBreaking changes: the plural is not a keyword", false],
    ["fix: a\n\nbreakingchange: no separator", false],
    ["feat: a plain feature", false],
    [mergeCommitMessage("docs: describe breaking change handling"), false]
];

describe("breaking-change marker guard", () => {
    let repo: string;
    beforeAll(() => {
        repo = newRepo();
    });
    afterAll(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it("agrees with the bump release-it computes for every sample", async () => {
        let patch = 0;
        for (const [message, breaking] of samples) {
            git(repo, "commit", "-q", "--allow-empty", "-m", message);
            const releaseType = await releaseTypeOf(repo);
            expect(releaseType, message).toBe(breaking ? "minor" : "patch");
            expect(breakingNoteLines(message).length > 0 || hasBreakingHeader(message), message).toBe(breaking);
            // Start the next sample from a clean range.
            git(repo, "tag", `v0.1.${++patch}`);
        }
    });

    it("release-it counts a real merge commit whose body is the pull request title", async () => {
        const merged = newRepo();
        try {
            git(merged, "checkout", "-q", "-b", "topic");
            git(merged, "commit", "-q", "--allow-empty", "-m", "test: add a case");
            git(merged, "checkout", "-q", "master");
            const title = "Breaking change handling for X";
            git(merged, "merge", "-q", "--no-ff", "topic", "-m", "Merge pull request #1 from owner/topic", "-m", title);
            expect(await releaseTypeOf(merged)).toBe("minor");
        } finally {
            fs.rmSync(merged, { recursive: true, force: true });
        }
    });

    it("flags a marker only when the header has no exclamation mark", () => {
        const line = "Breaking change in the parser: now strict";
        expect(accidentalBreakingNoteLines(`fix: a\n\n${line}`)).toEqual([line]);
        expect(accidentalBreakingNoteLines("feat(daemon)!: move the endpoint\n\nBREAKING CHANGE: update your URL")).toEqual([]);
        expect(accidentalBreakingNoteLines("fix: a\n\nnot a breaking change: mid-line")).toEqual([]);
    });

    it("flags a pull request title that becomes a breaking note in the merge commit", () => {
        expect(prTitleIsBreakingNote("Breaking change handling for X")).toBe(true);
        expect(prTitleIsBreakingNote("breaking-change: lower case and hyphenated")).toBe(true);
        expect(prTitleIsBreakingNote("feat!: an intentional breaking change")).toBe(false);
        expect(prTitleIsBreakingNote("docs: add CONTRIBUTING.md and a versioning and release guide")).toBe(false);
    });

    describe("commitlint", () => {
        const lint = (message: string) =>
            spawnSync(process.execPath, [commitlintCli], { cwd: repoRoot, input: message, encoding: "utf-8" });

        it("rejects a body line that is read as a breaking note without ! in the header", () => {
            const result = lint("fix(x): tighten the parser\n\nBreaking change in the parser: now strict\n");
            expect(result.status).toBe(1);
            expect(result.stdout).toContain("breaking-note-needs-exclamation-mark");
        });

        it("accepts an intentional breaking change and an ordinary commit", () => {
            expect(lint("feat(daemon)!: move the RPC endpoint\n\nBREAKING CHANGE: update the URL in your clients\n").status).toBe(0);
            expect(lint("fix(x): tighten the parser\n\nThe body mentions a breaking change mid-line.\n").status).toBe(0);
        });
    });

    describe("command line", () => {
        const run = (args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
            spawnSync(process.execPath, ["--no-warnings", script, ...args], {
                cwd: options.cwd ?? repoRoot,
                env: { ...process.env, ...options.env },
                encoding: "utf-8"
            });

        it("check-pr-title fails for a title that would bump the minor", () => {
            const bad = run(["check-pr-title"], { env: { PR_TITLE: "Breaking change handling for X" } });
            expect(bad.status).toBe(1);
            expect(bad.stderr).toContain("Breaking change handling for X");
            expect(run(["check-pr-title"], { env: { PR_TITLE: "fix(reachability): report unmanaged WSS addresses" } }).status).toBe(0);
        });

        it("check-commits fails when a commit in the range has an accidental marker", () => {
            const checked = newRepo();
            try {
                git(checked, "commit", "-q", "--allow-empty", "-m", "feat(daemon)!: move the endpoint\n\nBREAKING CHANGE: update your URL");
                expect(run(["check-commits", "v0.1.0..HEAD"], { cwd: checked }).status).toBe(0);
                git(checked, "commit", "-q", "--allow-empty", "-m", "fix: a\n\nBreaking change in the parser: now strict");
                const bad = run(["check-commits", "v0.1.0..HEAD"], { cwd: checked });
                expect(bad.status).toBe(1);
                expect(bad.stderr).toContain("Breaking change in the parser: now strict");
            } finally {
                fs.rmSync(checked, { recursive: true, force: true });
            }
        });
    });
});
