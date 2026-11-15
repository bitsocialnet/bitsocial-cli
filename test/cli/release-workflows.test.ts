import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// The release workflows cannot be run from a test. These checks pin the lines the release safety depends on,
// so removing one fails here instead of in a release.

const workflow = (name: string) => fs.readFileSync(path.join(process.cwd(), ".github", "workflows", name), "utf-8");

describe("release workflows", () => {
    // Issue #267: the workflow_run `branches` filter matches the branch the CI run ran on, which for a pull
    // request is the head branch, so a pull request from a branch named master would pass it.
    it("CI build releases only after a successful CI run for a push", () => {
        const condition = workflow("CI-build.yml")
            .split("\n")
            .find((line) => line.trim().startsWith("if:") && line.includes("workflow_run.conclusion"));
        expect(condition).toBeDefined();
        expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
        expect(condition).toContain("github.event.workflow_run.event == 'push'");
        expect(condition).not.toContain("||");
    });
});
