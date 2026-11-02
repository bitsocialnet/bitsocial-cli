import type { PortHolder } from "./discovery.js";

const EOL = "\n";

export const ACME_NOTICE =
    "This requests certificates from Let's Encrypt. By running this command you accept their Subscriber Agreement: " +
    "https://letsencrypt.org/repository/. No email address is sent.";

export const setcapCommand = (binaryPath: string) => `sudo setcap cap_net_bind_service=+ep ${JSON.stringify(binaryPath)}`;
export const UNPRIVILEGED_PORT_SYSCTL = "sudo sysctl -w net.ipv4.ip_unprivileged_port_start=443";

export function bindDeniedGuidance(options: { inContainer: boolean; caddyPath: string; platform: string }): string {
    if (options.inContainer)
        return [
            "Caddy may not bind port 443 inside this container. Add one of these to your compose file:",
            "  cap_add:",
            "    - NET_BIND_SERVICE",
            "or map host port 443 to a port above 1024 inside the container."
        ].join(EOL);
    return [
        "Caddy may not bind port 443 as a non-root user. Run one of these, then rerun setup:",
        `  ${setcapCommand(options.caddyPath)}`,
        `  ${UNPRIVILEGED_PORT_SYSCTL}   (also lets kubo bind UDP 443; persist it in /etc/sysctl.d/)`
    ].join(EOL);
}

// kubo logs nothing and keeps running when it cannot bind a listener, so this is the only signal.
export function webTransportNotListeningGuidance(options: { inContainer: boolean; kuboPath: string; platform: string }): string {
    const intro = "kubo is not listening on UDP 443, so WebTransport still depends on UDP 4001.";
    if (options.inContainer) return `${intro} Add cap_add: NET_BIND_SERVICE to your compose file and publish 443/udp.`;
    if (options.platform !== "linux") return `${intro} Check that nothing else holds UDP 443.`;
    return [
        `${intro} Run one of these, then restart the daemon:`,
        `  ${UNPRIVILEGED_PORT_SYSCTL}   (persist it in /etc/sysctl.d/)`,
        `  ${setcapCommand(options.kuboPath)}   (lost whenever kubo is updated)`
    ].join(EOL);
}

export const windowsFirewallGuidance = () =>
    [
        "Allow inbound traffic through Windows Firewall, from an elevated prompt:",
        '  netsh advfirewall firewall add rule name="bitsocial reachability TCP" dir=in action=allow protocol=TCP localport=443',
        '  netsh advfirewall firewall add rule name="bitsocial reachability UDP" dir=in action=allow protocol=UDP localport=443'
    ].join(EOL);

export function busyPortMessage(holder: PortHolder | undefined): string {
    const name: Record<PortHolder, string> = {
        nginx: "nginx",
        apache: "Apache",
        caddy: "another Caddy",
        iis: "IIS or another HTTP.sys service",
        other: "another program"
    };
    return `TCP 443 is held by ${holder ? name[holder] : "another program"}, so this node cannot serve its own IP certificate.`;
}

export const IPV6_ONLY_CAVEAT = "Only IPv6 succeeded. Browsers on IPv4-only networks still cannot reach this node over WSS.";
export const NO_IPV6_HINT = "This machine has no global IPv6 address. Enabling it would give browsers a second path.";

export const unreachableStatement = (reason: string) =>
    [
        `Neither WSS nor WebTransport can reach this machine from the internet: ${reason}.`,
        "Any one of these would change that: a public IPv4 address from your ISP, global IPv6, a router that allows UPnP or manual port forwarding, or a domain on a reverse proxy that can reach this node (--domain)."
    ].join(EOL);

// A real WebSocket upgrade through the terminator to kubo, which answers 101 when the whole path works.
export const testCommandHint = (host: string, port: number) =>
    "Test from another network while the daemon runs (expect 101):\n" +
    `  curl -sS --http1.1 -o /dev/null -w '%{http_code}\\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://${host.includes(":") ? `[${host}]` : host}${port === 443 ? "" : `:${port}`}/`;
