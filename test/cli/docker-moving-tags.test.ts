import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { movingTagsFor, parseStableTag } from "../../ci-bin/docker-moving-tags.js";

// Issue #266: re-running Docker Publish for an older release must not move `latest`, `<major>` or
// `<major>.<minor>` back to that release.

const tags = ["v0.18.9", "v0.19.0", "v0.19.57", "v0.19.137", "v0.20.0", "v0.20.1", "v1.0.0-rc.1", "not-a-version"];

describe("moving Docker tags", () => {
    it("pushes every moving tag for the newest release", () => {
        expect(movingTagsFor("v0.20.1", tags)).toEqual({ latest: true, major: true, minor: true });
    });

    it("pushes no moving tag for an older release in a minor line that has a newer one", () => {
        expect(movingTagsFor("v0.19.57", tags)).toEqual({ latest: false, major: false, minor: false });
    });

    it("pushes only <major>.<minor> for the newest release of an older minor line", () => {
        expect(movingTagsFor("v0.19.137", tags)).toEqual({ latest: false, major: false, minor: true });
        expect(movingTagsFor("v0.18.9", tags)).toEqual({ latest: false, major: false, minor: true });
    });

    it("keeps <major> for the newest release of an older major", () => {
        expect(movingTagsFor("v0.20.1", [...tags, "v1.0.0", "v1.0.1"])).toEqual({ latest: false, major: true, minor: true });
    });

    it("compares numerically, not as text", () => {
        expect(movingTagsFor("v0.19.9", ["v0.19.9", "v0.19.10"])).toEqual({ latest: false, major: false, minor: false });
        expect(movingTagsFor("v0.19.10", ["v0.19.9", "v0.19.10"])).toEqual({ latest: true, major: true, minor: true });
    });

    it("ignores pre-releases and never moves a tag for one", () => {
        expect(parseStableTag("v1.0.0-rc.1")).toBeUndefined();
        expect(movingTagsFor("v1.0.0-rc.1", tags)).toEqual({ latest: false, major: false, minor: false });
    });

    it("prints the flags as step outputs", () => {
        const result = spawnSync(process.execPath, ["--no-warnings", path.join(process.cwd(), "ci-bin", "docker-moving-tags.ts")], {
            input: tags.join("\n") + "\n",
            env: { ...process.env, RELEASE_TAG: "v0.19.137" },
            encoding: "utf-8"
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("latest=false\nmajor=false\nminor=true\n");
    });
});
