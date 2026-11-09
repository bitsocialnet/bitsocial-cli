import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { evaluateChecks, formatCheck, gatherCheckFacts, publicAddressAnnouncedCheck, type ReachabilityCheck } from "../../../reachability/checks.js";
import { resolveKuboBinaryPath } from "../../../ipfs/startIpfs.js";
import { readReachabilityConfig, readReachabilityStatus, type ReachabilityStatus } from "../../../reachability/state.js";
import { autonatEvidence, browserAddressCheck, notConfiguredSummary, verifyUnmanagedAddresses, type UnmanagedAddress } from "../../../reachability/unmanaged.js";
import { resolveKuboRpcUrl } from "../../../util.js";

const DECLINED_STATUS_LINE = "Reachability: declined. To turn it on, run: bitsocial reachability setup";

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

    async run(): Promise<ReachabilityStatus & { unmanagedAddresses: UnmanagedAddress[]; checks: ReachabilityCheck[] }> {
        const { flags } = await this.parse(Status);
        const dataPath = flags["pkcOptions.dataPath"] || defaults.PKC_DATA_PATH;
        const status = await readReachabilityStatus(dataPath);
        const config = await readReachabilityConfig(dataPath);
        const override = process.env["BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS"];
        const testHttpsPort = Number(process.env["BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT"]);
        const httpsPort = config?.httpsPort ?? (testHttpsPort || undefined);
        const facts = await gatherCheckFacts({
            dataPath,
            kuboPath: await resolveKuboBinaryPath(),
            kuboRpcUrl: await resolveKuboRpcUrl(dataPath, process.env["KUBO_RPC_URL"], defaults.KUBO_RPC_URL),
            enabled: status.enabled,
            certificates: status.certificates,
            announce: status.addresses,
            autonat: true,
            ...(override ? { publicIps: override.split(",") } : config?.publicIps.length ? { publicIps: config.publicIps } : {}),
            ...(httpsPort ? { httpsPort } : {}),
            ...(config?.httpPort ? { httpPort: config.httpPort } : {}),
            ...(config ? { caddyAdminPort: config.caddyAdminPort } : {}),
            // Without WSS, setup leaves kubo without this listener on purpose, so its absence is no problem.
            ...(config && config.serveWss !== false ? { wsPort: config.wsPort } : {})
        });
        // Only a node setup does not manage: on one it does, kubo-announce and the daemon's own checks cover these addresses.
        const unmanagedAddresses = status.configured
            ? []
            : await verifyUnmanagedAddresses({ running: facts.kuboRunningAnnounce, config: facts.kuboConfigAnnounce, ...(override ? { treatAsPublic: override.split(",") } : {}) });
        const evidence = autonatEvidence(facts.kuboAutonat);
        const browserCheck = status.configured ? undefined : browserAddressCheck(unmanagedAddresses, evidence);
        const checks = [
            publicAddressAnnouncedCheck({
                running: facts.kuboRunningAnnounce,
                inContainer: facts.inContainer,
                ...(override ? { treatAsPublic: override.split(",") } : {})
            }),
            ...(browserCheck ? [browserCheck] : []),
            ...evaluateChecks({ ...facts, verifiedWss: unmanagedAddresses.filter(({ status }) => status === "ok").map(({ address }) => address) })
        ];
        const printChecks = () => {
            this.log("Requirements:");
            for (const check of checks) this.log(formatCheck(check));
        };

        if (!status.configured) {
            if (status.declined) this.log(DECLINED_STATUS_LINE);
            else for (const line of notConfiguredSummary(unmanagedAddresses, evidence)) this.log(line);
            printChecks();
            return { ...status, unmanagedAddresses, checks };
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
        return { ...status, unmanagedAddresses, checks };
    }
}
