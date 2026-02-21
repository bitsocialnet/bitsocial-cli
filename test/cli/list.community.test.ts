import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import Sinon from "sinon";
import { clearPlebbitRpcConnectOverride, setPlebbitRpcConnectOverride } from "../helpers/plebbit-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community list", () => {
    const sandbox = Sinon.createSandbox();
    const fakeCommunities = ["plebbit1.bso", "plebbit2.bso"];

    beforeAll(() => {
        const plebbitInstanceFake = sandbox.fake.resolves({
            subplebbits: fakeCommunities,
            destroy: () => {}
        });
        setPlebbitRpcConnectOverride(plebbitInstanceFake);
    });

    afterEach(() => sandbox.resetHistory());
    afterAll(() => {
        clearPlebbitRpcConnectOverride();
        sandbox.restore();
    });

    it(`-q Outputs only community addresses`, async () => {
        const { result, stdout } = await runCliCommand("community list -q");
        expect(result.error).toBeUndefined();
        const trimmedOutput: string[] = stdout.trim().split("\n");
        expect(trimmedOutput).toEqual(fakeCommunities);
    });
});
