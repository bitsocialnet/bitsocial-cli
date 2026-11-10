import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import defaults from "../../../common-utils/defaults.js";
import { PKCLogger } from "../../../util.js";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Minimal shape of the export records emitted by pkc-js over RPC (CommunityExportRecord).
// Kept local so we don't deep-import from pkc-js dist paths (see daemon.ts's @ts-expect-error imports).
type ExportRecord = {
    exportId: string;
    name?: string;
    publicKey: string;
    includePrivateKey: boolean;
    progress: number;
    size?: number;
    sha256?: string;
    url?: string;
    error?: { code: string; message: string };
};

type ExportableCommunity = {
    address: string;
    exports: ExportRecord[];
    export: (options?: { includePrivateKey?: boolean; signal?: AbortSignal }) => Promise<{ exportId: string }>;
    on: (event: string, listener: (records: ExportRecord[]) => void) => void;
    removeListener: (event: string, listener: (records: ExportRecord[]) => void) => void;
};

// The part of pkc-js's PKCRpcClient that says whether the connection to the RPC server is up
type RpcConnection = {
    state: string;
    on: (event: "statechange", listener: (state: string) => void) => void;
    removeListener: (event: "statechange", listener: (state: string) => void) => void;
};

// How long an export waits for the daemon's exports after the RPC connection drops. pkc-js retries about 1, 3, 7, 15
// and 31s after a drop (its backoff doubles up to 30s), so this covers five attempts
const RECONNECT_GRACE_MS = 60_000;

export default class Export extends BaseCommand {
    static override description =
        "Export a local community to a SQLite snapshot file. The export runs on the RPC server (daemon); once finished the snapshot is downloaded and its sha256 checksum is verified. Pass --includePrivateKey to produce a restorable backup that keeps the community's address.";

    static override examples = [
        "bitsocial community export plebmusic.bso",
        "bitsocial community export plebmusic.bso --includePrivateKey -o ./backups/plebmusic.sqlite",
        "bitsocial community export --name my-community",
        "bitsocial community export --publicKey 12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu"
    ];

    static override args = {
        address: Args.string({
            name: "address",
            required: false,
            description: "Address of the community to export"
        })
    };

    static override flags = {
        name: Flags.string({
            description: "Name of the community to export"
        }),
        publicKey: Flags.string({
            description: "Public key of the community to export"
        }),
        path: Flags.string({
            char: "o",
            description: "Destination file for the downloaded snapshot (default: <dataPath>/exports/<address>_<datetime>.sqlite)"
        }),
        includePrivateKey: Flags.boolean({
            default: false,
            description:
                "Ask the RPC server to include the community signer's private key in the export. Required for a restorable backup that keeps the same community address. The daemon may refuse (see `bitsocial daemon --no-allowPrivateKeyExport`)"
        }),
        force: Flags.boolean({
            default: false,
            description: "Overwrite the destination file if it already exists"
        }),
        quiet: Flags.boolean({
            char: "q",
            default: false,
            description: "Suppress progress output; only print the path of the downloaded snapshot"
        })
    };

    private _printProgress(quiet: boolean, message: string) {
        if (!quiet) process.stderr.write(message);
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Export);

        const log = PKCLogger("bitsocial-cli:commands:community:export");
        log(`args: `, args);
        log(`flags: `, flags);

        const lookupParam: Record<string, string> = {};
        if (args.address) lookupParam.address = args.address;
        if (flags.name) lookupParam.name = flags.name;
        if (flags.publicKey) lookupParam.publicKey = flags.publicKey;

