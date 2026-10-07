import { PKCLogger } from "../../../util.js";
import { BaseCommand } from "../../base-command.js";
import { Args } from "@oclif/core";

export default class Stop extends BaseCommand {
    static override description =
        "Stop a community. The community will not publish or receive any publications until it is started again.";

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
                // stop() only asks the RPC server to stop a community this instance started, so on a fresh
                // instance it does nothing. start() on a running community attaches to the daemon's instance.
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
