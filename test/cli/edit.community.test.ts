import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
//@ts-ignore
import Sinon from "sinon";
import { file as tempFile } from "tempy";
import fsPromises from "fs/promises";
import type { CommunityEditOptions } from "../types/communityTypes.js";
import { currentSubProps } from "../fixtures/communityForEditFixture.js";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community edit", () => {
    const sandbox = Sinon.createSandbox();

    const editFake = sandbox.fake();

    const runEditCommand = (args: string) => runCliCommand(args);

    beforeAll(() => {
        const pkcInstanceFake = sandbox.fake.resolves({
            createCommunity: sandbox.fake.resolves({
                edit: editFake,
                ...currentSubProps,
                toJSONInternalRpc: () => JSON.parse(JSON.stringify(currentSubProps))
            }),
            communities: ["plebbit.bso"],
            destroy: () => {}
        });
        setPkcRpcConnectOverride(pkcInstanceFake);
    });

    afterEach(() => editFake.resetHistory());
    afterAll(() => {
        clearPkcRpcConnectOverride();
        sandbox.restore();
    });

    // passing string flag

    it(`Can pass a string value to a first level flag`, async () => {
        const { result } = await runEditCommand(
            'community edit plebbit.bso --title "new Title" --name newName.bso --description "new Description" --pubsubTopic "new Pubsub topic"'
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("new Title");
        expect(parsedArgs.description).toBe("new Description");
        expect(parsedArgs.pubsubTopic).toBe("new Pubsub topic");
        expect(parsedArgs.name).toBe("newName.bso");
    });

    it(`Can set a string value to a nested prop`, async () => {
        const { result } = await runEditCommand('community edit plebbit.bso --suggested.secondaryColor "new suggested.secondaryColor"');
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        expect(mergedEditOptions.suggested!.secondaryColor).toBe("new suggested.secondaryColor");
    });

    // passing array flags

    it(`Can pass flag to set specific indices in an array`, async () => {
        const { result } = await runEditCommand(
            'community edit plebbit.bso --rules[2] "User input Rule 3" --rules[3] "User input Rule 4"'
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const argsOfSubEdit = <CommunityEditOptions>editFake.args[0][0];
        const mergedRules = <string[]>argsOfSubEdit["rules"]; // merging the input from user and current state of sub

        expect(mergedRules).toEqual([
            currentSubProps.rules?.[0],
            currentSubProps.rules?.[1],
            "User input Rule 3",
            "User input Rule 4"
        ]);
    });

    it("A single flag name being passed multiple times equates to an array", async () => {
        const { result } = await runEditCommand('community edit plebbit.bso --rules "New Rule1 random" --rules "New Rule2 random"');
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        const mergedRulesAfterEdit = <string[]>mergedEditOptions["rules"];
        expect(mergedRulesAfterEdit).toEqual([
            "New Rule1 random",
            "New Rule2 random",
            currentSubProps.rules![2],
            currentSubProps.rules![3]
        ]);
    });

    it(`Can pass nested array elements in a nested field`, async () => {
        const { result } = await runEditCommand(
            'community edit plebbit.bso --settings.challenges[1].options.question "What is the password" --settings.challenges[1].options.answer "The password"'
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        expect(typeof mergedEditOptions.settings).toBe("object");

        // test for settings.challenges here
        expect(mergedEditOptions.settings?.challenges![0]).toEqual(currentSubProps.settings?.challenges![0]); // should not change since we're only modifying challenge[1]

        // should add new challenge
        expect(mergedEditOptions.settings?.challenges![1]).toEqual({
            options: { question: "What is the password", answer: "The password" }
        });
    });

    // TODO Add a test for trying to edit a non local sub

    // Setting boolean fields

    it(`Can set a boolean field to true on first level (implicit)`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --randomBooleanField");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        const randomBoolean = (mergedEditOptions as Record<string, unknown>)["randomBooleanField"];
        expect(randomBoolean).toBe(true);
    });

    it(`Can set a boolean field to true on first level (explicit)`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --randomBooleanField=true");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        const randomBoolean = (mergedEditOptions as Record<string, unknown>)["randomBooleanField"];
        expect(randomBoolean).toBe(true);
    });

    it("Can parse boolean=true in nested props correctly (implicit)", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings.fetchThumbnailUrls");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        expect(typeof mergedEditOptions.settings).toBe("object");
        expect(mergedEditOptions.settings!.fetchThumbnailUrls).toBe(true);
    });

    it("Can parse boolean=true in nested props correctly (explicit)", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings.fetchThumbnailUrls=true");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        expect(typeof mergedEditOptions.settings).toBe("object");
        expect(mergedEditOptions.settings!.fetchThumbnailUrls).toBe(true);
    });

    // setting boolean = false

    it(`Can set a boolean field to false on first level (explicit)`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --randomBooleanField=false");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        const randomBoolean = (mergedEditOptions as Record<string, unknown>)["randomBooleanField"];
        expect(randomBoolean).toBe(false);
    });

    it("Can parse boolean=false in nested props correctly (explicit)", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings.fetchThumbnailUrls=false");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        expect(typeof mergedEditOptions.settings).toBe("object");
        expect(mergedEditOptions.settings!.fetchThumbnailUrls).toBe(false);
    });

    // Setting null

    it(`Preserves string values that start with a number`, async () => {
        const { result } = await runEditCommand(
            'community edit plebbit.bso --rules[0] "1. First rule text" --rules[1] "2. Second rule text"'
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];
        const mergedRules = <string[]>mergedEditOptions["rules"];
        expect(mergedRules[0]).toBe("1. First rule text");
        expect(mergedRules[1]).toBe("2. Second rule text");
    });

    it(`Converts null to undefined for a nested role flag`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --roles['rinse12.bso'] null");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];

        expect(mergedEditOptions.roles!["rinse12.bso"]).toBeUndefined();
        // Other roles should be preserved
        expect(mergedEditOptions.roles!["estebanabaroa.eth"]).toEqual(currentSubProps.roles!["estebanabaroa.eth"]);
        expect(mergedEditOptions.roles!["plebeius.eth"]).toEqual(currentSubProps.roles!["plebeius.eth"]);
    });

    it(`Converts null to undefined for a top-level flag`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --description null");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];

        expect(mergedEditOptions.description).toBeUndefined();
    });

    it("Converts null to undefined for a whole nested object", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings null");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];

        expect(mergedEditOptions.settings).toBeUndefined();
    });

    it("Handles mixed null and non-null roles (remove .eth, add .bso)", async () => {
        const { result } = await runEditCommand(
            `community edit plebbit.bso --roles['estebanabaroa.eth'] null --roles['estebanabaroa.bso'].role admin`
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];

        // .eth role should be removed (undefined)
        expect(mergedEditOptions.roles!["estebanabaroa.eth"]).toBeUndefined();
        // .bso role should be added
        expect(mergedEditOptions.roles!["estebanabaroa.bso"]).toEqual({ role: "admin" });
        // Other roles untouched
        expect(mergedEditOptions.roles!["rinse12.bso"]).toEqual(currentSubProps.roles!["rinse12.bso"]);
        expect(mergedEditOptions.roles!["plebeius.eth"]).toEqual(currentSubProps.roles!["plebeius.eth"]);
    });

    it("Converts null to undefined for roles in a JSON file", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(
            jsonPath,
            JSON.stringify({
                roles: {
                    "rinse12.bso": null,
                    "estebanabaroa.eth": null,
                    "newmod.bso": { role: "moderator" }
                }
            })
        );
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <CommunityEditOptions>editFake.args[0][0];

        expect(mergedEditOptions.roles!["rinse12.bso"]).toBeUndefined();
        expect(mergedEditOptions.roles!["estebanabaroa.eth"]).toBeUndefined();
        expect(mergedEditOptions.roles!["newmod.bso"]).toEqual({ role: "moderator" });
        // Untouched role preserved
        expect(mergedEditOptions.roles!["plebeius.eth"]).toEqual(currentSubProps.roles!["plebeius.eth"]);
    });

    // --jsonFile flag

    it("Can edit using a JSON file", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "JSON Title", description: "JSON Desc" }));
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("JSON Title");
        expect(parsedArgs.description).toBe("JSON Desc");
    });

    it("Can edit nested properties from JSON file", async () => {
        const jsonPath = tempFile({ extension: "json" });
        const editData = {
            settings: {
                challenges: [{ name: "question", options: { question: "q?", answer: "a" } }],
                fetchThumbnailUrls: true
            }
        };
        await fsPromises.writeFile(jsonPath, JSON.stringify(editData));
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.settings?.challenges![0].name).toBe("question");
        expect(parsedArgs.settings?.fetchThumbnailUrls).toBe(true);
    });

    it("CLI flags override JSON file options", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "JSON Title", description: "JSON Desc" }));
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath} --title "CLI Title"`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("CLI Title");
        expect(parsedArgs.description).toBe("JSON Desc");
    });

    it("Errors on invalid JSON in file", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, "not valid json {{{");
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain("Invalid JSONC");
    });

    it("Errors when JSON file contains an array instead of object", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify(["not", "an", "object"]));
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain("JSON object");
    });

    it("Errors when JSON file contains a string instead of object", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify("just a string"));
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain("JSON object");
    });

    it("Can use -f as a short alias for --jsonFile", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "Short Flag Title" }));
        const { result } = await runEditCommand(`community edit plebbit.bso -f ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("Short Flag Title");
    });

    // JSONC (JSON with comments) support

    it("Can edit using a JSONC file with single-line comments", async () => {
        const jsoncPath = tempFile({ extension: "jsonc" });
        const jsoncContent = `{
  // This is a comment
  "title": "JSONC Title",
  "description": "JSONC Desc"
}`;
        await fsPromises.writeFile(jsoncPath, jsoncContent);
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsoncPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("JSONC Title");
        expect(parsedArgs.description).toBe("JSONC Desc");
    });

    it("Can edit using a JSONC file with multi-line comments", async () => {
        const jsoncPath = tempFile({ extension: "jsonc" });
        const jsoncContent = `{
  /* Multi-line
     comment */
  "title": "Multi Comment Title"
}`;
        await fsPromises.writeFile(jsoncPath, jsoncContent);
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsoncPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("Multi Comment Title");
    });

    it("JSON file with more challenges than existing does not produce undefined elements", async () => {
        const jsonPath = tempFile({ extension: "json" });
        const editData = {
            settings: {
                challenges: [
                    { name: "publication-match", options: { matches: "[]", error: "err" } },
                    { name: "whitelist", options: { urls: "https://example.com", error: "err" } },
                    { name: "captcha-canvas-v3" }
                ]
            }
        };
        await fsPromises.writeFile(jsonPath, JSON.stringify(editData));
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        // Must have exactly 3 challenges, no trailing undefined
        expect(parsedArgs.settings?.challenges).toHaveLength(3);
        expect(parsedArgs.settings?.challenges).toEqual(editData.settings.challenges);
        // Explicitly verify no undefined elements
        for (const challenge of parsedArgs.settings?.challenges ?? []) {
            expect(challenge).toBeDefined();
        }
    });

    it("Can edit using a JSONC file with trailing commas after comment stripping", async () => {
        const jsoncPath = tempFile({ extension: "jsonc" });
        const jsoncContent = `{
  "title": "Trailing Comma Title", // inline comment
  "description": "Trailing Comma Desc"
}`;
        await fsPromises.writeFile(jsoncPath, jsoncContent);
        const { result } = await runEditCommand(`community edit plebbit.bso --jsonFile ${jsoncPath}`);
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <CommunityEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("Trailing Comma Title");
        expect(parsedArgs.description).toBe("Trailing Comma Desc");
    });

});
