import fs from "fs/promises";
import path from "path";
import { stopCaddy } from "./caddy.js";
import { kuboIdentity, shutdownKubo } from "./discovery.js";
import { applyKuboConfig } from "./setup.js";
import { readReachabilityConfig, reachabilityDir, type ReachabilityConfig } from "./state.js";

export interface LifecycleOptions {
    dataPath: string;
    kuboRepoPath: string;
    kuboRpcUrl: URL;
    log: (message: string) => void;
    // How long a running daemon gets to stop its own Caddy before we do it.
    caddyStopGraceMs?: number;
}

const caddyUp = async (adminPort: number) => {
    try {
        await fetch(`http://127.0.0.1:${adminPort}/config/`, { headers: { Origin: `http://127.0.0.1:${adminPort}` }, signal: AbortSignal.timeout(1000) });
        return true;
    } catch {
        return false;
    }
};

async function ensureCaddyStopped(config: ReachabilityConfig, graceMs: number) {
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
export async function disableReachability(options: LifecycleOptions): Promise<ReachabilityConfig | undefined> {
    const config = await readReachabilityConfig(options.dataPath);
    if (!config) {
        options.log("Reachability is not configured. Nothing to disable.");
        return undefined;
    }
    if (config.enabled) {
        const { kuboConfigChanged } = await applyKuboConfig(config, options, false);
        if (kuboConfigChanged && (await kuboIdentity(options.kuboRpcUrl))) await shutdownKubo(options.kuboRpcUrl);
    } else options.log("Reachability was already disabled.");
    // A running daemon notices within seconds. It gets the first chance, so it does not report a crash.
    await ensureCaddyStopped(config, options.caddyStopGraceMs ?? 15_000);
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
    return backup;
}
