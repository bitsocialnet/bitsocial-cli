import { getPlebbitLogger } from "../../../util.js";
import { BaseCommand } from "../../base-command.js";
import { Args } from "@oclif/core";

export default class Delete extends BaseCommand {
    static override description = "Delete a community permanently.";

    static override strict = false; // To allow for variable length arguments

    static override args = {
        addresses: Args.string({
            name: "addresses",
            required: true,
            description: "Addresses of communities to delete. Separated by space"
        })
    };

    static override examples = [
        "bitsocial community delete plebbit.bso",
        "bitsocial community delete 12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu"
    ];

    async run() {
        const { argv, flags } = await this.parse(Delete);

        const log = (await getPlebbitLogger())("bitsocial-cli:commands:community:delete");
        log(`addresses: `, argv);
        log(`flags: `, flags);
        const addresses = <string[]>argv;
        if (!Array.isArray(addresses)) this.error(`Failed to parse addresses correctly (${addresses})`);

        const plebbit = await this._connectToPlebbitRpc(flags.plebbitRpcUrl.toString());
        for (const address of addresses) {
            try {
                const sub = await plebbit.createSubplebbit({ address });
                await sub.delete();
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
