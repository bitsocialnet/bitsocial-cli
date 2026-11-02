import { spawn } from "child_process";
import readline from "readline/promises";
import defaults from "../common-utils/defaults.js";
import { initKuboRepoIfNeeded, resolveKuboBinaryPath } from "../ipfs/startIpfs.js";
import { loadKuboConfigFile, PKCLogger, resolveKuboRepoPath, resolveKuboRpcUrl } from "../util.js";
import { evaluateChecks, gatherCheckFacts } from "./checks.js";
import { detectContainer } from "./discovery.js";
import { realSetupDependencies, type SetupDependencies, type SetupOptions } from "./setup.js";

// Test hooks: Pebble in place of Let's Encrypt, and loopback in place of a public address.
export function testOverrides(env: NodeJS.ProcessEnv): SetupOptions["overrides"] {
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

export async function resolveNodePaths(dataPath: string) {
    return {
        dataPath,
        kuboRepoPath: resolveKuboRepoPath(dataPath),
        kuboRpcUrl: await resolveKuboRpcUrl(dataPath, process.env["KUBO_RPC_URL"], defaults.KUBO_RPC_URL)
    };
}

// A running daemon holds the repo lock, and `ipfs init` errors out on it, so only init a missing repo.
export async function ensureKuboRepo(dataPath: string, kuboRpcUrl: URL) {
    const log = PKCLogger("bitsocial-cli:reachability");
    if (!(await loadKuboConfigFile(dataPath))) await initKuboRepoIfNeeded(log, dataPath, kuboRpcUrl, defaults.IPFS_GATEWAY_URL);
}

export async function cliSetupDependencies(
    output: { log: (message: string) => void; warn: (message: string) => void },
    canAsk: boolean,
    paths: { dataPath: string; kuboRpcUrl: URL }
): Promise<SetupDependencies> {
    const kuboPath = await resolveKuboBinaryPath();
    return {
        ...realSetupDependencies(),
        ...output,
        checkRequirements: async (input) => evaluateChecks(await gatherCheckFacts({ ...paths, kuboPath, enabled: false, ...input })),
        ...(canAsk ? { confirm: confirmOnTerminal, ask: askOnTerminal, runSudoSetcap } : {}),
        platform: process.platform,
        inContainer: await detectContainer(),
        isCi: Boolean(process.env["CI"]),
        kuboBinaryPath: kuboPath
    };
}
