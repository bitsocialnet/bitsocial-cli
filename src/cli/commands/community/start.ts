import { getPlebbitLogger } from "../../../util.js";
import { BaseCommand } from "../../base-command.js";
import { Args } from "@oclif/core";

export default class Start extends BaseCommand {
    static override description = "Start a community";

    static override strict = false; // To allow for variable length arguments

    static override args = {
        addresses: Args.string({
            name: "addresses", // name of arg to show in help and reference with args[name]
            required: true,
            description: "Addresses of communities to start. Separated by space"
        })
    };

    static override examples = [
        "bitsocial community start plebbit.bso",
        "bitsocial community start 12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu",
        {
            description: "Start all communities in your data path",
            command: "bitsocial community start $(bitsocial community list -q)"
        }
    ];

    async run() {
        const { argv, flags } = await this.parse(Start);

        const addresses = <string[]>argv;
        const log = (await getPlebbitLogger())("bitsocial-cli:commands:community:start");
        log(`addresses: `, addresses);
        log(`flags: `, flags);

        const plebbit = await this._connectToPlebbitRpc(flags.plebbitRpcUrl.toString());
        for (const address of addresses) {
            try {
                const sub = await plebbit.createSubplebbit({ address });
                await sub.start();
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
