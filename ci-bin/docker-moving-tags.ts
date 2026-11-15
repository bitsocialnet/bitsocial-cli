// Decides which moving Docker tags a Docker Publish run may push (issue #266).
//
// Docker Publish can be re-run for an existing release tag. Pushing `latest`, `<major>` and `<major>.<minor>`
// on such a run would point them at the older image and downgrade operators who pull them. Each moving tag is
// pushed only when the release being published is the newest one that tag stands for:
//
//   latest           newest stable release overall
//   <major>          newest stable release with that major
//   <major>.<minor>  newest stable release with that major and minor
//
// Usage (see .github/workflows/docker-publish.yml):
//   git tag --list | RELEASE_TAG=v0.19.57 node ci-bin/docker-moving-tags.ts >> "$GITHUB_OUTPUT"
//
// This file is run directly by Node's type stripping, without npm ci, so it must stay dependency-free and use
// only erasable TypeScript syntax.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export interface MovingTags {
    latest: boolean;
    major: boolean;
    minor: boolean;
}

type Version = [major: number, minor: number, patch: number];

/** Parses a stable `vX.Y.Z` or `X.Y.Z` tag. Pre-releases and anything else return undefined. */
export const parseStableTag = (tag: string): Version | undefined => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

const isNewer = (a: Version, b: Version): boolean => {
    if (a[0] !== b[0]) return a[0] > b[0];
    if (a[1] !== b[1]) return a[1] > b[1];
    return a[2] > b[2];
};

/** `allTags` is every tag in the repository; tags that are not stable releases are ignored. */
export const movingTagsFor = (releaseTag: string, allTags: string[]): MovingTags => {
    const release = parseStableTag(releaseTag);
    // A pre-release never moves a tag that operators follow.
    if (!release) return { latest: false, major: false, minor: false };
    const newer = allTags.map(parseStableTag).filter((version): version is Version => version !== undefined && isNewer(version, release));
    return {
        latest: newer.length === 0,
        major: !newer.some((version) => version[0] === release[0]),
        minor: !newer.some((version) => version[0] === release[0] && version[1] === release[1])
    };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const releaseTag = process.env["RELEASE_TAG"] ?? "";
    if (!releaseTag) {
        console.error("RELEASE_TAG is not set");
        process.exitCode = 2;
    } else {
        const moving = movingTagsFor(releaseTag, fs.readFileSync(0, "utf-8").split(/\r?\n/));
        process.stdout.write(`latest=${moving.latest}\nmajor=${moving.major}\nminor=${moving.minor}\n`);
    }
}
