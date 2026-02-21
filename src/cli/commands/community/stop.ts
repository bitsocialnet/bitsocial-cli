import { getPlebbitLogger } from "../../../util.js";
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

        const log = (await getPlebbitLogger())("bitsocial-cli:commands:community:stop");
        log(`addresses: `, argv);
        log(`flags: `, flags);
        const addresses = <string[]>argv;
        if (!Array.isArray(addresses)) this.error(`Failed to parse addresses correctly (${addresses})`);

        const plebbit = await this._connectToPlebbitRpc(flags.plebbitRpcUrl.toString());
        for (const address of addresses) {
            try {
                const sub = await plebbit.createSubplebbit({ address });
                await sub.stop(); // should stop the original subplebbit instance from running
                this.log(address);
            } catch (e) {
                const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
                //@ts-expect-error
                error.details = { ...error.details, address };
                console.error(error);
                await plebbit.destroy();
                this.exit(1);
            }
        }
        await plebbit.destroy();
    }
}
