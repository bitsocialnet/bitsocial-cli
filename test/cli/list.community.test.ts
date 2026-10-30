import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import Sinon from "sinon";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community list", () => {
    const sandbox = Sinon.createSandbox();
    // pkc.communities entries are { name?, publicKey, address, started } objects since pkc-js 0.0.129
    const fakeCommunities = [
        { address: "plebbit1.bso", name: "plebbit1.bso", publicKey: "12D3KooWFake1", started: false },
        { address: "12D3KooWFake2", publicKey: "12D3KooWFake2", started: true }
    ];

    beforeAll(() => {
        const pkcInstanceFake = sandbox.fake.resolves({
            communities: fakeCommunities,
            destroy: () => {}
        });
        setPkcRpcConnectOverride(pkcInstanceFake);
    });

    afterEach(() => sandbox.resetHistory());
    afterAll(() => {
        clearPkcRpcConnectOverride();
        sandbox.restore();
    });

    it(`-q Outputs only community addresses`, async () => {
        const { result, stdout } = await runCliCommand("community list -q");
        expect(result.error).toBeUndefined();
        const trimmedOutput: string[] = stdout.trim().split(/\r?\n/);
        expect(trimmedOutput).toEqual(fakeCommunities.map(({ address }) => address));
    });
});
