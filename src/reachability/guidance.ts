import type { PortHolder } from "./discovery.js";

const EOL = "\n";

export const ACME_NOTICE =
    "This requests certificates from Let's Encrypt. By running this command you accept their Subscriber Agreement: " +
    "https://letsencrypt.org/repository/. No email address is sent.";

export const setcapCommand = (binaryPath: string) => `sudo setcap cap_net_bind_service=+ep ${JSON.stringify(binaryPath)}`;
export const UNPRIVILEGED_PORT_SYSCTL = "sudo sysctl -w net.ipv4.ip_unprivileged_port_start=443";

export const isBindDenied = (caddyOutput: string) => /permission denied/i.test(caddyOutput) && /bind|listen/i.test(caddyOutput);

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
        `  ${setcapCommand(options.caddyPath)}   (lost whenever an upgrade brings a new Caddy)`,
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

export const TAILSCALE_FUNNEL_DOC = "https://github.com/bitsocialnet/bitsocial-cli/blob/master/docs/tailscale-funnel.md";

const funnelHostSteps = (wsPort: number) => [
    "  1. Install Tailscale (https://tailscale.com/download) and sign in.",
    "  2. Rename this machine in Tailscale's admin console unless its name may be public: the name is published for good.",
    `  3. Run: tailscale funnel --bg ${wsPort}     (the first run prints a link to approve Funnel)`,
    "  4. A minute later, once the name resolves, run: bitsocial reachability setup --announce /dns4/<machine>.<tailnet>.ts.net/tcp/443/tls/ws"
];

// For a node the internet cannot reach on TCP 443. Tailscale's relays take the connection and tailscaled on this
// machine ends TLS, so nothing has to be opened on a router. Setup does not run Tailscale itself.
// In a container Tailscale runs in a sidecar, which the compose example carries, so there is nothing to install here.
export const tailscaleFunnelGuidance = (wsPort: number, inContainer = false) =>
    [
        "One tested way to give this node a browser-reachable address without opening ports is Tailscale Funnel.",
        "It is free with a one-time signup, and browser connections then pass through Tailscale's relays:",
        ...(inContainer
            ? [
                  "  1. Pick a machine name that may be public: the name is published for good.",
                  `  2. Add the Tailscale sidecar from docker-compose.example.yml, forwarding to 127.0.0.1:${wsPort}, and start it.`,
                  "  3. A minute later, once the name resolves, run in this container: bitsocial reachability setup --announce /dns4/<machine>.<tailnet>.ts.net/tcp/443/tls/ws"
              ]
            : funnelHostSteps(wsPort)),
        `Walkthrough, Docker, and what Tailscale can see: ${TAILSCALE_FUNNEL_DOC}`
    ].join(EOL);

export const tailscaleFunnelFix = (wsPort: number) =>
    `Tailscale Funnel can give this node a browser address without opening ports, by forwarding to 127.0.0.1:${wsPort}. Rerun setup for the steps, or see ${TAILSCALE_FUNNEL_DOC}`;

