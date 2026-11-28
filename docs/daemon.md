# The daemon

`bitsocial daemon` is the long-running process every other command talks to. It runs a kubo node, the pkc-js RPC server, the web UIs and, when set up, the reachability runtime. This doc covers its lifecycle, the RPC URL and auth key, and the ports it uses. Related docs: [kubo.md](kubo.md), [logs.md](logs.md), [update.md](update.md), [data-paths.md](data-paths.md).

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--pkcRpcUrl` | `ws://localhost:9138` | Port the RPC server and web UIs listen on. Only the port is used to bind, see [RPC server](#rpc-server-auth-key-and-web-uis) |
| `--logPath` | the platform log dir | Directory for the daemon's log files, see [logs.md](logs.md) |
| `--logMaxFileSize` | `20` | Megabytes at which the daemon moves on to a new log file, see [logs.md](logs.md#where-log-files-are) |
| `--logMaxTotalSize` | `200` | Megabytes all log files in `--logPath` may take together; the oldest are deleted beyond it |
| `--chainProviderUrls` | six public Ethereum RPCs (`src/common-utils/resolvers.ts`) | RPC URLs for `.bso` name resolution. Repeat the flag for several |
| `--[no-]enableIpfsGc` | on | Garbage-collect the kubo repo periodically, see [kubo.md](kubo.md#garbage-collection) |
| `--ipfsGcIntervalMinutes` | `60` | How often |
| `--wssCheckIntervalMinutes` | `15` | How often the daemon checks that its announced browser (WSS) addresses still complete a handshake in the time a browser allows. `0` turns it off, and the largest value is `35791` (about 24.8 days). See [reachability.md](reachability.md#the-periodic-wss-check) |
| `--[no-]allowPrivateKeyExport` | on | Whether RPC clients may request community exports that include the signer's private key |
| `--pkcOptions.<name>` | | Any pkc-js option, passed to the RPC server's pkc-js instance |

Defaults for `pkcOptions`: `dataPath` is the platform data dir ([data-paths.md](data-paths.md)) and `httpRoutersOptions` is the router list in `src/common-utils/defaults.ts`. The daemon prints the merged options at start as `PKC options: {...}`.

Three `pkcOptions` are restricted:

- `--pkcOptions.kuboRpcClientsOptions[0]` and `--pkcOptions.ipfsGatewayUrls[0]` take exactly one entry.
- `--pkcOptions.pkcRpcClientsOptions` cannot be combined with a non-default `--pkcRpcUrl`.

Quote flags with brackets in the shell: `'--pkcOptions.kuboRpcClientsOptions[0]' http://...`.

## Startup order

1. Print the banner. Start an update check in the background; it prints `Update available: ...` if npm has a newer version and never delays or fails the start.
2. Create a new log file and route output to it ([logs.md](logs.md)).
3. Exit with `PKC RPC port is already in use at <url>` if something listens on the RPC port.
4. Pick the kubo RPC and gateway endpoints ([kubo.md](kubo.md#which-endpoints-the-daemon-uses)).
5. Migrate an old data directory: the default `plebbit` data dir is renamed to `bitsocial`, and `<dataPath>/subplebbits` to `<dataPath>/communities`. Nothing is moved when both exist.
6. Delete state files of dead daemons and write its own ([State file](#state-file)).
7. Start kubo and wait for it to be ready, unless `--pkcOptions.kuboRpcClientsOptions` names an external one.
8. Load installed challenge and page sort packages ([challenges.md](challenges.md), [page-sorts.md](page-sorts.md)), then start the HTTP server, the pkc-js RPC server and the web UIs. From here the daemon accepts commands.
9. Start the repo GC timer and a watchdog that checks every 5 seconds that kubo and the RPC server are up.
10. Start the reachability runtime ([reachability.md](reachability.md#what-the-daemon-does)). It runs last because its first start can download Caddy, and a failure here only logs a warning.

If a step before 9 fails, the daemon prints `Daemon failed to start: <reason>`, the last 10 log lines and the log file path, stops the kubo it started, deletes its state file and exits non-zero.

What a normal start prints to stdout:

```
PKC options: { ... }
Kubo IPFS API listening on: http://127.0.0.1:50019/api/v0
Kubo IPFS Gateway listening on: http://127.0.0.1:6473/
Loaded challenge packages: @bitsocial/mintpass-challenge@1.3.0
pkc rpc: listening on ws://localhost:9138/ (local connections only)
pkc rpc: listening on ws://localhost:9138/<authKey> (secret auth key for remote connections)
Bitsocial data path: /home/me/.local/share/bitsocial
Communities in data path:  [ 'mycommunity.bso' ]
WebUI (seedit - Similar to old reddit UI): http://localhost:9138/<authKey>/seedit
WebUI (seedit - Similar to old reddit UI): http://192.168.1.6:9138/<authKey>/seedit
```

Communities that were started when the daemon last stopped are started again. pkc-js keeps that list in `<dataPath>/rpc-server/`.

## RPC server, auth key and web UIs

One HTTP server on the port of `--pkcRpcUrl` serves everything: the pkc-js WebSocket RPC, the web UIs, the package reload endpoints and community export downloads (`/exports/<id>`).

- **It binds every interface.** The hostname in `--pkcRpcUrl` is only used to check whether the port is free and in the URLs the daemon prints. To keep the port private, use a firewall.
- **`ws://<host>:9138`** (no key) works for local connections only.
- **`ws://<host>:9138/<authKey>`** works from anywhere. Pass it as `--pkcRpcUrl` to run CLI commands against a remote daemon.

The auth key is stored in `<dataPath>/auth-key`. It is generated on the first start (40 characters) and reused after that. Set `PKC_RPC_AUTH_KEY` to choose it; the daemon writes that value to the file. To rotate a generated key, delete the file and restart the daemon.

Each web UI is served twice:

| Path | Who can open it |
| --- | --- |
| `/<name>` (e.g. `/seedit`) | Local connections only. A remote connection gets 403. Opened through a non-loopback hostname, it redirects to `http://localhost:<port>/<name>`, because pkc-js only accepts a keyless RPC connection from a loopback origin |
| `/<authKey>/<name>` | Remote connections. A local connection is redirected to `/<name>` |

"Local" means the connection's source address equals the address it arrived on. A connection from the Docker host into a container is not local, so use the auth-key URL there. Which web UIs are served is covered in [web-uis.md](web-uis.md).

## Ports

| Port | What | Bound to | Set by |
| --- | --- | --- | --- |
| 9138 TCP | pkc-js RPC, web UIs, reload endpoints | all interfaces | `--pkcRpcUrl` |
| 50019 TCP | kubo RPC API | `127.0.0.1` | kubo config `Addresses.API` |
| 6473 TCP | kubo HTTP gateway | `127.0.0.1` | kubo config `Addresses.Gateway` |
| 4001 TCP and UDP | kubo swarm | all interfaces | kubo config `Addresses.Swarm` |

Reachability adds TCP 80, TCP 443, UDP 443 and a loopback WebSocket port; see [reachability.md](reachability.md).

## Environment variables

| Variable | Effect |
| --- | --- |
| `PKC_RPC_AUTH_KEY` | Fixed RPC auth key |
| `KUBO_RPC_URL`, `IPFS_GATEWAY_URL` | kubo endpoints, see [kubo.md](kubo.md#which-endpoints-the-daemon-uses) |
| `IPFS_PATH` | kubo repo directory, instead of `<dataPath>/.bitsocial-cli.ipfs` |
| `DEBUG` | Log namespaces, see [logs.md](logs.md#choosing-what-is-logged) |
| `XDG_DATA_HOME`, `XDG_STATE_HOME` | On Linux, move the default data and log dirs, see [data-paths.md](data-paths.md) |

Prefer flags where both exist. New daemon settings are added as flags, not environment variables.

## State file

Each daemon writes `<default data dir>/.daemon_states/<pid>-daemon.state` at start and deletes it on shutdown. It records the PID and its OS start time, the arguments after `daemon`, the RPC URL, the working directory, the `IPFS_PATH`, `KUBO_RPC_URL` and `IPFS_GATEWAY_URL` it was started with, and the systemd unit if it runs as one. `bitsocial update install` reads these files to find and restart running daemons ([update.md](update.md)).

The directory is always under the default data dir, whatever `--pkcOptions.dataPath` says, so one `update install` finds every daemon of this user. A file whose PID is dead or belongs to another process is deleted by the next daemon start or update.

## Shutdown

On the first `SIGINT` or `SIGTERM` (Ctrl+C, `systemctl stop`, `docker stop`) the daemon:

1. deletes its state file,
2. sends `SIGINT` to kubo's process group and `SIGKILL` if it has not exited after 5 seconds,
3. stops Caddy and releases router port forwards,
4. shuts down the RPC server, which stops the running communities.

It allows itself up to 120 seconds. A second signal force-quits at once (exit code 130 or 143) and kills kubo with `SIGKILL`. A supervisor that kills the daemon sooner than 120 seconds can cut a slow shutdown short.

## Running a second daemon

Give it its own RPC port, data path, log directory and kubo ports:

```bash
KUBO_RPC_URL=http://127.0.0.1:50029/api/v0 IPFS_GATEWAY_URL=http://127.0.0.1:6483 \
  bitsocial daemon --pkcRpcUrl ws://localhost:9139 --pkcOptions.dataPath /path/to/other-data --logPath /path/to/other-logs
```

The log directory matters: each daemon keeps its directory within `--logMaxTotalSize` by deleting the oldest files in it, and would delete the other daemon's files, including the one it is writing. Read its log with `bitsocial logs --logPath /path/to/other-logs`.

The two env vars shape the new kubo repo's config when it is first created. The swarm port is not covered by them: the first start creates the repo and then fails because 4001 is taken. Change `Addresses.Swarm` in `<dataPath>/.bitsocial-cli.ipfs/config` and start again. Other commands reach the second daemon with `--pkcRpcUrl ws://localhost:9139`.

## Troubleshooting

- **`PKC RPC port is already in use`:** another daemon is running on that port. Use it, or pick another port.
- **`Cannot start IPFS daemon because the IPFS API port ... is already in use`:** something that is not a healthy kubo holds a port from the kubo config. See [kubo.md](kubo.md#troubleshooting).
- **`Warning: KUBO_RPC_URL is ... but Addresses.API in ... is ...`:** the env var names an endpoint the existing kubo repo does not listen on. See [kubo.md](kubo.md#which-endpoints-the-daemon-uses).
- **`Could not connect to the daemon at <url>. Is it running?`** from another command: no daemon answers there within 20 seconds. Check the port, and for a remote daemon include the auth key path.
- **The terminal shows little:** only stdout is printed. Debug output and errors from libraries go to the log file; run `bitsocial logs`.
