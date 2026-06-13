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
            summary: "Only display community addresses (much faster: skips the per-community 'started' lookup)"
        })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(List);

        const log = PKCLogger("bitsocial-cli:commands:community:list");
        log(`flags: `, flags);
        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());
        const communities = pkc.communities;
        if (flags.quiet) {
            this.log(communities.join(EOL));
        } else {
            const communitiesWithStarted = await Promise.all(
                communities.map(async (address: string) => {
                    const community = await pkc.createCommunity({ address });
                    return { address: community.address, started: community.started };
                })
            );
            printTable({ data: communitiesWithStarted, sort: { started: "desc" } });
        }
        await pkc.destroy();
    }
}
