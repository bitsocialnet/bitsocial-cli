# Reachability

`bitsocial reachability` makes this machine's kubo dialable from browsers, checks that it worked, and keeps it working from the daemon. It sets up two of the ways a browser can dial a node:

- **WebSocket Secure (WSS):** needs a certificate browsers trust. kubo cannot load a certificate itself, so a TLS terminator sits in front of it.
- **WebTransport:** needs no certificate authority, but only works for browsers that support it, and only if inbound UDP reaches the machine. Some ISPs filter UDP 4001, so kubo also listens on UDP 443.

## Commands

```bash
bitsocial reachability setup     # discover, configure, get a certificate, verify; safe to rerun
bitsocial reachability status    # mode, addresses, certificate expiry, last checks, requirements; --json for scripts
bitsocial reachability enable    # repair and turn back on from the stored choices, never asks anything
bitsocial reachability disable   # stop serving and restore the kubo config; --purge also moves the state to a backup
```

All take `--pkcOptions.dataPath`. `setup` also takes:

| Flag | Meaning |
| --- | --- |
| `--domain <name>` | A domain pointing at this machine, to get a certificate for or to forward through your own server |
| `--announce <multiaddr>` | An address your own server serves. Announced only after a real libp2p handshake through it succeeds |
| `--force` | Continue when the domain does not resolve to this machine, for a proxy in front of it. Remembered for later runs |
| `--staging` | Use the Let's Encrypt staging CA, whose certificates browsers do not trust |
| `--non-interactive` | Never ask. Prompts already only appear when stdin is a TTY |

Exit codes: `0` done (read the output, since this can still mean no WSS, e.g. no public address was found), `1` refused (a domain that does not point here, a failed `--announce`), `2` you have to act first, and nobody could be asked.

### Declining

