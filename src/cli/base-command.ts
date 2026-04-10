import { Command, Flags } from "@oclif/core";
import defaults from "../common-utils/defaults.js";
import PKC from "@pkcprotocol/pkc-js";
import { getPKCLogger, setupDebugLogger } from "../util.js";
type PKCInstance = Awaited<ReturnType<typeof PKC>>;
type PKCConnectOverride = (pkcRpcUrl: string) => Promise<PKCInstance>;

const getPKCConnectOverride = (): PKCConnectOverride | undefined => {
    const globalWithOverride = globalThis as { __PKC_RPC_CONNECT_OVERRIDE?: PKCConnectOverride };
    return globalWithOverride.__PKC_RPC_CONNECT_OVERRIDE;
};

export abstract class BaseCommand extends Command {
    static override baseFlags = {
        pkcRpcUrl: Flags.url({
            summary: "URL to PKC RPC",
            required: true,
            default: defaults.PKC_RPC_URL
        })
    };

    async init(): Promise<void> {
        await super.init();
        const Logger = await getPKCLogger();
        setupDebugLogger(Logger, { enableDefaultNamespace: false });
    }

    protected async _connectToPkcRpc(pkcRpcUrl: string): Promise<PKCInstance> {
        const connectOverride = getPKCConnectOverride();
        if (connectOverride) {
            return connectOverride(pkcRpcUrl);
        }
        const pkc = await PKC({ pkcRpcClientsOptions: [pkcRpcUrl] });
        const errors: Error[] = [];
        pkc.on("error", (err) => {
            errors.push(err);
            console.error("Error from pkc instance", err);
        });
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                const lastError = errors[errors.length - 1];
                reject(lastError ?? new Error(`Timed out waiting for RPC server at ${pkcRpcUrl} to respond`));
            }, 20000);
            pkc.once("communitieschange", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        return pkc;
    }
}
