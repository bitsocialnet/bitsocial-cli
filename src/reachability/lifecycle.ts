import fs from "fs/promises";
import path from "path";
import { isOurCaddyRunning, stopCaddy } from "./caddy.js";
import { kuboIdentity, shutdownKubo } from "./discovery.js";
import { applyKuboConfig } from "./setup.js";
import { isReachabilityDeclined, readReachabilityConfig, reachabilityDir, writeReachabilityDeclined, type ReachabilityConfig } from "./state.js";

export interface LifecycleOptions {
    dataPath: string;
    kuboRepoPath: string;
    kuboRpcUrl: URL;
    log: (message: string) => void;
    // How long a running daemon gets to stop its own Caddy before we do it.
    caddyStopGraceMs?: number;
}

async function ensureCaddyStopped(config: ReachabilityConfig, dataPath: string, graceMs: number) {
    const caddyUp = (adminPort: number) => isOurCaddyRunning(adminPort, dataPath);
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
        if (!(await caddyUp(config.caddyAdminPort))) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await stopCaddy(config.caddyAdminPort).catch(() => {});
    const hardDeadline = Date.now() + 5000;
    while (Date.now() < hardDeadline && (await caddyUp(config.caddyAdminPort))) await new Promise((resolve) => setTimeout(resolve, 200));
}

// Stops serving and puts the kubo fields back. The directory stays, so a later enable reuses the ACME
// account and certificates and never spends rate limit.
export const DECLINE_RECORDED_MESSAGE =
    "Reachability was never set up. Recorded that you declined it, so the daemon stops reminding you. To turn it on later, run: bitsocial reachability setup";

export const PURGE_DECLINE_MESSAGE = "Recorded that reachability is declined, so the daemon does not start reminding you. To turn it on again, run: bitsocial reachability setup";

export async function disableReachability(options: LifecycleOptions): Promise<ReachabilityConfig | undefined> {
    const config = await readReachabilityConfig(options.dataPath);
    if (!config) {
        // A node nobody decided about gets a reminder from the daemon every hour. This is how to say no.
        if (await isReachabilityDeclined(options.dataPath)) options.log("Reachability is already declined.");
        else {
            await writeReachabilityDeclined(options.dataPath);
            options.log(DECLINE_RECORDED_MESSAGE);
        }
        return undefined;
    }
    if (config.enabled) {
        const { kuboConfigChanged } = await applyKuboConfig(config, options, false);
        if (kuboConfigChanged && (await kuboIdentity(options.kuboRpcUrl))) await shutdownKubo(options.kuboRpcUrl);
    } else options.log("Reachability was already disabled.");
    // A running daemon notices within seconds. It gets the first chance, so it does not report a crash.
    await ensureCaddyStopped(config, options.dataPath, options.caddyStopGraceMs ?? 15_000);
    options.log("Reachability is disabled. Browsers can no longer dial this node through it. Run `bitsocial reachability enable` to turn it back on.");
    return { ...config, enabled: false };
}

export const purgeBackupName = (now: Date) => `reachability.bak-${now.toISOString().replace(/[:.]/g, "-")}`;

// Moved rather than deleted: the directory holds the ACME account and a private key.
export async function purgeReachability(options: LifecycleOptions, now: Date = new Date()): Promise<string | undefined> {
    await disableReachability(options);
    const directory = reachabilityDir(options.dataPath);
    try {
        await fs.access(directory);
    } catch {
        return undefined;
    }
    const backup = path.join(options.dataPath, purgeBackupName(now));
    // Windows refuses the rename for a moment after Caddy exits, while its binary is still mapped.
    for (let attempt = 1; ; attempt++) {
        try {
            await fs.rename(directory, backup);
            break;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if ((code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") || attempt >= 10) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    options.log(`Moved reachability state to ${backup}`);
    // Without its config the node would look undecided, and the daemon would start reminding someone who just removed it all.
    if (!(await isReachabilityDeclined(options.dataPath))) {
        await writeReachabilityDeclined(options.dataPath);
        options.log(PURGE_DECLINE_MESSAGE);
    }
    return backup;
}
