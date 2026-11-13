import { PKCLogger } from "../../../util.js";
import { BaseCommand } from "../../base-command.js";
import { Args } from "@oclif/core";

export default class Stop extends BaseCommand {
    static override description = "Stop a community. The community will not publish or receive any publications until it is started again.";

    static override strict = false; // To allow for variable length arguments

    static override args = {
        addresses: Args.string({
            name: "addresses",
            required: true,
            description: "Addresses of communities to stop. Separated by space"
        })
    };

    static override examples = [
        "bitsocial community stop plebbit.bso",
        "bitsocial community stop Qmb99crTbSUfKXamXwZBe829Vf6w5w5TktPkb6WstC9RFW"
    ];

    async run() {
        const { argv, flags } = await this.parse(Stop);

        const log = PKCLogger("bitsocial-cli:commands:community:stop");
        log(`addresses: `, argv);
        log(`flags: `, flags);
        const addresses = <string[]>argv;
        if (!Array.isArray(addresses)) this.error(`Failed to parse addresses correctly (${addresses})`);

        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());
        for (const address of addresses) {
            try {
                const community = await pkc.createCommunity({ address });
                // pkc-js returns a remote instance for an address the daemon does not host (a typo, or a
                // community of another node). It has nothing to stop, so fail instead of printing the address
                // as if it was stopped. A local instance carries the address the daemon lists it under.
                if (!pkc.communities.some((entry) => entry.address === community.address))
                    throw new Error(
                        `Community ${address} is not hosted by the daemon at ${flags.pkcRpcUrl}. Run "bitsocial community list" to see its communities`
                    );
                // `community.started` comes from the daemon's record (it is what `community list`
                // prints). A fresh RPC instance is never in client state "started" itself, and
                // pkc-js's RpcLocalCommunity.stop() only sends the stopCommunity RPC for an instance
                // that is, so calling stop() directly here returned without contacting the daemon
                // (issue #152). Attach to the running community first: the RPC server resolves
                // startCommunity for an already-running address to its live instance, which puts
                // this instance into state "started" so stop() really sends the RPC.
                if (community.started) {
                    await community.start();
                    await community.stop();
                }
                this.log(address);
            } catch (e) {
                const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
                //@ts-expect-error
                error.details = { ...error.details, address };
                console.error(error);
                await pkc.destroy();
                this.exit(1);
            }
        }
        await pkc.destroy();
    }
}
