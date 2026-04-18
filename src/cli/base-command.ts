import { Command, Flags } from "@oclif/core";
import defaults from "../common-utils/defaults.js";
import PKC from "@pkcprotocol/pkc-js";
import { PKCLogger, setupDebugLogger, type PKCLoggerType } from "../util.js";
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
        setupDebugLogger(PKCLogger as PKCLoggerType, { enableDefaultNamespace: false });
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
        }).catch((err) => {
            if (err && typeof err === "object" && "code" in err && err.code === "ERR_RPC_AUTH_REQUIRED") {
                throw err;
            }
            throw new Error(`Could not connect to the daemon at ${pkcRpcUrl}. Is it running? Start it with: bitsocial daemon`);
        });
        return pkc;
    }
}
