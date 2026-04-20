import { runCommand } from "@oclif/test";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import { file as tempFile } from "tempy";
import fsPromises from "fs/promises";
import signers from "../fixtures/signers.js";
import Sinon from "sinon";
import type { CreateCommunityOptions } from "../types/communityTypes.js";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";

const cliCreateOptions = {
    privateKeyPath: "test/fixtures/community_0_private_key.pem",
    title: "testTitle",
    description: "testDescription",
    suggested: {
        primaryColor: "testPrimaryColor",
        secondaryColor: "testSecondaryColor",
        avatarUrl: "http://localhost:8080/avatar.png",
        bannerUrl: "http://localhost:8080/banner.png",
        backgroundUrl: "http://localhost:8080/background.png",
        language: "testLanguage"
    }
};

describe("bitsocial community create", () => {
    const sandbox = Sinon.createSandbox();

    const startFake = sandbox.fake();
    const pkcCreateStub = sandbox.fake.resolves({ address: signers[0]!.address, start: startFake, started: false });
    const runCreateCommand = (args: string) => runCommand(args, process.cwd(), { stripAnsi: true });
    beforeAll(async () => {
        const pkcInstanceFake = sandbox.fake.resolves({
            createCommunity: pkcCreateStub,
            destroy: () => {}
        });
        setPkcRpcConnectOverride(pkcInstanceFake);
    });

    afterEach(() => {
        pkcCreateStub.resetHistory();
        startFake.resetHistory();
    });

    afterAll(() => {
        clearPkcRpcConnectOverride();
        sandbox.restore();
    });

    it(`Parses minimal create options correctly`, async () => {
        const result = await runCreateCommand("community create --description testDescription");
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        // PrivateKeyPath will be processed to signer
        expect(parsedArgs.description).toBe("testDescription");
        expect(startFake.calledOnce).toBe(true);
    });

    it(`Parses full create options correctly`, async () => {
        const result = await runCreateCommand(
            'community create --privateKeyPath test/fixtures/community_0_private_key.pem --title "testTitle" --description "testDescription" --suggested.primaryColor testPrimaryColor --suggested.secondaryColor testSecondaryColor --suggested.avatarUrl http://localhost:8080/avatar.png --suggested.bannerUrl http://localhost:8080/banner.png --suggested.backgroundUrl http://localhost:8080/background.png --suggested.language testLanguage'
        );
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        // PrivateKeyPath will be processed to signer
        expect(parsedArgs.title).toBe(cliCreateOptions.title);
        expect(parsedArgs.description).toBe(cliCreateOptions.description);
        expect(parsedArgs.suggested).toEqual(cliCreateOptions.suggested);
        if (!("signer" in parsedArgs) || !parsedArgs.signer) throw Error("signer should be defined");

        const signer = parsedArgs.signer;
        expect(typeof signer).toBe("object");
        expect(signer).not.toBeNull();

        if ("privateKey" in (signer as Record<string, unknown>)) expect(typeof (signer as { privateKey: unknown }).privateKey).toBe("string");
        else expect(typeof (signer as { address: unknown }).address).toBe("string");

        expect((signer as { type: unknown }).type).toBe("ed25519");
        expect(startFake.calledOnce).toBe(true);
    });

    // --jsonFile flag

    it("Can create using a JSON file", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "JSON Title", description: "JSON Desc" }));
        const result = await runCreateCommand(`community create --jsonFile ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        expect(parsedArgs.title).toBe("JSON Title");
        expect(parsedArgs.description).toBe("JSON Desc");
        expect(startFake.calledOnce).toBe(true);
    });

    it("Can create using a JSONC file with comments", async () => {
        const jsoncPath = tempFile({ extension: "jsonc" });
        const jsoncContent = `{
  // Community title
  "title": "JSONC Title",
  /* Description with
     multi-line comment */
  "description": "JSONC Desc"
}`;
        await fsPromises.writeFile(jsoncPath, jsoncContent);
        const result = await runCreateCommand(`community create --jsonFile ${jsoncPath}`);
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        expect(parsedArgs.title).toBe("JSONC Title");
        expect(parsedArgs.description).toBe("JSONC Desc");
        expect(startFake.calledOnce).toBe(true);
    });

    it("CLI flags override JSON file options in create", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "JSON Title", description: "JSON Desc" }));
        const result = await runCreateCommand(`community create --jsonFile ${jsonPath} --title "CLI Title"`);
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        expect(parsedArgs.title).toBe("CLI Title");
        expect(parsedArgs.description).toBe("JSON Desc");
    });

    it("--privateKeyPath works together with --jsonFile", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "JSON Title" }));
        const result = await runCreateCommand(
            `community create --jsonFile ${jsonPath} --privateKeyPath test/fixtures/community_0_private_key.pem`
        );
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        expect(parsedArgs.title).toBe("JSON Title");
        if (!("signer" in parsedArgs) || !parsedArgs.signer) throw Error("signer should be defined");
        expect((parsedArgs.signer as { type: unknown }).type).toBe("ed25519");
    });

    it("Can use -f as a short alias for --jsonFile", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify({ title: "Short Flag Title" }));
        const result = await runCreateCommand(`community create -f ${jsonPath}`);
        expect(result.error).toBeUndefined();
        expect(pkcCreateStub.calledOnce).toBe(true);
        const parsedArgs = <CreateCommunityOptions>pkcCreateStub.args[0][0];
        expect(parsedArgs.title).toBe("Short Flag Title");
    });

    it("Errors on invalid JSONC in create", async () => {
        const jsoncPath = tempFile({ extension: "jsonc" });
        await fsPromises.writeFile(jsoncPath, "not valid json {{{");
        const result = await runCreateCommand(`community create --jsonFile ${jsoncPath}`);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain("Invalid JSONC");
    });

    it("Errors when JSONC file contains an array in create", async () => {
        const jsonPath = tempFile({ extension: "json" });
        await fsPromises.writeFile(jsonPath, JSON.stringify(["not", "an", "object"]));
        const result = await runCreateCommand(`community create --jsonFile ${jsonPath}`);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain("JSON object");
    });
});
