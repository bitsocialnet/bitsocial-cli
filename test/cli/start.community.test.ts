import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import Sinon from "sinon";
import { clearPlebbitRpcConnectOverride, setPlebbitRpcConnectOverride } from "../helpers/plebbit-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community start", () => {
    const addresses = ["plebbit.bso", "plebbit2.bso"];
    const sandbox = Sinon.createSandbox();
    const startFake = sandbox.fake();

    beforeAll(() => {
        const plebbitInstanceFake = sandbox.fake.resolves({
            createSubplebbit: () => ({
                start: startFake
            }),
            destroy: () => {}
        });

        setPlebbitRpcConnectOverride(plebbitInstanceFake);
    });

    afterEach(() => startFake.resetHistory());
    afterAll(() => {
        clearPlebbitRpcConnectOverride();
        sandbox.restore();
    });

    it(`Parses and submits addresses correctly`, async () => {
        const { result, stdout } = await runCliCommand(["community", "start", ...addresses]);
        // Validate calls to start here
        expect(startFake.callCount).toBe(addresses.length);

        // Validate outputs
        const trimmedOutput: string[] = stdout.trim().split("\n");
        expect(trimmedOutput).toEqual(addresses);
        expect(result.error).toBeUndefined();
    });
});
