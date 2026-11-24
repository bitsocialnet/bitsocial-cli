# Tailscale Funnel: a browser address for a node behind NAT

`bitsocial reachability setup` gives a node a WSS address only when the internet can reach it on TCP 443. A node behind NAT or carrier-grade NAT, with no UPnP and no port forwarding, cannot get one. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) is one tested way around that: it gives the machine a public `<machine>.<tailnet>.ts.net` name with a Let's Encrypt certificate and forwards connections to it, with nothing opened on the router. It is on every Tailscale plan, including the free one.

**Prefer an address of the node's own when it can have one.** If the node has a public IP and the internet reaches it on TCP 443, use the WSS address a plain `bitsocial reachability setup` creates for that IP or for your domain. Browsers then connect straight to the node, with no third party in the path, no unpublished bandwidth limit, and no relay path between the browser and the node that can slow down. Funnel is the fallback for a node that cannot get such an address: behind NAT or carrier-grade NAT, with no UPnP and no port forwarding. A node that has both can keep Funnel [as a second address](#as-a-second-address), but should not replace its own address with it.

bitsocial-cli does not install or run Tailscale. `setup` prints the steps below when it applies, and `status` points at this page. Read [What you are trusting Tailscale with](#what-you-are-trusting-tailscale-with) before you start.

```
browser ──wss://<machine>.<tailnet>.ts.net:443──▶ Tailscale relay ──WireGuard──▶ tailscaled on this machine ──ws://127.0.0.1:<wsPort>──▶ kubo
```

## When `setup` suggests it

| `setup` outcome | Funnel steps printed? |
| --- | --- |
| A WSS address was announced, by IP, domain or your own proxy | No |
| No public IPv4 or global IPv6 was found, carrier-grade NAT included | Yes |
| A public address was found, but Let's Encrypt could not reach it on TCP 80 or 443 | Yes |
| A public address was found, but Caddy may not bind TCP 443, and you declined `sudo setcap` or nobody could be asked | Yes, after the bind fix. `setup` exits `2` when nobody could be asked, with the config already written |
| Another program holds TCP 443 on a reachable node | No, the reverse proxy guidance applies |

`status` shows the same pointer in the `browser-address` check, in its `fix` field in `--json`, on a node where `setup` has run, no WSS address is announced, no WSS address that `setup` does not manage works, and no name is waiting for its DNS to be fixed. It leaves the pointer out when another program holds TCP 443 and the node has a public address, or a domain that was stored with `--force`, because the reverse proxy guidance applies there. For that it counts the machine's interfaces and the addresses running kubo reports, as `setup` does. It does not ask the router itself, so with the daemon stopped, on a node whose only public address is the router's and with another program on TCP 443, `status` shows the pointer while `setup` prints the reverse proxy guidance.

## Steps

1. **Run `bitsocial reachability setup`** while the daemon runs. It prints the port to forward, e.g. `tailscale funnel --bg 4002`. The port is kubo's loopback WebSocket port, stored as `wsPort` in `<dataPath>/reachability/config.json`. On a Linux machine with a public address and no permission to bind TCP 443, it first asks to run `sudo setcap`. Answer no to get the steps.
2. **Install Tailscale** from <https://tailscale.com/download> and sign in. On Linux that is `sudo tailscale up`. On Windows and macOS, sign in through the app. On macOS the `tailscale` command is not on the `PATH` until you install it from the app's settings under CLI integration. With the App Store version, run `/Applications/Tailscale.app/Contents/MacOS/Tailscale` in its place. See [Tailscale's CLI page](https://tailscale.com/kb/1080/cli). Funnel needs MagicDNS enabled for the tailnet. It is on by default for new tailnets. Check it on the [DNS page](https://login.tailscale.com/admin/dns).
3. **Rename the machine** in the [admin console](https://login.tailscale.com/admin/machines) unless its name may be public. The name defaults to the OS hostname, such as `johns-laptop`. It becomes part of the address every peer sees, and it is written to public Certificate Transparency logs when the certificate is issued. That cannot be undone. Renaming the tailnet is on the [DNS page](https://login.tailscale.com/admin/dns).
4. **Turn Funnel on:**

   ```bash
   tailscale funnel --bg <wsPort>
   ```

   The first run prints a link to approve HTTPS certificates and Funnel for the tailnet. Open it once, then run the command again. `--bg` keeps Funnel on across reboots. It prints the public name:

   ```
   https://<machine>.<tailnet>.ts.net/
   |-- proxy http://127.0.0.1:<wsPort>
   ```

5. **Wait until the name resolves in public DNS.** Tailscale says this can take up to 10 minutes. Check with `nslookup <machine>.<tailnet>.ts.net 1.1.1.1`. In testing, the name appeared within seconds and the first requests then failed for about a minute while the certificate was issued.
6. **Announce the address:**

   ```bash
   bitsocial reachability setup --announce /dns4/<machine>.<tailnet>.ts.net/tcp/443/tls/ws
   ```

   This adds kubo's loopback listener, restarts kubo, and completes a real libp2p handshake through the address before announcing it. The name is resolved over public DNS for this, so the handshake goes out through Tailscale's relays even when MagicDNS makes the machine resolve its own name to its tailnet address. It tries the handshake three times, 15 seconds apart. If all three fail, it puts kubo back as it was and exits `1`, and you can run it again later. It needs no permission to bind TCP 443 or 80: on a node that serves no WSS address of its own, it does not start Caddy or ask Let's Encrypt for anything, even when the machine has a public address. Nothing is listening on `<wsPort>` before this step, so until then the Funnel name answers `502`.
7. **Test from another network.** `setup` prints a `curl` command. Run it from a phone hotspot or another machine and expect `101`. `curl` then appears to hang because the WebSocket stays open. The handshake in step 6 goes through Tailscale's relays but starts on the node's own machine, so it does not prove every other network can connect.

`bitsocial reachability status` then shows `Mode: reverse-proxy`, the address under `Announced addresses`, and `Browsers: should be able to connect over WSS`.

### Checking a Funnel address

`bitsocial reachability status` checks a Funnel address in two steps and prints both under Diagnostics:

```
  [ok] The WSS handshake through /dns4/<machine>.<tailnet>.ts.net/tcp/443/tls/ws took 0.7 s
  [ok] Tailscale's Funnel ingress reaches this node in 91 ms via DERP(par)
```

1. **The handshake**, cut off after the 6 seconds a browser allows. It warns when the handshake took 3 seconds or more, and fails when it did not finish. See [How long a handshake may take](reachability.md#how-long-a-handshake-may-take).
2. **The hop from Tailscale's ingress to the node.** Funnel traffic goes from the browser to one of Tailscale's public ingress servers, and from there to the node over the tailnet. `status` reads `tailscale status --json`, picks the ingress servers that just carried the node's traffic (peers named `funnel-ingress-node` with the tag `tag:ingress`, `InEngine: true` and a `LastHandshake` in the last 5 minutes), and runs `tailscale ping` on up to three of them, three pings each, reporting the median. It warns from 500 ms, or when one does not answer.

`via DERP(...)` means the hop is relayed, and that is normal: on a node whose Funnel worked well the hop was relayed too, at 91 to 95 ms. The warning goes by latency alone. The one degraded node that was measured took about 1.9 s. The 500 ms line is drawn from those two measurements only.

The ping is best effort. `status` skips it with a one-line reason, and still runs the handshake, when the `tailscale` command is not found (on macOS it also tries `/Applications/Tailscale.app/Contents/MacOS/Tailscale`), when Tailscale is not running, stopped or logged out, or when no ingress server carried traffic in the last 5 minutes. In the Docker setup the command lives in the sidecar container, so the ping is always skipped there. To measure the hop by hand: `docker compose exec tailscale tailscale status --json`, then `docker compose exec tailscale tailscale ping <address of an ingress server>`. The peer names and JSON fields are Tailscale's own and not a documented interface, so a Tailscale update can turn the ping into a skip.

`--json` carries the result under `funnelIngress`: `status` (`ok`, `warn` or `skipped`), `note` when skipped, and `hops`, each with the ingress server's tailnet `address`, its `relay` region, `latencyMs` and `via`, or `error`.

### Turning it off

```bash
tailscale funnel --https=443 off
```

The daemon only checks that an `--announce` name resolves, and in testing the `ts.net` name still resolved 15 minutes after Funnel was turned off. So the node keeps announcing an address that no longer works. To stop announcing it, run `bitsocial reachability disable --purge`, then `setup` again. A plain `disable` keeps the address for the next `setup`.

### As a second address

A node that already has a WSS address can add a Funnel address the same way, for a second path that does not depend on its own IP certificate. Both are announced together, and `mode` records the combination, e.g. `ip+reverse-proxy`. `setup` does not suggest this by itself.

### If TCP 443 on Funnel is already used

Funnel also serves ports 8443 and 10000. Use `tailscale funnel --bg --https=8443 <wsPort>` and announce `/dns4/<machine>.<tailnet>.ts.net/tcp/8443/tls/ws`. Some networks block outbound connections to ports other than 443, so browsers on them will not reach that address.

## Docker

Tailscale runs in a sidecar container, and the bitsocial container shares its network so the sidecar can reach kubo's `127.0.0.1:<wsPort>` listener. `docker-compose.example.yml` carries the sidecar, commented out. It is optional.

1. **Create an auth key** on the [keys page](https://login.tailscale.com/admin/settings/keys). Leave it untagged, so the default Funnel policy covers the machine. Check that MagicDNS and HTTPS certificates are enabled on the [DNS page](https://login.tailscale.com/admin/dns). Funnel needs both. If Funnel was never approved for the tailnet, run `tailscale funnel 4002` once on any machine signed in to it, open the link it prints, then stop the command. An admin can instead add the `funnel` node attribute in the tailnet policy file, as [Tailscale's Funnel page](https://tailscale.com/kb/1223/funnel) describes.
2. **Edit the compose file:**
   - Uncomment `network_mode: service:tailscale` on the `bitsocial` service, the `tailscale` service, the `configs` block and the `tailscale-state` volume.
   - Move the `ports:` list from the `bitsocial` service to the `tailscale` service. A service that shares another's network cannot publish ports itself.
   - Set `hostname:` to the machine name you want. It becomes public for good.
3. **Put the key in `.env`** next to the compose file: `TS_AUTHKEY=tskey-auth-...`. The key is only used the first time. After that the sidecar's state lives in the `tailscale-state` volume.
4. **Start it:** `docker compose up -d`. The `configs` block turns Funnel on and forwards it to `127.0.0.1:4002`, the port `setup` chooses in a fresh container. `docker compose exec bitsocial bitsocial reachability setup` prints the port if you want to check.
5. **Once the name resolves in public DNS, announce the address.** This can take up to 10 minutes. Check with `nslookup <machine>.<tailnet>.ts.net 1.1.1.1`.

   ```bash
   docker compose exec bitsocial bitsocial reachability setup --announce /dns4/<machine>.<tailnet>.ts.net/tcp/443/tls/ws
   ```

   `docker compose exec tailscale tailscale funnel status` shows the name.
6. **Test from another network** with the `curl` command that prints.

Inside a container, `setup` prints these steps in place of the host ones.

This was tested with an image built from source, Docker Compose 5.5.1 and `tailscale/tailscale:latest` on 2026-11-10, with the compose example edited as above. In one run the first two handshake attempts failed while the certificate was issued and the third succeeded. The inline `configs` `content` needs Docker Compose 2.23.1 or newer. With an older one, put the JSON in a file and mount it.

## What you are trusting Tailscale with

**What Tailscale can see about you:** the account you signed in with, the machine's name, OS and Tailscale version, its real public IP, and how much Funnel traffic it gets and when. Tailscale's client also uploads logs by default. Turning that off depends on the platform: on Linux, pass `--no-logs-no-support` to `tailscaled` or set `TS_NO_LOGS_NO_SUPPORT=true`. On Windows, only the environment variable works. On macOS, the flag works only with the open source command-line `tailscaled`, not the apps. See [Tailscale's logging page](https://tailscale.com/kb/1011/log-mesh-traffic).

**What Tailscale can see about peers who connect:** their IP address and port, when they connected, for how long, and how many bytes. It cannot see content. TLS ends on your machine, and the libp2p Noise encryption runs inside it.

**Can Tailscale read the traffic?** Not without being detectable. Tailscale controls the `ts.net` DNS zone, so it could have a second certificate issued and intercept TLS. That certificate would appear in Certificate Transparency logs. Even then, browsers dial `/p2p/<peer id>`, and Noise checks kubo's key, so an interceptor would see only the WebSocket upgrade headers (User-Agent, Origin) and Noise ciphertext. It could not read pubsub content or pretend to be the node.

**What becomes public:** the `<machine>.<tailnet>.ts.net` name, in the announced address and in Certificate Transparency logs.

**Your home IP:** peers connecting through Funnel see a Tailscale relay IP, not yours. This is only partial privacy, because kubo still announces its other addresses, and those can include your public IP.

## A Funnel path can degrade

A Funnel address can become too slow for browsers to connect while everything on the node looks healthy.

**What was seen** ([#276](https://github.com/bitsocialnet/bitsocial-cli/issues/276)), once, on one of three nodes tested:

- `setup --announce` verified the address on its first attempt.
- About two hours later an iPhone Safari run could not load the community. The page showed no connection, no connection events and no errors.
- Discovery was fine: every HTTP router returned the node with its Funnel address.
- Through that node's Funnel name, the TCP connection to Tailscale's relay took 40 ms, but TLS, which `tailscaled` on the node terminates, took 5.6 to 20 s, and throughput was about 17 KB/s. Every libp2p dial failed at 6 s, which is when a browser gives up on an address.
- `tailscale ping` from the node to the ingress server took about 1.9 s. The same relay reached the node's other tailnet peers in 52 to 79 ms.
- A Funnel on a second machine on the same LAN completed TLS in 0.4 to 1.1 s at the same moment.
- Reconnecting Tailscale did not help. The cause was not found, and it has not been reproduced. It looked specific to one node on Tailscale's side.

One node out of three is not a rate. While its path was healthy, Funnel passed 21 of 21 runs on iOS Safari and several days of desktop testing.

**What follows from it.** The handshake `setup --announce` makes proves the path only at the moment it runs. An address that was verified can stop working for browsers later without anything changing on the node.

**How to check.** Run `bitsocial reachability status` on the node and read the two lines described in [Checking a Funnel address](#checking-a-funnel-address):

| Line | Healthy | Degraded |
| --- | --- | --- |
| `The WSS handshake through /dns4/<machine>.<tailnet>.ts.net/tcp/443/tls/ws took ...` | Around a second or less: `[ok]` | `[warning]` from 3 s. `[problem]` when it did not finish within 6 s, and the `Browsers:` line then no longer says they should be able to connect over WSS |
| `Tailscale's Funnel ingress reaches this node in ...` | About 90 ms, `via DERP(...)` included: `[ok]` | `[warning]` from 500 ms. About 1.9 s on the degraded node |

A slow handshake with a normal ingress latency points away from the Funnel hop, for example at the node's own uplink.

To check from outside, time the TLS handshake through the Funnel name from another network, such as a phone hotspot:

```bash
curl -sS --http1.1 -o /dev/null -w 'tcp %{time_connect}s  tls %{time_appconnect}s\n' https://<machine>.<tailnet>.ts.net/
```

`tls` is the time until TLS is done and includes the TCP connection. Around a second or less is healthy. Several seconds means browsers will time out.

**What to do.** Nothing on the node is known to repair it. A second browser path keeps the node reachable meanwhile: WebTransport if inbound UDP reaches the machine, or an address of the node's own if it can have one.

## Limits and trade-offs

- **Every browser connection passes through one company's relays.** If Tailscale has an outage, changes Funnel's terms or limits your traffic, the address stops working. WebTransport and other nodes are not affected.
- **Funnel's bandwidth limits are not published.** Tailscale says Funnel traffic is subject to limits without stating them.
- **Some connections through Funnel fail in bursts.** In testing, when 60 WebSocket upgrades were opened at once from one address on another network, 3 to 6 failed each time. Their TCP connection to Tailscale's relay needed retransmits and TLS then timed out, so they never reached the node. Upgrades made one at a time over IPv4 all succeeded. One `setup --announce` on a host also failed to connect for a reason that was not found. A browser retries, and `setup` tries its handshake three times.
- **kubo sees every Funnel peer as `127.0.0.1`.** `tailscaled` proxies locally. kubo's per-IP connection limits exempt loopback, so they do not cap Funnel connections, and they also cannot tell one Funnel peer from another. One abusive client can open many connections, held back only by kubo's global resource manager limits and connection manager. An IP ban cannot single it out. kubo's gossipsub runs without peer scoring, so sharing an IP costs Funnel peers nothing there.
- **A handshake from the node itself is not the whole proof.** `setup`, `status` and the daemon dial the address from the node's own machine. With Tailscale's MagicDNS on, a machine resolves its own `ts.net` name to its tailnet address, and a dial through the name then never leaves the machine: on one machine it reached another program on TCP 443 and `setup --announce` failed 3 of 3, although the address worked from the internet ([#281](https://github.com/bitsocialnet/bitsocial-cli/issues/281)). The name is therefore resolved over public DNS and the dial goes to Tailscale's relays, see [Where a name is resolved](reachability.md#where-a-name-is-resolved). If no public resolver can be reached, the machine's own is used and `setup` and `status` say so. Even through the relays the dial starts from the node's own network, so the test from another network is still what proves the address for others.
- **A Funnel path can degrade.** One node's Funnel address became too slow for browsers about two hours after `setup` verified it, while the node itself looked healthy. See [A Funnel path can degrade](#a-funnel-path-can-degrade) for what was measured and how to check for it.
- **`curl` needs `--http1.1`.** Over HTTP/2 the WebSocket upgrade through Funnel returns `404`. The command `setup` prints already passes it. Browsers are not affected.

## Alternatives that were looked at

| Option | Why it is not suggested |
| --- | --- |
| Cloudflare Quick Tunnel | No account needed, but the hostname changes on every start, Cloudflare marks it testing-only, and it caps in-flight requests at 200 |
| Named Cloudflare Tunnel | Needs an account and a domain. Not tested here |
| ngrok free plan | 1 GB of outbound data a month |
| kubo AutoTLS | Its broker has to dial the node directly before it issues a certificate |
| WebRTC between two private peers | kubo does not support it as a listener |
