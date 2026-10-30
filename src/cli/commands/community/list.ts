import { Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import { EOL } from "os";
import { PKCLogger } from "../../../util.js";
import { printTable } from "@oclif/table";

export default class List extends BaseCommand {
    static override description = "List your communities";

    static override examples = ["bitsocial community list -q", "bitsocial community list"];

    static override flags = {
        quiet: Flags.boolean({
            char: "q",
            summary: "Only display community addresses, one per line"
        })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(List);

        const log = PKCLogger("bitsocial-cli:commands:community:list");
        log(`flags: `, flags);
        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());
        // pkc.communities entries carry `started` (pkc-js >= 0.0.129), so no per-community lookup is needed
        const communities = pkc.communities.map(({ address, started }) => ({ address, started }));
        if (flags.quiet) {
            this.log(communities.map(({ address }) => address).join(EOL));
        } else {
            printTable({ data: communities, sort: { started: "desc" } });
        }
        await pkc.destroy();
    }
}
