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

    // Issue #266
    it("Docker Publish pushes each moving tag only when ci-bin/docker-moving-tags.ts allows it", () => {
        const text = workflow("docker-publish.yml");
        // A re-run checks out the old release, which may predate the script, so the decision is made in a job
        // of its own that checks out the commit the workflow runs from.
        const start = text.indexOf("\n  moving-tags:");
        const decide = text.slice(start, text.indexOf("\n  docker-push:"));
        expect(start).toBeGreaterThan(-1);
        expect(decide).toContain("node --no-warnings ci-bin/docker-moving-tags.ts");
        expect(decide).toContain("fetch-depth: 0");
        expect(decide).not.toMatch(/^\s+ref:/m);
        // Without this, metadata-action adds `latest` on its own for every semver tag.
        expect(text).toMatch(/flavor: \|\s+latest=false/);
        expect(text).toMatch(/type=semver,pattern=\{\{major\}\}\.\{\{minor\}\},.*enable=\$\{\{ needs\.moving-tags\.outputs\.minor \}\}/);
        expect(text).toMatch(/type=semver,pattern=\{\{major\}\},.*enable=\$\{\{ needs\.moving-tags\.outputs\.major \}\}/);
        expect(text).toMatch(/type=raw,value=latest,enable=\$\{\{ needs\.moving-tags\.outputs\.latest \}\}/);
    });

    // Issue #265
    it("pull requests are checked for accidental breaking-change markers, also when the title is edited", () => {
        const text = workflow("commit-messages.yml");
        expect(text).toMatch(/types: \[.*\bedited\b.*\]/);
        expect(text).toContain("PR_TITLE: ${{ github.event.pull_request.title }}");
        expect(text).toContain("ci-bin/breaking-change-marker.ts check-pr-title");
        expect(text).toContain("ci-bin/breaking-change-marker.ts check-commits");
    });
});
