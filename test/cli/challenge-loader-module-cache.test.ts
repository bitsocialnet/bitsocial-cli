import { describe, it, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import PKC from "@pkcprotocol/pkc-js";
import { loadChallengesIntoPKC, hashChallengePackageContents } from "../../src/challenge-packages/challenge-utils.js";

// Issue #124: loadChallengesIntoPKC() imports every package from the same entry URL on
// every reload. Node caches ESM modules by URL, so replacing a package in place (what
// `bitsocial challenge install` does for an already-installed name) leaves the daemon
// running the previously evaluated module even though package.json reports the new version.

const CHALLENGE_NAME = "test-challenge-module-cache";

const writeChallengePackage = async (
    dir: string,
    opts: { version: string; challenge: string; answer: string }
): Promise<void> => {
    await fsPromise.mkdir(dir, { recursive: true });
    await fsPromise.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: CHALLENGE_NAME, version: opts.version, type: "module" }, null, 2)
    );
    await fsPromise.writeFile(
        path.join(dir, "index.js"),
        `export default function() {
    return {
        type: 'text/plain',
        challenge: '${opts.challenge}',
        getChallenge: async () => ({
            challenge: '${opts.challenge}',
            type: 'text/plain',
            verify: async (answer) => ({ success: answer === '${opts.answer}' })
        })
    };
};
`
    );
};

// Replace the installed package the same way `challenge install` does: build the new
// version elsewhere, then swap it into the destination path (same path, new contents).
const installChallengePackage = async (
    challengesDir: string,
    opts: { version: string; challenge: string; answer: string }
): Promise<void> => {
    const destDir = path.join(challengesDir, CHALLENGE_NAME);
    const stagingDir = path.join(challengesDir, `.staging-${opts.version}`);
    await writeChallengePackage(stagingDir, opts);
    await fsPromise.rm(destDir, { recursive: true, force: true });
    await fsPromise.rename(stagingDir, destDir);
};

const getLoadedFactory = () => (PKC as any).challenges[CHALLENGE_NAME];

const getActiveChallengeText = (): string => getLoadedFactory()({ challengeSettings: { name: CHALLENGE_NAME } }).challenge;

const verifyWithActiveChallenge = async (answer: string): Promise<boolean> => {
    const challengeFile = getLoadedFactory()({ challengeSettings: { name: CHALLENGE_NAME } });
    const challenge = await challengeFile.getChallenge();
    return (await challenge.verify(answer)).success;
};

