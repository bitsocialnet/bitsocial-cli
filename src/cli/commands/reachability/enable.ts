import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { cliSetupDependencies, ensureKuboRepo, resolveNodePaths, testOverrides } from "../../../reachability/cli-support.js";
import { NeedsAnswerError, runReachabilitySetup, SetupRefusedError } from "../../../reachability/setup.js";
import { readReachabilityConfig } from "../../../reachability/state.js";

export default class Enable extends Command {
    static override description = "Turn reachability back on: re-run discovery and repair from the stored choices, without asking anything";

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({ description: "Data path of the node", required: false })
    };

    static override examples = ["bitsocial reachability enable"];

    async run(): Promise<void> {
        const { flags } = await this.parse(Enable);
        const paths = await resolveNodePaths(flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH);
        const stored = await readReachabilityConfig(paths.dataPath);
        if (!stored) this.error("Reachability has not been set up on this node yet. Run: bitsocial reachability setup");
        await ensureKuboRepo(paths.dataPath, paths.kuboRpcUrl);
        const overrides = testOverrides(process.env);
        try {
            await runReachabilitySetup(
                { ...paths, staging: stored.staging, nonInteractive: true, force: stored.domainForced === true, ...(overrides ? { overrides } : {}) },
                await cliSetupDependencies({ log: (message) => this.log(message), warn: (message) => this.logToStderr(message) }, false, paths)
            );
        } catch (error) {
            if (error instanceof NeedsAnswerError) this.error(error.message, { exit: 2 });
            if (error instanceof SetupRefusedError) this.error(error.message, { exit: 1 });
            throw error;
        }
    }
}
