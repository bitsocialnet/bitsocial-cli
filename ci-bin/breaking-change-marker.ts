// Guard against accidental breaking-change markers (issue #265).
//
// release-it reads every commit since the last tag, merge commits included. The conventional-commits parser
// treats any line after the header that matches BREAKING_NOTE_PATTERN as a breaking note, and with
// `preMajor: true` one such note makes the next release a minor. A body line such as "Breaking change in X: ..."
// or a pull request titled "Breaking change handling for X" (GitHub puts the title in the merge commit body)
// is enough. See docs/versioning.md.
//
// A marker is accepted only when the commit header also carries `!` after the type or scope, which is how an
// intentional breaking change is written.
//
// Usage:
//   PR_TITLE="..." node ci-bin/breaking-change-marker.ts check-pr-title
//   node ci-bin/breaking-change-marker.ts check-commits <git revision range>
//
// This file is run directly by Node's type stripping in .github/workflows/commit-messages.yml (no npm ci), so
// it must stay dependency-free and use only erasable TypeScript syntax. commitlint.config.mjs imports it too.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Same pattern conventional-commits-parser builds from the preset's noteKeywords (`BREAKING CHANGE`,
// `BREAKING-CHANGE`). test/cli/breaking-change-marker.test.ts checks this file against the bump release-it
// computes, so a parser upgrade that changes the pattern fails the tests.
export const BREAKING_NOTE_PATTERN = /^[\s|*]*(BREAKING CHANGE|BREAKING-CHANGE)[:\s]+(.*)/i;

// `feat!: ...` or `feat(scope)!: ...`, as in the conventionalcommits preset.
export const BREAKING_HEADER_PATTERN = /^(\w*)(?:\((.*)\))?!: (.*)$/;

const messageLines = (message: string): string[] => message.trim().split(/\r?\n/);

/** Lines after the header that the release tooling reads as a breaking note. */
export const breakingNoteLines = (message: string): string[] =>
    messageLines(message)
        .slice(1)
        .filter((line) => BREAKING_NOTE_PATTERN.test(line));

export const hasBreakingHeader = (message: string): boolean => BREAKING_HEADER_PATTERN.test(messageLines(message)[0] ?? "");

/** Breaking-note lines in a commit whose header does not declare a breaking change with `!`. */
export const accidentalBreakingNoteLines = (message: string): string[] => (hasBreakingHeader(message) ? [] : breakingNoteLines(message));

/** The message GitHub writes for a merge commit: the pull request title becomes the body. */
export const mergeCommitMessage = (prTitle: string): string => `Merge pull request #0 from owner/branch\n\n${prTitle}`;

/** True when merging a pull request with this title would make the next release a minor. */
export const prTitleIsBreakingNote = (prTitle: string): boolean => breakingNoteLines(mergeCommitMessage(prTitle)).length > 0;

const explain = "With preMajor this makes the next release a minor. See docs/versioning.md#what-counts-as-a-breaking-change-marker.";

const checkPrTitle = (title: string): number => {
    if (!prTitleIsBreakingNote(title)) return 0;
    console.error(`The pull request title is read as a breaking-change note once it is merged:\n\n    ${title}\n`);
    console.error(`${explain}\nReword the title so that it does not start with "breaking change".`);
    return 1;
};

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf-8" });

const checkCommits = (range: string): number => {
    const hashes = git("log", "--format=%H", range).split("\n").filter(Boolean);
    let failures = 0;
    for (const hash of hashes) {
        const message = git("log", "-1", "--format=%B", hash);
        const lines = accidentalBreakingNoteLines(message);
        if (lines.length === 0) continue;
        failures++;
        console.error(`${hash.slice(0, 7)} ${messageLines(message)[0]}`);
        for (const line of lines) console.error(`    ${line}`);
    }
    if (failures === 0) return 0;
    console.error(`\n${failures} commit(s) have a body line that is read as a breaking-change note, without "!" in the header.`);
    console.error(`${explain}\nReword the line, or add "!" after the type or scope if the change really is breaking.`);
    return 1;
};

const main = (argv: string[]): number => {
    const [command, ...rest] = argv;
    if (command === "check-pr-title") return checkPrTitle(process.env["PR_TITLE"] ?? "");
    if (command === "check-commits" && rest[0]) return checkCommits(rest[0]);
    console.error(`Usage: ${path.basename(process.argv[1] ?? "breaking-change-marker.ts")} <check-pr-title | check-commits <range>>`);
    return 2;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
