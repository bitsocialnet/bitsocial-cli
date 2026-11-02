import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { evaluateChecks, formatCheck, gatherCheckFacts, type ReachabilityCheck } from "../../../reachability/checks.js";
import { resolveKuboBinaryPath } from "../../../ipfs/startIpfs.js";
import { readReachabilityConfig, readReachabilityStatus, type ReachabilityStatus } from "../../../reachability/state.js";
import { resolveKuboRpcUrl } from "../../../util.js";

export default class Status extends Command {
    static override description =
        "Show whether browsers can reach this node: mode, announced addresses, certificate expiry, last checks, and whether each requirement is met, including permission to bind UDP 443";

    static override enableJsonFlag = true;

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path of the node",
            required: false
        })
    };

    static override examples = ["bitsocial reachability status", "bitsocial reachability status --json"];

    async run(): Promise<ReachabilityStatus & { checks: ReachabilityCheck[] }> {
        const { flags } = await this.parse(Status);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;
        const status = await readReachabilityStatus(dataPath);
        const config = await readReachabilityConfig(dataPath);
        const override = process.env["BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS"];
        const checks = evaluateChecks(
            await gatherCheckFacts({
                dataPath,
                kuboPath: await resolveKuboBinaryPath(),
                kuboRpcUrl: await resolveKuboRpcUrl(dataPath, process.env["KUBO_RPC_URL"], defaults.KUBO_RPC_URL),
                enabled: status.enabled,
                certificates: status.certificates,
                ...(override ? { publicIps: override.split(",") } : config?.publicIps.length ? { publicIps: config.publicIps } : {}),
                ...(config?.httpsPort ? { httpsPort: config.httpsPort } : {}),
                ...(config?.httpPort ? { httpPort: config.httpPort } : {}),
                ...(config ? { wsPort: config.wsPort, caddyAdminPort: config.caddyAdminPort } : {})
            })
        );
        const printChecks = () => {
            this.log("Requirements:");
            for (const check of checks) this.log(formatCheck(check));
        };

        if (!status.configured) {
            this.log("Reachability is not configured. Browsers cannot reach this node. Run: bitsocial reachability setup");
            printChecks();
            return { ...status, checks };
        }
        this.log(`Enabled: ${status.enabled ? "yes" : "no"}`);
        this.log(`Mode: ${status.mode}${status.staging ? " (Let's Encrypt staging)" : ""}`);
        if (status.domain) this.log(`Domain: ${status.domain}`);
        this.log(`Announced addresses: ${status.addresses.length > 0 ? "" : "none"}`);
        for (const address of status.addresses) this.log(`  ${address}`);
        this.log(`Certificates: ${status.certificates.length > 0 ? "" : "none"}`);
        for (const certificate of status.certificates)
            this.log(`  ${certificate.names.join(", ")}: expires ${certificate.notAfter} (${certificate.hoursLeft} h left)`);
        if (status.lastChecks?.lastIpCheck) {
            const { at, publicIps } = status.lastChecks.lastIpCheck;
            this.log(`Last IP check: ${at} (${publicIps.join(", ") || "no public IP found"})`);
        }
        for (const [domain, check] of Object.entries(status.lastChecks?.domains ?? {})) {
            const state = check.ok ? "ok" : `failing since ${check.failingSince ?? check.lastCheckAt}`;
            this.log(`Domain check ${domain}: ${state}${check.droppedFromAnnounce ? ", no longer announced" : ""} (checked ${check.lastCheckAt})`);
        }
        if (status.lastChecks?.caddy) this.log(`Caddy: ${status.lastChecks.caddy.running ? "running" : "not running"}`);
        printChecks();
        return { ...status, checks };
    }
}
