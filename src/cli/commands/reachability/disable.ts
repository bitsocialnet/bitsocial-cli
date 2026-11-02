import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { resolveNodePaths } from "../../../reachability/cli-support.js";
import { disableReachability, purgeReachability } from "../../../reachability/lifecycle.js";

export default class Disable extends Command {
    static override description = "Stop serving browsers and restore the kubo config. State is kept, so `enable` does not need new certificates";

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({ description: "Data path of the node", required: false }),
        purge: Flags.boolean({ description: "Also move the state directory, including the ACME account and certificates, to a timestamped backup", default: false })
    };

    static override examples = ["bitsocial reachability disable", "bitsocial reachability disable --purge"];

    async run(): Promise<void> {
        const { flags } = await this.parse(Disable);
        const options = { ...(await resolveNodePaths(flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH)), log: (message: string) => this.log(message) };
        if (flags.purge) await purgeReachability(options);
        else await disableReachability(options);
    }
}
