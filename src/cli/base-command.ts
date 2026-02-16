import { Command, Flags } from "@oclif/core";
import defaults from "../common-utils/defaults.js";
import Plebbit from "@plebbit/plebbit-js";
import { getPlebbitLogger, setupDebugLogger } from "../util.js";
type PlebbitInstance = Awaited<ReturnType<typeof Plebbit>>;
type PlebbitConnectOverride = (plebbitRpcUrl: string) => Promise<PlebbitInstance>;

const getPlebbitConnectOverride = (): PlebbitConnectOverride | undefined => {
    const globalWithOverride = globalThis as { __PLEBBIT_RPC_CONNECT_OVERRIDE?: PlebbitConnectOverride };
    return globalWithOverride.__PLEBBIT_RPC_CONNECT_OVERRIDE;
};

export abstract class BaseCommand extends Command {
    static override baseFlags = {
        plebbitRpcUrl: Flags.url({
            summary: "URL to Plebbit RPC",
            required: true,
            default: defaults.PLEBBIT_RPC_URL
        })
    };

    async init(): Promise<void> {
        await super.init();
        const Logger = await getPlebbitLogger();
        setupDebugLogger(Logger, { enableDefaultNamespace: false });
    }

    protected async _connectToPlebbitRpc(plebbitRpcUrl: string): Promise<PlebbitInstance> {
        const connectOverride = getPlebbitConnectOverride();
        if (connectOverride) {
            return connectOverride(plebbitRpcUrl);
        }
        const plebbit = await Plebbit({ plebbitRpcClientsOptions: [plebbitRpcUrl] });
        plebbit.on("error", (err) => console.error("Error from plebbit instance", err));
        await new Promise((resolve) => plebbit.once("subplebbitschange", resolve));
        return plebbit;
    }
}
