import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import Sinon from "sinon";
import { clearPkcRpcConnectOverride, setPkcRpcConnectOverride } from "../helpers/pkc-test-overrides.js";
import { runCliCommand } from "../helpers/run-cli.js";

describe("bitsocial community stop", () => {
    const sandbox = Sinon.createSandbox();

    // The communities the fake daemon hosts (`pkc.communities`), and whether each is running (`community.started`).
    const startedByAddress: Record<string, boolean> = {};
    const startFake = sandbox.fake();
    const stopFake = sandbox.fake();
    const createCommunityFake = sandbox.fake((options: { address: string }) => {
        // pkc-js returns a remote instance, which has no `started`, for an address the daemon does not list
        if (!(options.address in startedByAddress)) return { address: options.address, stop: stopFake };
        return {
            address: options.address,
            started: startedByAddress[options.address],
            start: startFake,
            stop: stopFake
        };
    });

    beforeAll(() => {
        const pkcInstanceFake = sandbox.fake.resolves({
            get communities() {
                return Object.entries(startedByAddress).map(([address, started]) => ({ address, started }));
            },
            createCommunity: createCommunityFake,
            destroy: () => {}
        });

        setPkcRpcConnectOverride(pkcInstanceFake);
    });

    afterEach(() => {
        startFake.resetHistory();
        stopFake.resetHistory();
        createCommunityFake.resetHistory();
        for (const key of Object.keys(startedByAddress)) delete startedByAddress[key];
    });
    afterAll(() => {
        clearPkcRpcConnectOverride();
        sandbox.restore();
    });

    it(`Attaches to each running community before stopping it, and prints every address`, async () => {
        const addresses = ["plebbit.bso", "plebbit2.bso"];
        for (const address of addresses) startedByAddress[address] = true;

        const { result, stdout } = await runCliCommand(["community", "stop", ...addresses]);

        expect(createCommunityFake.args.map(([options]) => options.address)).toEqual(addresses);
        // A fresh RPC instance only sends stopCommunity once it is attached to the running
        // community, so stop() must be preceded by start() for each address (issue #152)
        expect(startFake.callCount).toBe(addresses.length);
        expect(stopFake.callCount).toBe(addresses.length);
        for (let i = 0; i < addresses.length; i++) {
            expect(startFake.getCall(i).calledBefore(stopFake.getCall(i))).toBe(true);
        }

        const trimmedOutput: string[] = stdout.trim().split(/\r?\n/);
        expect(trimmedOutput).toEqual(addresses);
        expect(result.error).toBeUndefined();
    });

    it(`Leaves a community that is not running alone and still prints its address`, async () => {
        const address = "plebbit.bso";
        startedByAddress[address] = false;

        const { result, stdout } = await runCliCommand(["community", "stop", address]);

        expect(startFake.callCount).toBe(0);
        expect(stopFake.callCount).toBe(0);
        expect(stdout.trim()).toBe(address);
        expect(result.error).toBeUndefined();
    });

    it(`Fails for an address the daemon does not host instead of printing it as stopped`, async () => {
        startedByAddress["plebbit.bso"] = true;
        const typo = "plebit.bso";

        const { result, stdout, stderr } = await runCliCommand(["community", "stop", typo]);

        expect(stopFake.callCount).toBe(0);
        expect(stdout.trim()).toBe("");
        expect(stderr).toContain(typo);
        expect(result.error?.oclif?.exit).toBe(1);
    });
});
