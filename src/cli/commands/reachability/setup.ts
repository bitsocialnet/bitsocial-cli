import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { cliSetupDependencies, ensureKuboRepo, resolveNodePaths, testOverrides } from "../../../reachability/cli-support.js";
import { NeedsAnswerError, runReachabilitySetup, SetupRefusedError } from "../../../reachability/setup.js";

export default class Setup extends Command {
    static override description =
        "Make this node dialable from browsers: discover public addresses, obtain a certificate, configure kubo and verify. Safe to rerun";

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({ description: "Data path of the node", required: false }),
        domain: Flags.string({ description: "A domain pointing at this machine, to get a certificate for or to forward through your own proxy" }),
        announce: Flags.string({ description: "A multiaddr your own proxy serves, e.g. /dns4/node.example/tcp/443/tls/ws. Announced only after a real libp2p dial succeeds" }),
        force: Flags.boolean({ description: "Continue when the domain does not resolve to this machine, for proxies in front of it", default: false }),
        staging: Flags.boolean({ description: "Use the Let's Encrypt staging CA. Its certificates are not trusted by browsers", default: false }),
        "non-interactive": Flags.boolean({ description: "Never ask. Exit non-zero with the reason if an answer would be needed", default: false })
    };

    static override examples = [
        "bitsocial reachability setup",
        "bitsocial reachability setup --staging",
        "bitsocial reachability setup --domain node.example",
        "bitsocial reachability setup --domain node.example --announce /dns4/node.example/tcp/443/tls/ws",
        "bitsocial reachability setup --non-interactive"
    ];

    async run(): Promise<void> {
        const { flags } = await this.parse(Setup);
        const paths = await resolveNodePaths(flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH);
        await ensureKuboRepo(paths.dataPath, paths.kuboRpcUrl);
        const overrides = testOverrides(process.env);
        const canAsk = !flags["non-interactive"] && process.stdin.isTTY === true;
        try {
            await runReachabilitySetup(
                {
                    ...paths,
                    staging: flags.staging,
                    nonInteractive: flags["non-interactive"],
                    force: flags.force,
                    ...(flags.domain ? { domain: flags.domain } : {}),
                    ...(flags.announce ? { announce: flags.announce } : {}),
                    ...(overrides ? { overrides } : {})
                },
                await cliSetupDependencies({ log: (message) => this.log(message), warn: (message) => this.logToStderr(message) }, canAsk)
            );
        } catch (error) {
            if (error instanceof NeedsAnswerError) this.error(error.message, { exit: 2 });
            if (error instanceof SetupRefusedError) this.error(error.message, { exit: 1 });
            throw error;
        }
    }
}