Reachability is off until you decide. While a node has never run `setup`, the daemon reminds you every hour (see [Addresses `setup` does not manage](#addresses-setup-does-not-manage)). To say no, run `disable` on that node. It changes nothing in kubo, records the decline in `<dataPath>/reachability-declined`, and the reminders stop, including on a daemon that is already running. On a declined node the daemon logs one line at start and nothing after it, and `status` says `declined` (`"declined": true` in `--json`).

The marker sits outside `reachability/`, so `disable --purge` keeps it. Purging a node that was set up also records a decline, because without its config the node would otherwise look undecided again. Running `setup` deletes the marker. A node with a config never counts as declined, even a disabled one, because its config is already the decision. `enable` still needs `setup` first.

## How it works

```
browser ──wss://<ip or domain>:443──▶ Caddy ──ws://127.0.0.1:<wsPort>──▶ kubo
browser ──WebTransport, UDP 443──────────────────────────────────────▶ kubo
```

`setup` runs these steps in order:

1. **Read the kubo config**, creating the repo the way the daemon does if it does not exist yet.
2. **Find public addresses:** from interfaces and kubo's addresses, excluding the addresses we told kubo to announce, so an old IP cannot confirm itself. With no public IPv4 on an interface, it also asks the router over UPnP for its external IP and to forward TCP 443, TCP 80 and UDP 443. No third-party "what is my IP" service is used.
3. **Report requirements** (see [Troubleshooting](#troubleshooting)). It reports and carries on: each path below says what it managed.
4. **Choose a path** and get certificates, waiting up to 90 s. Issuance succeeding is the proof that the internet reached this machine.
5. **Apply the kubo config** and restart kubo through `POST /api/v0/shutdown`, only if the config changed or running kubo is not announcing the addresses. The daemon's watchdog brings kubo back.
6. **Check what kubo really listens on**, because kubo keeps running and logs nothing when it cannot bind a port.

Reruns keep the stored choices and only add or repair. A rerun that cannot get any certificate, or finds no public address, leaves a node already serving WSS exactly as it was, and with `--announce` it is refused. Everything that succeeded is announced together, and `mode` records the combination, e.g. `ip+domain`.

## Choosing a path

| Your situation | What to run | Result |
| --- | --- | --- |
| TCP 443 is free, no domain | `setup` | Let's Encrypt certificate for the IP (`shortlived` profile, 160 h, renewed by Caddy). Follows IP changes by itself |
| TCP 443 is free, you have a domain | `setup --domain node.example` | IP certificate where possible, plus a 90-day certificate for the name. Browsers get two independent paths |
| Another Caddy holds TCP 443 | `setup`, then add the printed site to that Caddy, then `setup --announce /ip4/<ip>/tcp/443/tls/ws` | That Caddy gets the IP certificate and forwards to kubo |
| nginx, Apache or IIS holds TCP 443 | `setup --domain node.example`, then add the printed snippet, then `setup --domain node.example --announce /dns4/node.example/tcp/443/tls/ws` | Your server terminates TLS. These cannot get an IP certificate by themselves |
| No public address, no UPnP | Nothing here will help | `setup` states what would change that |

`setup` never stops or edits a server it does not own. To replace one with bitsocial-cli's own Caddy, remove your hand-added address from `Addresses.AppendAnnounce` in the kubo config, stop the other server, then run `setup`. An existing `/ip4/127.0.0.1/tcp/<port>/ws` listener is reused.

### Addresses `setup` does not manage

A node can already serve WSS without `setup`, through a reverse proxy set up by hand or an AutoTLS address. `configured` in `status --json` only means `setup` has run (`config.json` exists), so it stays `false` on these nodes and says nothing about whether browsers can connect.

On a node without `config.json`, `status` tries a real libp2p handshake with every public `/tls/ws`, `/wss` and `/tls/sni/<name>/ws` address kubo announces, and lists the results in `unmanagedAddresses` (`--json`) and the `browser-address` check. Each is `ok`, `failed` or `unconfirmed` with the reason, or `unverified`. It skips relay addresses and private IPs, and a name that resolves only to private addresses counts as failed. While kubo is down, `status` lists the addresses in kubo's config as `unverified`.

A failed handshake is `failed` when every IP the address leads to is on one of the node's own interfaces, or the name resolves to nothing, because the node reaches its own IP directly. Any other IP goes through a router, which may not connect a machine to its own public address (no NAT hairpin), so that failure is `unconfirmed`: the `browser-address` check warns instead of failing.

`status` says browsers cannot reach the node only when no such address exists or every handshake is `failed`. A handshake from the node itself does not prove other networks can connect, because traffic to a machine's own address does not cross a provider's firewall.

The daemon does the same check in the background when it starts. With an address to check, it tries for about 2 minutes, because kubo may still be starting, and then either logs the working address or warns once with the addresses that failed or could not be confirmed.

With no such address, the daemon warns straight away only if `AutoTLS.Enabled` is `false` or kubo's config cannot be read. Otherwise it logs that AutoTLS may still be getting a certificate and keeps checking, because kubo shows no AutoTLS address until then: for 20 minutes if `AutoTLS.Enabled` is `true`, as on repos this CLI creates, and 80 minutes if it is unset, since kubo then adds an hour's delay. If nothing appears, it warns. Behind NAT without inbound access, the certificate never comes, so this warning is correct there, just later.

While nobody has decided, by running `setup` or declining with `disable`, the daemon repeats this check every hour. It is a single attempt without the AutoTLS wait, and is skipped while the startup check is still running. It warns each hour no browser address works, but logs a working one only when that changes, so a node that works stays quiet. The check stops as soon as a config or the decline appears, including during the startup AutoTLS wait. `status` reports the moment it runs and does not wait, so it can say browsers cannot reach a node whose certificate is still on its way.

Until something can terminate WSS, kubo only gets its UDP 443 listeners. AutoTLS and the loopback filter stay as they were, so a failed attempt costs nothing.

### IP changes with your own proxy

A proxy serving an IP address has that address hard-coded in its config and in `--announce`. **If the IP changes, you must update both.** The daemon does not check `/ip4` addresses served by your own proxy, so an old one stays announced. On a dynamic IP, use a domain instead. The daemon does check `/dns4` names, as described below.

## What changes in the kubo config

All of it comes from one pure function, `computeKuboConfig` in `src/reachability/kubo-config.ts`. `disable` restores these fields byte for byte, which is a tested property.

| Field | Change | Why |
| --- | --- | --- |
| `Addresses.Swarm` | Adds UDP 443 `quic-v1` and `quic-v1/webtransport` for IPv4 and IPv6 | WebTransport past filtered UDP 4001 |
| `Addresses.Swarm` | Adds `/ip4/127.0.0.1/tcp/<wsPort>/ws`, 4002 unless taken | What the terminator forwards to |
| `Addresses.AppendAnnounce` | One entry per verified address | What peers and routers hand out |
| `Swarm.AddrFilters` | Removes `/ip4/127.0.0.0/ipcidr/8` | The `server` profile adds it, and it rejects connections from a local terminator |
| `AutoTLS.Enabled` | `false` | Flip it back by editing the kubo config. Repairs and `disable` keep your choice |

Only the first row applies until something can terminate WSS.

`config.json` records exactly what was changed (`kuboEdits`). That tells our entries apart from identical ones you wrote, so `disable` removes only the copies it added and leaves yours alone, along with anything you added while enabled. One exception: a loopback filter you put back is removed again on the next apply, because it blocks the terminator.

## Where things live

```
<dataPath>/reachability/
├── config.json           # your choices, versioned; a newer version than this CLI understands is refused
├── runtime-status.json   # the daemon's last checks; only the daemon writes it
├── Caddyfile             # generated, do not edit
├── bin/caddy-<version>   # downloaded on first setup
├── caddy-data/           # certificates and the ACME account
└── caddy-config/
```

`disable` keeps all of this, so `enable` reuses the ACME account and certificates and spends no rate limit. `disable --purge` moves it to `<dataPath>/reachability.bak-<timestamp>/`. It is moved rather than deleted because it holds private keys.

Caddy is downloaded from its GitHub release and checked against a sha256 pinned in source. No email is sent to Let's Encrypt; running `setup` means accepting their Subscriber Agreement.

## What the daemon does

When `config.json` exists and is enabled, the daemon runs Caddy as a child process. This is skipped when you point the daemon at an external kubo with `--pkcOptions.kuboRpcClientsOptions`. A failure here logs a warning and never stops the daemon.

| When | What |
| --- | --- |
| At start | Logs browser addresses and certificate expiry. With nothing configured, checks for addresses `setup` does not manage and warns, naming `setup`, if none work. On a declined node, logs one line |
| Every hour, while undecided | Repeats that check once and warns again if nothing works (see [Declining](#declining)) |
| Every 5 s | Starts, reloads or stops Caddy to match the stored state, so `setup`, `enable` and `disable` apply to a running daemon and a crashed Caddy comes back |
| Every 5 min | Re-derives public IPs, verifies announced names, checks certificate expiry |
| At start and every 20 min | Renews router forwards when there is no public IPv4 on an interface. They are released on shutdown or once disabled |

**IP changes.** A new address must be seen on two checks in a row, and finding nothing for an address family is not treated as a change. The daemon then rewrites the Caddyfile, reloads Caddy, waits for the certificate, updates `AppendAnnounce` and restarts kubo. If no certificate can be issued at all, it keeps the stored addresses.

If only some can be, it moves to those.

Either way it waits before asking again for the family that failed: 1 hour, doubling up to 24, until `setup` or a retry gets that family a certificate. Let's Encrypt allows 5 failed validations per address per hour, so retrying sooner could keep a node locked out after its forwarding is fixed. This also covers the common case of a global IPv6 behind a router's firewall, which would otherwise look new on every check. The wait is held in memory, so restarting the daemon tries again straight away, and so does running `setup`.

**Stale names.** A `/dns4` or `/dns6` name that stops pointing here warns once an hour and is dropped from `AppendAnnounce` after 24 hours of failure, a count that survives daemon restarts. It is announced again when it recovers. Rerunning `setup` can also announce it again, which starts a new 24 hours. Rerunning `setup` while a name still points elsewhere stops announcing it straight away, and the daemon announces it again when it recovers. The name keeps its Caddy site throughout, so its certificate is there when it does. The exception is another server holding TCP 443, where the name waits for `setup` to be run again. Moving to another `--domain` forgets a dropped name for the old one. Names you passed with `--force` or `--announce` only have to resolve, because a proxy answers for them.

**Certificates.** Caddy renews them. The daemon warns when one has under 24 hours left, which means renewal is failing.

The daemon sends stderr only to its log file, so these messages go to stdout where operators can see them.

## Troubleshooting

`bitsocial reachability status` lists each requirement with its fix (`checks` in `--json`).

| Check | Meaning |
| --- | --- |
| `public-address` | No public address on an interface. `setup` also tries the router and kubo |
| `browser-address` | Without `setup`: the handshake results for the WSS addresses kubo announces. See [Addresses `setup` does not manage](#addresses-setup-does-not-manage) |
| `tcp-443` | Held by another program, or Caddy may not bind it. `ok` if an address on that port passed the handshake, as the program is then serving it |
| `udp-443` | Held by another program, or kubo may not bind it. kubo would otherwise run normally and silently not listen. When kubo cannot use it and a WSS address passed the handshake, this follows AutoNAT's result for WebTransport on kubo's other UDP port: `ok` if reached, otherwise `warn` |
| `tcp-80` | A warning only: Let's Encrypt can still validate through TCP 443 |
| `firewall` | An active `ufw` or `firewalld` does not appear to allow port 443 |
| `daemon`, `kubo-ws` | With reachability enabled: the daemon is down, or kubo lacks the listener Caddy forwards to. `kubo-ws` is skipped when `setup` left the node without WSS |
| `kubo-announce` | With reachability enabled: an address is missing from kubo's config, or running kubo does not announce it, so browsers cannot learn it. `reachability enable` repairs the config and restarts kubo. An entry in `Addresses.NoAnnounce` that matches the address hides it even then |
| `certificate` | Under 24 hours left |
| `inbound` | AutoNAT v2's result for each of kubo's TCP and UDP addresses: `ok` if any was reached, `warn` if none of those tested were. It is `unknown` until there are results or while kubo is down. It tests AutoTLS addresses on kubo's own listener, but did not list an address that is only announced, as one behind a reverse proxy is. Only a connection from another network can prove that one |

**Linux, not root.** Both Caddy (TCP) and kubo (UDP) need permission for port 443, and `setcap` on one does not help the other. The sysctl covers both:

```bash
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=443   # persist it in /etc/sysctl.d/
```

Otherwise use `sudo setcap cap_net_bind_service=+ep <binary>` on each. This is lost whenever kubo updates, and for Caddy whenever an upgrade changes `CADDY_VERSION`, because each version is a new file. The daemon cannot grant the capability itself, so when Caddy may not bind the port it warns with the command for the new binary. `status` reports the same under `tcp-443`.

**Docker.** Add `cap_add: [NET_BIND_SERVICE]`, and publish `443:443/tcp`, `443:443/udp` and `80:80/tcp`. The image sets `KUBO_RPC_URL` and `IPFS_GATEWAY_URL`, and these beat the kubo config.

**Windows.** `setup` prints the `netsh advfirewall` rules to add. HTTP.sys and IIS show up as holding TCP 443.

**Testing from outside.** `setup` prints a `curl` command that performs a real WebSocket upgrade. Run it from another network and expect `101`. Add `-k` for `--staging`. `curl` may then appear to hang or report a timeout, because the WebSocket stays open.

## Known limits

- **NAT-PMP is not supported**, only UPnP, and a machine forwarded by hand may not find its public IP. See [#210](https://github.com/bitsocialnet/bitsocial-cli/issues/210).
- **IPv4 and IPv6 get separate certificates**, because Caddy obtains one per address.

## For maintainers

**Layout.** The kubo edits are pure (`kubo-config.ts`). `setup.ts` is the one-shot flow, `runtime.ts` the daemon side, `lifecycle.ts` `disable` and `--purge`, `checks.ts` the requirements, `guidance.ts` the printed messages.

**Bumping Caddy.** Change `CADDY_VERSION` and all six entries of `CADDY_RELEASE_SHA256` in `src/reachability/caddy.ts`, in one commit. Compute the sha256 of each archive, and check the archives against the SHA-512 `checksums.txt` on the release first. Pinning in source matters because that file shares the download's origin.

**Caddyfile settings that matter**, all learned by running it (`generateCaddyfile`):

| Setting | Why |
| --- | --- |
| `protocols h1 h2` | Caddy's default HTTP/3 would take UDP 443 from kubo |
| `auto_https disable_redirects` | Otherwise Caddy binds TCP 80 and fails to start if anything holds it |
| `default_sni <ip>` | Browsers send no SNI for an IP, and behind NAT the local address is not the public IP |
| Explicit `issuer acme { dir }` | Let's Encrypt only, with no implicit fallback CA |

**Moving CA needs a restart.** A reload keeps serving the old CA's cached certificate and orders nothing, so `setup` stops Caddy when the ACME directory changes, e.g. from `--staging` to production. A running daemon brings it back.

**Whose Caddy is it?** Something answering on the stored admin port is not proof. `isOurCaddyRunning` checks that Caddy reports storing in this node's data directory, and we never stop or reload anything else.

**Tests.** Integration tests use [Pebble](https://github.com/letsencrypt/pebble), Let's Encrypt's test CA, pinned in `test/helpers/pebble.ts`. These environment variables replace the real CA and public address, and exist only for tests:

| Variable | Replaces |
| --- | --- |
| `BITSOCIAL_TEST_REACHABILITY_ACME_DIRECTORY` | Let's Encrypt. The others are ignored without it |
| `BITSOCIAL_TEST_REACHABILITY_ACME_ROOT` | The CA root Caddy trusts |
| `BITSOCIAL_TEST_REACHABILITY_PUBLIC_IPS` | Public address discovery |
| `BITSOCIAL_TEST_REACHABILITY_HTTPS_PORT`, `_HTTP_PORT`, `_WS_PORT` | Ports 443, 80 and 4002 |

- `setup` refuses the production Let's Encrypt directory when `CI` is set.
- Node's global `WebSocket`, which libp2p uses, ignores TLS options. To trust Pebble, run the dial in a child process with `NODE_EXTRA_CA_CERTS`.
- Other test files' kubos bind random ports, so a port chosen by a test can be taken before it is used (#87). Retry with a fresh port when that happens, and do not check "is this UDP port free" as a test assertion.
