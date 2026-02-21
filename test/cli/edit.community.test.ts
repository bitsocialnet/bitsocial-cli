import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
//@ts-ignore
import Sinon from "sinon";
import type { SubplebbitEditOptions } from "../types/communityTypes.js";
import { currentSubProps } from "../fixtures/communityForEditFixture.js";
import { clearPlebbitRpcConnectOverride, setPlebbitRpcConnectOverride } from "../helpers/plebbit-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community edit", () => {
    const sandbox = Sinon.createSandbox();

    const editFake = sandbox.fake();

    const runEditCommand = (args: string) => runCliCommand(args);

    beforeAll(() => {
        const plebbitInstanceFake = sandbox.fake.resolves({
            createSubplebbit: sandbox.fake.resolves({
                edit: editFake,
                ...currentSubProps,
                toJSONInternalRpc: () => JSON.parse(JSON.stringify(currentSubProps))
            }),
            subplebbits: ["plebbit.bso"],
            destroy: () => {}
        });
        setPlebbitRpcConnectOverride(plebbitInstanceFake);
    });

    afterEach(() => editFake.resetHistory());
    afterAll(() => {
        clearPlebbitRpcConnectOverride();
        sandbox.restore();
    });

    // passing string flag

    it(`Can pass a string value to a first level flag`, async () => {
        const { result } = await runEditCommand(
            'community edit plebbit.bso --title "new Title" --address newAddress.bso --description "new Description" --pubsubTopic "new Pubsub topic"'
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const parsedArgs = <SubplebbitEditOptions>editFake.args[0][0];
        expect(parsedArgs.title).toBe("new Title");
        expect(parsedArgs.description).toBe("new Description");
        expect(parsedArgs.pubsubTopic).toBe("new Pubsub topic");
        expect(parsedArgs.address).toBe("newAddress.bso");
    });

    it(`Can set a string value to a nested prop`, async () => {
        const { result } = await runEditCommand('community edit plebbit.bso --suggested.secondaryColor "new suggested.secondaryColor"');
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        expect(mergedEditOptions.suggested!.secondaryColor).toBe("new suggested.secondaryColor");
    });

    // passing array flags

    it(`Can pass flag to set specific indices in an array`, async () => {
        const { result } = await runEditCommand(
            'community edit plebbit.bso --rules[2] "User input Rule 3" --rules[3] "User input Rule 4"'
        );
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const argsOfSubEdit = <SubplebbitEditOptions>editFake.args[0][0];
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
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
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
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
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
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        const randomBoolean = (mergedEditOptions as Record<string, unknown>)["randomBooleanField"];
        expect(randomBoolean).toBe(true);
    });

    it(`Can set a boolean field to true on first level (explicit)`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --randomBooleanField=true");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        const randomBoolean = (mergedEditOptions as Record<string, unknown>)["randomBooleanField"];
        expect(randomBoolean).toBe(true);
    });

    it("Can parse boolean=true in nested props correctly (implicit)", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings.fetchThumbnailUrls");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        expect(typeof mergedEditOptions.settings).toBe("object");
        expect(mergedEditOptions.settings!.fetchThumbnailUrls).toBe(true);
    });

    it("Can parse boolean=true in nested props correctly (explicit)", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings.fetchThumbnailUrls=true");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        expect(typeof mergedEditOptions.settings).toBe("object");
        expect(mergedEditOptions.settings!.fetchThumbnailUrls).toBe(true);
    });

    // setting boolean = false

    it(`Can set a boolean field to false on first level (explicit)`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --randomBooleanField=false");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        const randomBoolean = (mergedEditOptions as Record<string, unknown>)["randomBooleanField"];
        expect(randomBoolean).toBe(false);
    });

    it("Can parse boolean=false in nested props correctly (explicit)", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings.fetchThumbnailUrls=false");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
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
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];
        const mergedRules = <string[]>mergedEditOptions["rules"];
        expect(mergedRules[0]).toBe("1. First rule text");
        expect(mergedRules[1]).toBe("2. Second rule text");
    });

    it(`Can set null as a value to a nested flag`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --roles['rinse12.bso'] null");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];

        expect(mergedEditOptions.roles!["rinse12.bso"]).toBeNull();
        expect(mergedEditOptions.roles!["estebanabaroa.bso"]).toEqual(currentSubProps.roles!["estebanabaroa.bso"]);
    });

    it(`Can set null as a value to a flag`, async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --nullField] null");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];

        const nullField = (mergedEditOptions as Record<string, unknown>)["nullField"];
        expect(nullField).toBeNull();
    });

    it("Can set a null to a whole object", async () => {
        const { result } = await runEditCommand("community edit plebbit.bso --settings null");
        expect(result.error).toBeUndefined();
        expect(editFake.calledOnce).toBe(true);
        const mergedEditOptions = <SubplebbitEditOptions>editFake.args[0][0];

        expect(mergedEditOptions.settings).toBeNull();
    });
});
