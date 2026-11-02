import { spawn } from "child_process";
import readline from "readline/promises";
import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { initKuboRepoIfNeeded, resolveKuboBinaryPath } from "../../../ipfs/startIpfs.js";
import { detectContainer } from "../../../reachability/discovery.js";
import { NeedsAnswerError, realSetupDependencies, SetupRefusedError, runReachabilitySetup, type SetupOptions } from "../../../reachability/setup.js";
import { loadKuboConfigFile, PKCLogger, resolveKuboRepoPath, resolveKuboRpcUrl } from "../../../util.js";

// Test hooks: Pebble in place of Let's Encrypt, and loopback in place of a public address.
function testOverrides(env: NodeJS.ProcessEnv): SetupOptions["overrides"] {
    const acmeDirectory = env["BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY"];
    if (!acmeDirectory) return undefined;
    const number = (value: string | undefined) => (value ? Number(value) : undefined);
    const httpsPort = number(env["BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT"]);
    const httpPort = number(env["BITSOCIAL_TEST_REACHABILITY_HTTP_PORT"]);
    const trustedRoots = env["BITSOCIAL_TEST_REACHABILITY_ACME_ROOT"];
    const publicIps = env["BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS"];
    return {
        acmeDirectory,
        ...(trustedRoots ? { acmeTrustedRootsPath: trustedRoots } : {}),
        ...(publicIps ? { publicIps: publicIps.split(",") } : {}),
        ...(httpsPort ? { httpsPort } : {}),
        ...(httpPort ? { httpPort } : {})
    };
}

const runSudoSetcap = (binaryPath: string) =>
    new Promise<boolean>((resolve) => {
        const child = spawn("sudo", ["setcap", "cap_net_bind_service=+ep", binaryPath], { stdio: "inherit" });
        child.once("error", () => resolve(false));
        child.once("exit", (code) => resolve(code === 0));
    });

async function askOnTerminal(question: string): Promise<string> {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return await terminal.question(`${question} `);
    } finally {
        terminal.close();
    }
}

const confirmOnTerminal = async (question: string) => /^y(es)?$/i.test((await askOnTerminal(`${question} [y/N]`)).trim());

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
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;
        const log = PKCLogger("bitsocial-cli:reachability:setup");
        const kuboRpcUrl = await resolveKuboRpcUrl(dataPath, process.env["KUBO_RPC_URL"], defaults.KUBO_RPC_URL);
        const gatewayUrl = defaults.IPFS_GATEWAY_URL;
        // A running daemon holds the repo lock, and `ipfs init` errors out on it, so only init a missing repo.
        if (!(await loadKuboConfigFile(dataPath))) await initKuboRepoIfNeeded(log, dataPath, kuboRpcUrl, gatewayUrl);

        const canAsk = !flags["non-interactive"] && process.stdin.isTTY === true;
        const overrides = testOverrides(process.env);
        try {
            await runReachabilitySetup(
                {
                    dataPath,
                    kuboRepoPath: resolveKuboRepoPath(dataPath),
                    kuboRpcUrl,
                    staging: flags.staging,
                    nonInteractive: flags["non-interactive"],
                    force: flags.force,
                    ...(flags.domain ? { domain: flags.domain } : {}),
                    ...(flags.announce ? { announce: flags.announce } : {}),
                    ...(overrides ? { overrides } : {})
                },
                {
                    ...realSetupDependencies(),
                    log: (message) => this.log(message),
                    warn: (message) => this.logToStderr(message),
                    ...(canAsk ? { confirm: confirmOnTerminal, ask: askOnTerminal, runSudoSetcap } : {}),
                    platform: process.platform,
                    inContainer: await detectContainer(),
                    isCi: Boolean(process.env["CI"]),
                    kuboBinaryPath: await resolveKuboBinaryPath()
                }
            );
        } catch (error) {
            if (error instanceof NeedsAnswerError) this.error(error.message, { exit: 2 });
            if (error instanceof SetupRefusedError) this.error(error.message, { exit: 1 });
            throw error;
        }
    }
}