describe("loadChallengesIntoPKC module cache", { timeout: 60_000 }, () => {
    it("activates the new code when a package is replaced under the same name", async () => {
        const dataPath = randomDirectory();
        const challengesDir = path.join(dataPath, "challenges");
        await fsPromise.mkdir(challengesDir, { recursive: true });

        // v1 installed and loaded
        await installChallengePackage(challengesDir, { version: "1.0.0", challenge: "1+1", answer: "2" });
        const firstLoad = await loadChallengesIntoPKC(dataPath);
        expect(firstLoad.map((c) => `${c.name}@${c.version}`)).toEqual([`${CHALLENGE_NAME}@1.0.0`]);
        expect(getActiveChallengeText()).toBe("1+1");
        expect(await verifyWithActiveChallenge("2")).toBe(true);

        // v2 replaces it at the same path, then a reload happens (no process restart)
        await installChallengePackage(challengesDir, { version: "2.0.0", challenge: "3+3", answer: "6" });
        const secondLoad = await loadChallengesIntoPKC(dataPath);

        // The reported version and the active factory must agree
        expect(secondLoad.map((c) => `${c.name}@${c.version}`)).toEqual([`${CHALLENGE_NAME}@2.0.0`]);
        expect(getActiveChallengeText()).toBe("3+3");
        expect(await verifyWithActiveChallenge("6")).toBe(true);
        expect(await verifyWithActiveChallenge("2")).toBe(false);
    });

    it("keeps behavior stable when reloading unchanged package contents", async () => {
        const dataPath = randomDirectory();
        const challengesDir = path.join(dataPath, "challenges");
        await fsPromise.mkdir(challengesDir, { recursive: true });

        await installChallengePackage(challengesDir, { version: "1.0.0", challenge: "4+4", answer: "8" });
        await loadChallengesIntoPKC(dataPath);
        const factoryAfterFirstLoad = getLoadedFactory();

        await loadChallengesIntoPKC(dataPath);
        await loadChallengesIntoPKC(dataPath);

        expect(getActiveChallengeText()).toBe("4+4");
        expect(await verifyWithActiveChallenge("8")).toBe(true);
        // Unchanged contents must not create a fresh module instance on every reload
        expect(getLoadedFactory()).toBe(factoryAfterFirstLoad);
    });

    // The content key skipped dot-prefixed entries, so a package whose pkg.main points into a
    // dot directory kept its old import URL across a same-version replacement — the version
    // never changes either, so nothing busted the cache and the stale module stayed active.
    it("activates new code when a dot-path entry is replaced at the same version", async () => {
        const dataPath = randomDirectory();
        const challengeDir = path.join(dataPath, "challenges", CHALLENGE_NAME);

        const installDotPathEntry = async (challenge: string): Promise<void> => {
            await fsPromise.rm(challengeDir, { recursive: true, force: true });
            await fsPromise.mkdir(path.join(challengeDir, ".dist"), { recursive: true });
            await fsPromise.writeFile(
                path.join(challengeDir, "package.json"),
                JSON.stringify({ name: CHALLENGE_NAME, version: "1.0.0", type: "module", main: ".dist/index.js" }, null, 2)
            );
            await fsPromise.writeFile(
                path.join(challengeDir, ".dist", "index.js"),
                `export default function() {
    return {
        type: 'text/plain',
        challenge: '${challenge}',
        getChallenge: async () => ({ challenge: '${challenge}', type: 'text/plain', verify: async () => ({ success: true }) })
    };
};
`
            );
        };

        await installDotPathEntry("1+1");
        await loadChallengesIntoPKC(dataPath);
        expect(getActiveChallengeText()).toBe("1+1");

        // Same version, new entry contents — `challenge install` allows this (reinstall replaces
        // content even when the version is unchanged)
        await installDotPathEntry("3+3");
        await loadChallengesIntoPKC(dataPath);
        expect(getActiveChallengeText()).toBe("3+3");
    });
});

describe("hashChallengePackageContents", () => {
    const writeFiles = async (dir: string, files: Record<string, string>): Promise<string> => {
        await fsPromise.rm(dir, { recursive: true, force: true });
        for (const [relativePath, contents] of Object.entries(files)) {
            const filePath = path.join(dir, relativePath);
            await fsPromise.mkdir(path.dirname(filePath), { recursive: true });
            await fsPromise.writeFile(filePath, contents);
        }
        return dir;
    };

    it("distinguishes contents that share a concatenated byte stream", async () => {
        // Hashing `path` then raw `contents` back to back is ambiguous: these two package
        // states feed the identical stream "index.js" "A" "j" "Z" vs "index.js" "AjZ"
        const root = randomDirectory();
        const split = await writeFiles(path.join(root, "split"), { "index.js": "A", j: "Z" });
        const merged = await writeFiles(path.join(root, "merged"), { "index.js": "AjZ" });

        expect(await hashChallengePackageContents(split)).not.toBe(await hashChallengePackageContents(merged));
    });

    it("is stable for identical contents and changes when a file changes", async () => {
        const root = randomDirectory();
        const first = await writeFiles(path.join(root, "first"), { "index.js": "A", "lib/helper.js": "B" });
        const same = await writeFiles(path.join(root, "same"), { "index.js": "A", "lib/helper.js": "B" });
        const changed = await writeFiles(path.join(root, "changed"), { "index.js": "A", "lib/helper.js": "C" });

        expect(await hashChallengePackageContents(first)).toBe(await hashChallengePackageContents(same));
        expect(await hashChallengePackageContents(first)).not.toBe(await hashChallengePackageContents(changed));
    });

    it("ignores node_modules so reloads do not walk the dependency tree", async () => {
        const root = randomDirectory();
        const withoutDeps = await writeFiles(path.join(root, "without"), { "index.js": "A" });
        const withDeps = await writeFiles(path.join(root, "with"), { "index.js": "A", "node_modules/dep/index.js": "anything" });

        expect(await hashChallengePackageContents(withoutDeps)).toBe(await hashChallengePackageContents(withDeps));
    });
});
