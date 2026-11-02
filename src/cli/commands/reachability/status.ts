import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { readReachabilityStatus, type ReachabilityStatus } from "../../../reachability/state.js";

export default class Status extends Command {
    static override description = "Show whether browsers can reach this node: mode, announced addresses, certificate expiry and last checks";

    static override enableJsonFlag = true;

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path of the node",
            required: false
        })
    };

    static override examples = ["bitsocial reachability status", "bitsocial reachability status --json"];

    async run(): Promise<ReachabilityStatus> {
        const { flags } = await this.parse(Status);
        const status = await readReachabilityStatus(flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH);

        if (!status.configured) {
            this.log("Reachability is not configured. Browsers cannot reach this node. Run: bitsocial reachability setup");
            return status;
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
        return status;
    }
}
