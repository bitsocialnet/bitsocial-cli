import { describe, it, expect } from "vitest";
import { directory as randomDirectory } from "tempy";
import fsPromise from "fs/promises";
import path from "path";
import PKC from "@pkcprotocol/pkc-js";
import { loadChallengesIntoPKC } from "../../src/challenge-packages/challenge-utils.js";

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
});