        if (Object.keys(lookupParam).length === 0) {
            this.error("At least one of address argument, --name, or --publicKey must be provided");
        }

        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());

        // Cancel the in-flight export server-side on Ctrl+C. A second Ctrl+C force-exits
        // (the handler is registered with `once`, so the default SIGINT behavior is restored).
        const abortController = new AbortController();
        const onSigint = () => {
            this._printProgress(flags.quiet, "\nCancelling export... (Ctrl+C again to force exit)\n");
            abortController.abort();
        };
        process.once("SIGINT", onSigint);

        try {
            const community = (await pkc.createCommunity(lookupParam)) as unknown as Partial<ExportableCommunity>;
            if (typeof community.export !== "function") {
                this.error(
                    `Community is not local to the RPC server at ${flags.pkcRpcUrl}. Only communities created on this daemon can be exported`
                );
            }
            const exportableCommunity = community as ExportableCommunity;

            // Datetime in the filename matches the daemon log convention (ISO 8601 with ':' → '-')
            // so repeated exports never collide and snapshots sort chronologically
            const defaultFilename = `${exportableCommunity.address}_${new Date().toISOString().replace(/:/g, "-")}.sqlite`;
            const destPath = path.resolve(flags.path ?? path.join(defaults.PKC_DATA_PATH, "exports", defaultFilename));
            const destExists = await fs
                .stat(destPath)
                .then(() => true)
                .catch(() => false);
            if (destExists && !flags.force) {
                this.error(`Destination file already exists: ${destPath}. Use --force to overwrite it`);
            }

            const rpcConnection = Object.values(pkc.clients?.pkcRpcClients ?? {})[0] as RpcConnection | undefined;
            const finishedRecord = await this._runExport(
                exportableCommunity,
                flags.includePrivateKey,
                abortController.signal,
                flags.quiet,
                rpcConnection
            );
            log("Export finished on the RPC server", finishedRecord);

            if (!finishedRecord.url) {
                this.error(`Export ${finishedRecord.exportId} finished but the RPC server did not provide a download URL`);
            }

            // Mirrors pkc-js's rpcHttpOrigin: the ws[s]:// RPC URL with the protocol swapped to http[s]://
            const parsedRpcUrl = new URL(flags.pkcRpcUrl.toString());
            const expectedDownloadOrigin = `${parsedRpcUrl.protocol === "wss:" ? "https:" : "http:"}//${parsedRpcUrl.host}`;

            await this._downloadAndVerify(finishedRecord, destPath, abortController.signal, flags.quiet, expectedDownloadOrigin);

            this.log(destPath);
        } catch (e) {
            console.error(e);
            await pkc.destroy();
            this.exit(1);
        } finally {
            process.removeListener("SIGINT", onSigint);
        }
        await pkc.destroy();
    }

    /** Start the export on the RPC server and resolve with the terminal record (progress === 1). */
    private async _runExport(
        community: ExportableCommunity,
        includePrivateKey: boolean,
        signal: AbortSignal,
        quiet: boolean,
        rpcConnection?: RpcConnection
    ): Promise<ExportRecord> {
        const { exportId } = await community.export({ includePrivateKey, signal });

        return new Promise<ExportRecord>((resolve, reject) => {
            let lastPrintedPercent = -1;
            let settled = false;
            // Set while the connection is down, or back up but without the daemon's exports yet
            let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
            const cleanup = () => {
                settled = true;
                clearTimeout(reconnectTimer);
                community.removeListener("exportschange", checkRecords);
                signal.removeEventListener("abort", onAbort);
                rpcConnection?.removeListener("statechange", onConnectionStateChange);
            };
            // Don't wait for the server's terminal ERR_EXPORT_CANCELLED record — it never arrives if the
            // daemon died or the connection dropped. pkc-js's own abort listener (registered inside
            // community.export(), before this one) already dispatched cancelExport() to the server.
            const onAbort = () => {
                cleanup();
                reject(new Error("Export cancelled"));
            };
            // The export's progress and result only arrive over the RPC connection. After a drop pkc-js reconnects and
            // re-subscribes to the exports, and the daemon answers with the exports it has, which outlive connections.
            // A daemon that died never answers and a restarted one no longer has the export, so wait a bounded time
            const onConnectionStateChange = (state: string) => {
                if (settled) return;
                if (state === "failed") {
                    // pkc-js gave up, e.g. after the server refused the auth key
                    cleanup();
                    reject(
                        new Error(
                            `Lost the connection to the RPC server during the export, and pkc-js stopped reconnecting (state: failed). ` +
                                `Check the daemon and its auth key, then export again`
                        )
                    );
                    return;
                }
                if (state === "connected" || reconnectTimer) return;
                reconnectTimer = setTimeout(() => {
                    cleanup();
                    reject(
                        new Error(
                            `Lost the connection to the RPC server during the export, and did not get the export back within ` +
                                `${RECONNECT_GRACE_MS / 1000}s. Check that the daemon is running, then export again`
                        )
                    );
                }, RECONNECT_GRACE_MS);
            };
            const checkRecords = (records: ExportRecord[]) => {
                const record = records.find((rec) => rec.exportId === exportId);
                if (reconnectTimer) {
                    // Nothing arrives while the connection is down, so these are the exports the daemon sent when
                    // pkc-js re-subscribed after the reconnect
                    clearTimeout(reconnectTimer);
                    reconnectTimer = undefined;
                    if (!record) {
                        cleanup();
                        reject(
                            new Error(
                                `The RPC server no longer has export ${exportId} after the connection came back, so the daemon ` +
                                    `probably restarted. Export again`
                            )
                        );
                        return;
                    }
                }
                if (!record) return;
                if (record.error) {
                    cleanup();
                    reject(new Error(`Export failed (${record.error.code}): ${record.error.message}`));
                } else if (record.progress === 1) {
                    cleanup();
                    this._printProgress(quiet, `\rExporting ${community.address}: 100%\n`);
                    resolve(record);
                } else {
                    const percent = Math.floor(record.progress * 100);
                    if (percent !== lastPrintedPercent) {
                        lastPrintedPercent = percent;
                        this._printProgress(quiet, `\rExporting ${community.address}: ${percent}%`);
                    }
                }
            };
            community.on("exportschange", checkRecords);
            signal.addEventListener("abort", onAbort, { once: true });
            rpcConnection?.on("statechange", onConnectionStateChange);
            if (signal.aborted) return onAbort();
            // The terminal notification may have arrived before the listener was attached
            checkRecords(community.exports);
            // ...and the connection may already be down
            if (rpcConnection && rpcConnection.state !== "connected") onConnectionStateChange(rpcConnection.state);
        });
    }

    /** Download the finished snapshot to destPath, verifying its sha256 against the export record. */
    private async _downloadAndVerify(record: ExportRecord, destPath: string, signal: AbortSignal, quiet: boolean, expectedOrigin: string) {
        // The export download contract is GET <rpc-http-origin>/exports/<exportId> — refuse anything else
        // so a misconfigured/compromised RPC server can't use the CLI to fetch arbitrary URLs
        const downloadUrl = new URL(record.url!);
        if (downloadUrl.origin !== expectedOrigin || !downloadUrl.pathname.startsWith("/exports/")) {
            this.error(
                `Refusing to download export from unexpected URL ${record.url} (expected ${expectedOrigin}/exports/<exportId>)`
            );
        }
        this._printProgress(quiet, `Downloading snapshot from ${downloadUrl}\n`);
        const response = await fetch(downloadUrl, { signal });
        if (!response.ok || !response.body) {
            this.error(`Failed to download export from ${record.url}: HTTP ${response.status}`);
        }

        await fs.mkdir(path.dirname(destPath), { recursive: true });
        // Download to a .partial file so an interrupted/corrupted download never clobbers destPath
        const partialPath = destPath + ".partial";
        const hash = createHash("sha256");
        try {
            await pipeline(
                Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
                async function* (source) {
                    for await (const chunk of source) {
                        hash.update(chunk as Buffer);
                        yield chunk;
                    }
                },
                createWriteStream(partialPath)
            );
            const downloadedSha256 = hash.digest("hex");
            if (record.sha256 && downloadedSha256 !== record.sha256) {
                throw new Error(
                    `sha256 mismatch for downloaded export: expected ${record.sha256} but downloaded file hashes to ${downloadedSha256}`
                );
            }
            await fs.rename(partialPath, destPath);
        } catch (e) {
            await fs.rm(partialPath, { force: true }).catch(() => {});
            throw e;
        }
        this._printProgress(quiet, `Verified sha256 (${record.sha256}) and saved snapshot${record.size ? ` (${record.size} bytes)` : ""}\n`);
    }
}
