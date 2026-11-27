import { PKCLogger } from "../../../util.js";
import { BaseCommand } from "../../base-command.js";
import { Args, Flags } from "@oclif/core";
import pLimit from "p-limit";

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

    static override flags = {
        concurrency: Flags.integer({
            description: "Number of communities to start in parallel",
            default: 5,
            min: 0
        })
    };

    static override examples = [
        "bitsocial community start plebbit.bso",
        "bitsocial community start 12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu",
        {
            description: "Start all communities in your data path",
            command: "bitsocial community start $(bitsocial community list -q)"
        },
        {
            description: "Start communities sequentially (no concurrency)",
            command: "bitsocial community start $(bitsocial community list -q) --concurrency 1"
        }
    ];

    async run() {
        const { argv, flags } = await this.parse(Start);

        const addresses = <string[]>argv;
        const log = PKCLogger({ namespace: "bitsocial-cli:commands:community:start" });
        log(`addresses: `, addresses);
        log(`flags: `, flags);

        const concurrency = Math.max(flags.concurrency, 1);
        const limit = pLimit(concurrency);

        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());
        const errors: { address: string; error: Error }[] = [];

        const tasks = addresses.map((address) =>
            limit(async () => {
                try {
                    const community = await pkc.createCommunity({ address });
                    await community.start();
                    this.log(address);
                } catch (e) {
                    const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
                    //@ts-expect-error
                    error.details = { ...error.details, address };
                    errors.push({ address, error });
                }
            })
        );

        await Promise.all(tasks);
        await pkc.destroy();

        if (errors.length > 0) {
            for (const { error } of errors) {
                console.error(error);
            }
            this.exit(1);
        }
    }
}
