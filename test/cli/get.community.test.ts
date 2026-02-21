import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import Sinon from "sinon";
import { clearPlebbitRpcConnectOverride, setPlebbitRpcConnectOverride } from "../helpers/plebbit-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community get", () => {
    const sandbox = Sinon.createSandbox();
    const fakeCommunity = {
        address: "plebbit.bso",
        title: "Plebbit",
        posts: [{ cid: "post1" }, { cid: "post2" }],
        updatedAt: 1234
    };

    const getSubplebbitFake = sandbox.fake.resolves(fakeCommunity);
    const destroyFake = sandbox.fake();

    beforeAll(() => {
        const plebbitInstanceFake = sandbox.fake.resolves({
            getSubplebbit: getSubplebbitFake,
            destroy: destroyFake
        });
        setPlebbitRpcConnectOverride(plebbitInstanceFake);
    });

    afterEach(() => {
        getSubplebbitFake.resetHistory();
        destroyFake.resetHistory();
    });

    afterAll(() => {
        clearPlebbitRpcConnectOverride();
        sandbox.restore();
    });

    it("Outputs community json and keeps posts first", async () => {
        const { result, stdout } = await runCliCommand("community get plebbit.bso");

        expect(result.error).toBeUndefined();
        expect(getSubplebbitFake.calledOnceWith({ address: "plebbit.bso" })).toBe(true);
        expect(destroyFake.calledOnce).toBe(true);

        const output = stdout.trim();
        const parsed = JSON.parse(output);
        expect(parsed).toEqual(fakeCommunity);

        const postsIndex = output.indexOf('"posts"');
        const addressIndex = output.indexOf('"address"');
        expect(postsIndex).toBeGreaterThan(-1);
        expect(addressIndex).toBeGreaterThan(-1);
        expect(postsIndex).toBeLessThan(addressIndex);
    });
});
