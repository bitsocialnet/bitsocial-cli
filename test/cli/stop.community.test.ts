import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import Sinon from "sinon";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community stop", () => {
    const addresses = ["plebbit.bso", "plebbit2.bso"];
    const sandbox = Sinon.createSandbox();

    let started = true;
    const startFake = sandbox.fake();
    const stopFake = sandbox.fake();
    beforeAll(() => {
        const pkcInstanceFake = sandbox.fake.resolves({
            createCommunity: () => ({
                started,
                start: startFake,
                stop: stopFake
            }),
            destroy: () => {}
        });

        setPkcRpcConnectOverride(pkcInstanceFake);
    });

    afterEach(() => {
        startFake.resetHistory();
        stopFake.resetHistory();
        started = true;
    });
    afterAll(() => {
        clearPkcRpcConnectOverride();
        sandbox.restore();
    });

    it(`Attaches to each running community before stopping it`, async () => {
        const { result, stdout } = await runCliCommand(["community", "stop", ...addresses]);
        expect(startFake.callCount).toBe(addresses.length);
        expect(stopFake.callCount).toBe(addresses.length);
        for (let i = 0; i < addresses.length; i++) expect(startFake.getCall(i).calledBefore(stopFake.getCall(i))).toBe(true);

        // Validate outputs
        const trimmedOutput: string[] = stdout.trim().split(/\r?\n/);
        expect(trimmedOutput).toEqual(addresses);
        expect(result.error).toBeUndefined();
    });

    it(`Leaves a community that is not running alone`, async () => {
        started = false;
        const { result, stdout } = await runCliCommand(["community", "stop", ...addresses]);
        expect(startFake.callCount).toBe(0);
        expect(stopFake.callCount).toBe(0);
        expect(stdout.trim().split(/\r?\n/)).toEqual(addresses);
        expect(result.error).toBeUndefined();
    });
});
