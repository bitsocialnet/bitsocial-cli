import { Command, Flags } from "@oclif/core";
import defaults from "../../../common-utils/defaults.js";
import { evaluateChecks, formatCheck, gatherCheckFacts, noWssAddressCheck, publicAddressAnnouncedCheck, type ReachabilityCheck } from "../../../reachability/checks.js";
import { resolveKuboBinaryPath } from "../../../ipfs/startIpfs.js";
import { readReachabilityConfig, readReachabilityStatus, type ReachabilityStatus } from "../../../reachability/state.js";
import { autonatEvidence, browserAddressCheck, verifyUnmanagedAddresses, type UnmanagedAddress } from "../../../reachability/unmanaged.js";
import { connectivityVerdict, formatConnectivity, type Connectivity } from "../../../reachability/verdict.js";
import { resolveKuboRpcUrl } from "../../../util.js";

const DECLINED_STATUS_LINE = "Reachability: declined. To turn it on, run: bitsocial reachability setup";
const NOT_CONFIGURED_STATUS_LINE = "Reachability: not configured. To add WSS, run: bitsocial reachability setup";

export default class Status extends Command {
    static override description =
        "Show whether desktop nodes and browsers can connect to this node, then why: mode, announced addresses, certificate expiry, last checks, and whether each requirement is met, including permission to bind UDP 443";

    static override enableJsonFlag = true;

    static override flags = {
        "pkcOptions.dataPath": Flags.directory({
            description: "Data path of the node",
            required: false
        })
    };

    static override examples = ["bitsocial reachability status", "bitsocial reachability status --json"];

    async run(): Promise<ReachabilityStatus & { connectivity: Connectivity; unmanagedAddresses: UnmanagedAddress[]; checks: ReachabilityCheck[] }> {
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
        // A handshake with each WSS address kubo announces, setup's own included. A disabled node's Caddy is off on purpose,
        // so its addresses are skipped, but any other stays: disable restores AutoTLS, which may announce one of its own.
        const wssDisabled = status.configured && !status.enabled;
        const servesWss = config !== undefined && config.serveWss !== false && config.announce.length > 0;
        // A setup without WSS gets "run setup to add WSS" even while disabled, since enable would restore it without WSS.
        const setupWss = status.configured && servesWss ? (wssDisabled ? ("disabled" as const) : ("enabled" as const)) : undefined;
        const setupAddresses = wssDisabled ? (config?.announce ?? []) : [];
        const notSetups = (addresses: string[] | undefined) => addresses?.filter((address) => !setupAddresses.some((own) => address === own || address.startsWith(`${own}/p2p/`)));
        const wssAddresses = await verifyUnmanagedAddresses({
            running: notSetups(facts.kuboRunningAnnounce),
            config: notSetups(facts.kuboConfigAnnounce),
            ...(override ? { treatAsPublic: override.split(",") } : {})
        });
        // Only a node setup does not manage reports these: on one it does, kubo-announce and the daemon's own checks cover them.
        const unmanagedAddresses = status.configured ? [] : wssAddresses;
        const evidence = autonatEvidence(facts.kuboAutonat);
        const browserCheck = config
            ? noWssAddressCheck({
                  announce: config.announce,
                  wsPort: config.wsPort,
                  tcp443: facts.tcp443,
                  otherWssWorks: wssAddresses.some(({ status }) => status === "ok"),
                  droppedName: (config.droppedAnnounce ?? []).length > 0
              })
            : browserAddressCheck(unmanagedAddresses, evidence);
        const announcedCheck = publicAddressAnnouncedCheck({
            running: facts.kuboRunningAnnounce,
            inContainer: facts.inContainer,
            ...(override ? { treatAsPublic: override.split(",") } : {})
        });
        const connectivity = connectivityVerdict({
            kuboRunning: facts.kuboRunningAnnounce !== undefined,
            publicAddressAnnounced: announcedCheck.status === "ok",
            announced: facts.kuboRunningAnnounce ?? [],
            autonat: facts.kuboAutonat,
            wss: wssAddresses,
            ...(setupWss ? { setupWss } : {})
        });
        const checks = [
            announcedCheck,
            ...(browserCheck ? [browserCheck] : []),
            // Every handshake that worked, setup's own included: one through an operator's server shows that server on the port is no problem.
            ...evaluateChecks({ ...facts, verifiedWss: wssAddresses.filter(({ status }) => status === "ok").map(({ address }) => address) })
        ];
        const printChecks = () => {
            this.log("Requirements:");
            for (const check of checks) this.log(formatCheck(check));
        };

        for (const line of formatConnectivity(connectivity)) this.log(line);
        if (!status.configured) {
            this.log(status.declined ? DECLINED_STATUS_LINE : NOT_CONFIGURED_STATUS_LINE);
            printChecks();
            return { ...status, connectivity, unmanagedAddresses, checks };
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
        return { ...status, connectivity, unmanagedAddresses, checks };
    }
}