// A handshake from this machine may never leave it, so a proxied address still needs a look from outside.
export const proxiedAddressTestHint = (address: string): string | undefined => {
    const match = address.match(/^\/(?:dns[46]?|ip[46])\/([^/]+)\/tcp\/(\d+)\//);
    if (!match) return undefined;
    return `The handshake above came from this machine, which does not prove other networks can connect through ${address}.\n${testCommandHint(match[1]!, Number(match[2]))}`;
};

// A real WebSocket upgrade through the terminator to kubo, which answers 101 when the whole path works.
export const testCommandHint = (host: string, port: number) =>
    "Test from another network while the daemon runs (expect 101):\n" +
    `  curl -sS --http1.1 -o /dev/null -w '%{http_code}\\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://${host.includes(":") ? `[${host}]` : host}${port === 443 ? "" : `:${port}`}/`;

export function reverseProxySnippet(holder: PortHolder | undefined, domain: string, wsPort: number): string {
    const nginx = [
        "server {",
        "    listen 443 ssl;",
        `    server_name ${domain};`,
        "    # ssl_certificate and ssl_certificate_key as for your other sites",
        "    location / {",
        `        proxy_pass http://127.0.0.1:${wsPort};`,
        "        proxy_http_version 1.1;",
        "        proxy_set_header Upgrade $http_upgrade;",
        '        proxy_set_header Connection "upgrade";',
        "        proxy_set_header Host $host;",
        "        proxy_read_timeout 86400s;",
        "    }",
        "}"
    ].join(EOL);
    const apache = [
        "<VirtualHost *:443>",
        `    ServerName ${domain}`,
        "    # SSLEngine and certificate lines as for your other sites",
        "    RewriteEngine On",
        "    RewriteCond %{HTTP:Upgrade} =websocket [NC]",
        `    RewriteRule /(.*) ws://127.0.0.1:${wsPort}/$1 [P,L]`,
        "</VirtualHost>",
        "# requires: a2enmod proxy proxy_wstunnel rewrite ssl"
    ].join(EOL);
    const caddy = `${domain} {${EOL}    reverse_proxy 127.0.0.1:${wsPort}${EOL}}`;
    const snippet = holder === "apache" ? apache : holder === "caddy" ? caddy : nginx;
    const server = holder === "apache" ? "Apache" : holder === "caddy" ? "Caddy" : "nginx";
    const intro =
        holder === "apache" || holder === "caddy" || holder === "nginx"
            ? `Add this to ${server} so it forwards ${domain} to kubo:`
            : `Forward ${domain} to kubo with WebSocket upgrades through your server on port 443. For example, in nginx:`;
    return [intro, "", snippet, "", `Then run: bitsocial reachability setup --domain ${domain} --announce /dns4/${domain}/tcp/443/tls/ws`].join(EOL);
}

export const dnsMismatchMessage = (domain: string, resolved: string[], publicIps: string[]) =>
    [
        `${domain} does not point at this machine.`,
        `  It resolves to: ${resolved.join(", ") || "nothing"}`,
        `  This machine's public addresses: ${publicIps.join(", ") || "none found"}`,
        "Fix the DNS record, or pass --force if a proxy in front of this machine is meant to answer for it."
    ].join(EOL);

// For a server we do not own on the HTTPS port, and no domain. We only print: it may be serving other sites.
export function existingServerGuidance(holder: PortHolder | undefined, ip: string, wsPort: number, httpsPort = 443): string {
    const site = ip.includes(":") ? `[${ip}]` : ip;
    const announce = `/${ip.includes(":") ? "ip6" : "ip4"}/${ip}/tcp/${httpsPort}/tls/ws`;
    const caddyRoute = [
        "To serve browsers through it, add this site to its Caddyfile and reload it:",
        "",
        `https://${site} {`,
        "    tls {",
        "        issuer acme {",
        "            profile shortlived",
        "        }",
        "    }",
        `    reverse_proxy 127.0.0.1:${wsPort}`,
        "}",
        "",
        "Its global options must also keep it off UDP 443, which kubo needs for WebTransport:",
        "",
        "{",
        "    servers {",
        "        protocols h1 h2",
        "    }",
        "}",
        "",
        `Then run: bitsocial reachability setup --announce ${announce}`
    ].join(EOL);
    const domainRoute = "Point a domain at this machine, then run: bitsocial reachability setup --domain <name>. It prints a forwarding snippet for your server.";
    const intro = "Setup will not change the program holding TCP 443.";
    if (holder === "caddy") return [intro, caddyRoute].join(EOL);
    if (holder === undefined) return [intro, "If it is Caddy:", caddyRoute, "", `Otherwise: ${domainRoute}`].join(EOL);
    return [intro, `It cannot obtain a certificate for an IP address by itself. ${domainRoute}`].join(EOL);
}

export const noWssStatement = (reason: string) =>
    `Browsers cannot reach this node over WSS yet: ${reason}. WebTransport on UDP 443 is configured, for browsers that support it, if inbound UDP reaches this machine.`;
