import { accidentalBreakingNoteLines } from "./ci-bin/breaking-change-marker.ts";

// A body line that starts with "breaking change" is read as a breaking note by the release tooling and makes
// the next release a minor (docs/versioning.md). Allow it only together with `!` in the header (issue #265).
const breakingNoteNeedsExclamationMark = (parsed) => {
    const lines = accidentalBreakingNoteLines(parsed.raw ?? "");
    return [
        lines.length === 0,
        `this body line is read as a breaking-change note and would bump the minor version: "${lines[0]}". ` +
            'Reword it, or add "!" after the type or scope if the change really is breaking'
    ];
};

export default {
    extends: ["@commitlint/config-conventional"],
    plugins: [{ rules: { "breaking-note-needs-exclamation-mark": breakingNoteNeedsExclamationMark } }],
    rules: { "breaking-note-needs-exclamation-mark": [2, "always"] }
};
