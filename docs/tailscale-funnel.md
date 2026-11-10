# Tailscale Funnel: a browser address for a node behind NAT

`bitsocial reachability setup` gives a node a WSS address only when the internet can reach it on TCP 443. A node behind NAT or carrier-grade NAT, with no UPnP and no port forwarding, cannot get one. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) is one tested way around that: it gives the machine a public `<machine>.<tailnet>.ts.net` name with a Let's Encrypt certificate and forwards connections to it, with nothing opened on the router. It is on every Tailscale plan, including the free one.

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
| Another program holds TCP 443 on a reachable node | No, the reverse proxy guidance applies |

`status` shows the same pointer in the `browser-address` check, in its `fix` field in `--json`, on a node where `setup` has run, no WSS address is announced, no WSS address that `setup` does not manage works, and no name is waiting for its DNS to be fixed. It leaves the pointer out when another program holds TCP 443 and the machine has a public address on one of its interfaces, because the reverse proxy guidance applies there. `status` does not ask the router as `setup` does, so on a node whose only public address is the router's, with another program on TCP 443, `status` shows the pointer while `setup` prints the reverse proxy guidance.

## Steps

1. **Run `bitsocial reachability setup`** while the daemon runs. It prints the port to forward, e.g. `tailscale funnel --bg 4002`. The port is kubo's loopback WebSocket port, stored as `wsPort` in `<dataPath>/reachability/config.json`.
2. **Install Tailscale** from <https://tailscale.com/download> and sign in. On Linux that is `sudo tailscale up`. On Windows and macOS, sign in through the app. Funnel needs MagicDNS enabled for the tailnet. It is on by default for new tailnets. Check it on the [DNS page](https://login.tailscale.com/admin/dns).
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

   This adds kubo's loopback listener, restarts kubo, and completes a real libp2p handshake through the address before announcing it. It tries the handshake three times, 15 seconds apart. If all three fail, it puts kubo back as it was and exits `1`, and you can run it again later. Nothing is listening on `<wsPort>` before this step, so until then the Funnel name answers `502`.
7. **Test from another network.** `setup` prints a `curl` command. Run it from a phone hotspot or another machine and expect `101`. `curl` then appears to hang because the WebSocket stays open. The handshake in step 6 comes from the node's own machine, so it does not prove other networks can connect.

`bitsocial reachability status` then shows `Mode: reverse-proxy`, the address under `Announced addresses`, and `Browsers: should be able to connect over WSS`.

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

1. **Create an auth key** on the [keys page](https://login.tailscale.com/admin/settings/keys). Leave it untagged, so the default Funnel policy covers the machine. Check that MagicDNS and HTTPS certificates are enabled on the [DNS page](https://login.tailscale.com/admin/dns). Funnel needs both. If Funnel was never approved for the tailnet, run `tailscale funnel` once on any machine and open the link it prints.
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

This was tested with an image built from source, Docker Compose 5.5.1 and `tailscale/tailscale:latest` on 2026-11-10. The inline `configs` `content` needs Docker Compose 2.23.1 or newer. With an older one, put the JSON in a file and mount it.

## What you are trusting Tailscale with

**What Tailscale can see about you:** the account you signed in with, the machine's name, OS and Tailscale version, its real public IP, and how much Funnel traffic it gets and when. Tailscale's client also uploads logs by default. Turning that off depends on the platform: on Linux, pass `--no-logs-no-support` to `tailscaled` or set `TS_NO_LOGS_NO_SUPPORT=true`. On Windows, only the environment variable works. On macOS, the flag works only with the open source command-line `tailscaled`, not the apps. See [Tailscale's logging page](https://tailscale.com/kb/1011/log-mesh-traffic).

**What Tailscale can see about peers who connect:** their IP address and port, when they connected, for how long, and how many bytes. It cannot see content. TLS ends on your machine, and the libp2p Noise encryption runs inside it.

**Can Tailscale read the traffic?** Not without being detectable. Tailscale controls the `ts.net` DNS zone, so it could have a second certificate issued and intercept TLS. That certificate would appear in Certificate Transparency logs. Even then, browsers dial `/p2p/<peer id>`, and Noise checks kubo's key, so an interceptor would see only the WebSocket upgrade headers (User-Agent, Origin) and Noise ciphertext. It could not read pubsub content or pretend to be the node.

**What becomes public:** the `<machine>.<tailnet>.ts.net` name, in the announced address and in Certificate Transparency logs.

**Your home IP:** peers connecting through Funnel see a Tailscale relay IP, not yours. This is only partial privacy, because kubo still announces its other addresses, and those can include your public IP.

## Limits and trade-offs

- **Every browser connection passes through one company's relays.** If Tailscale has an outage, changes Funnel's terms or limits your traffic, the address stops working. WebTransport and other nodes are not affected.
- **Funnel's bandwidth limits are not published.** Tailscale says Funnel traffic is subject to limits without stating them.
- **Some requests through Funnel fail.** In testing, 57 of 60 WebSocket upgrades opened at once from another network succeeded, and one `setup --announce` failed to connect for a reason that was not found. A browser retries, and `setup` tries its handshake three times.
- **kubo sees every Funnel peer as `127.0.0.1`.** `tailscaled` proxies locally. kubo's per-IP connection limits exempt loopback, so they do not cap Funnel connections, and they also cannot tell one Funnel peer from another. One abusive client can open many connections, held back only by kubo's global resource manager limits and connection manager. An IP ban cannot single it out. kubo's gossipsub runs without peer scoring, so sharing an IP costs Funnel peers nothing there.
- **A handshake from the node itself is weak proof.** `setup` and `status` dial the address from the node's own machine. With Tailscale's MagicDNS on, a machine may resolve its own `ts.net` name to its tailnet address, and the dial would then never leave the machine. This was not tested: the test machine had MagicDNS off, and its dial went out through Tailscale's relays. Only the test from another network proves the address.
- **`curl` needs `--http1.1`.** Over HTTP/2 the WebSocket upgrade through Funnel returns `404`. The command `setup` prints already passes it. Browsers are not affected.

## Alternatives that were looked at

| Option | Why it is not suggested |
| --- | --- |
| Cloudflare Quick Tunnel | No account needed, but the hostname changes on every start, Cloudflare marks it testing-only, and it caps in-flight requests at 200 |
| Named Cloudflare Tunnel | Needs an account and a domain. Not tested here |
| ngrok free plan | 1 GB of outbound data a month |
| kubo AutoTLS | Its broker has to dial the node directly before it issues a certificate |
| WebRTC between two private peers | kubo does not support it as a listener |
