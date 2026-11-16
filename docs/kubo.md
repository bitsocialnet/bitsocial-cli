# The managed kubo node

The daemon runs its own [kubo](https://github.com/ipfs/kubo) (IPFS) node as a child process and restarts it when it dies. This doc covers where the repo lives, what the daemon writes to its config, how the endpoints are chosen and how garbage collection runs. For the changes `bitsocial reachability` makes, see [reachability.md](reachability.md#what-changes-in-the-kubo-config).

The binary comes from the `kubo` npm dependency, at the version pinned in `package.json`. The daemon logs `Using Kubo version: <version>` at start.

## Where the repo lives

```
$IPFS_PATH                          # when set
<dataPath>/.bitsocial-cli.ipfs/     # otherwise
```

Every code path that spawns kubo or touches its config resolves the directory through `resolveKuboRepoPath` in `src/util.ts`. The config file is `<repo>/config`.

## What the daemon writes to the config

**On the first start only**, when the repo does not exist yet:

1. `ipfs init`
2. `ipfs config profile apply server`
3. these fields:

| Field | Value |
| --- | --- |
| `Addresses.API`, `Addresses.Gateway` | The endpoints chosen below |
| `AutoTLS.Enabled` | `true` |
| `Gateway.PublicGateways` | Entries for the gateway host, `localhost`, `127.0.0.1` and `[::1]` with `UseSubdomains: false`, `InlineDNSLink: false` and paths `/ipfs/`, `/ipns/` |

**On every start**, including existing repos:

| Field | Value | Why |
| --- | --- | --- |
| `Ipns.UsePubsub` | `true` | Replaces the deprecated `--enable-namesys-pubsub` daemon flag |
| `Routing` | A custom router set built from `httpRoutersOptions` | See below |
| `Provide.DHT.SweepEnabled` | `false` | Set by pkc-js together with `Routing` |

Then `ipfs repo migrate` runs, the daemon checks that the API, gateway and swarm ports in the config are free, and spawns `ipfs daemon --migrate`. It waits for kubo to print `Daemon is ready`.

Everything else in an existing config is left alone. To change a setting, edit `<repo>/config` and restart the daemon.

### Why the daemon writes `Routing`

pkc-js rewrites the `Routing` section of the kubo it connects to, from `httpRoutersOptions`. When the router list differs from what the config has, it asks kubo to shut down (`POST /api/v0/shutdown`) and expects kubo to be restarted. On a new repo that is always the case. The daemon would restart kubo, but its API would refuse connections for a few seconds right after the daemon reported it was ready.

So the daemon writes the same section before spawning kubo, and pkc-js finds nothing to change. `buildKuboRoutingConfigForHttpRouters` in `src/ipfs/startIpfs.ts` must mirror pkc-js's `setupKuboHttpRouters`. If a pkc-js upgrade changes that mapping, the only effect is one extra kubo restart per start; `test/cli/daemon-no-kubo-restart-on-fresh-start.test.ts` catches it.

`Routing` therefore belongs to pkc-js. Hand edits to it are overwritten.

## Which endpoints the daemon uses

The first match wins:

| | kubo RPC API | Gateway |
| --- | --- | --- |
| 1 | `--pkcOptions.kuboRpcClientsOptions[0]` | `--pkcOptions.ipfsGatewayUrls[0]` |
| 2 | `KUBO_RPC_URL` | `IPFS_GATEWAY_URL` |
| 3 | `Addresses.API` in the kubo config | `Addresses.Gateway` in the kubo config |
| 4 | `http://127.0.0.1:50019/api/v0` | `http://127.0.0.1:6473` |

For rows 3, the first usable entry of a list is taken, and a wildcard bind (`0.0.0.0`, `::`) is dialed over loopback.

The env vars only shape a **new** repo. The daemon never rewrites `Addresses.*` of an existing one, so an env var that names another port than the config leaves kubo listening on one port and the daemon dialing another. The daemon warns once at start:

```
Warning: KUBO_RPC_URL is http://127.0.0.1:5001/api/v0 but Addresses.API in <repo>/config is /ip4/127.0.0.1/tcp/50019. ...
```

Unset the variable, or edit the config field to match.

## A kubo that is already running

- **On the chosen API port:** if it answers `POST /api/v0/version`, the daemon uses it and does not start its own. If something else holds the port, the start fails with `Cannot start IPFS daemon because the IPFS API port ... is already in use`.
- **Named with `--pkcOptions.kuboRpcClientsOptions[0]`:** the daemon starts no kubo and no reachability runtime, and still runs garbage collection against it. pkc-js rewrites that node's `Routing` config and asks it to shut down when the router list changed, so an external kubo needs its own supervisor to bring it back.

## Supervision

- When kubo exits while the daemon is running, the daemon starts it again.
- A watchdog runs every 5 seconds and retries a start that failed, for example on a port that was briefly taken.
- Starts are single-flight: the exit handler and the watchdog share one attempt, so two kubo processes are never spawned for one repo.
- kubo is spawned in its own process group. On shutdown the daemon sends the group `SIGINT`, then `SIGKILL` after 5 seconds, and on a forced exit `SIGKILL` at once, so kubo does not outlive the daemon.

kubo's stderr is written to the daemon log under the namespace `bitsocial-cli:ipfs:startKuboNode`.

## Garbage collection

While the daemon is up, it calls `repo/gc` on the kubo RPC API every `--ipfsGcIntervalMinutes` (default 60). GC only reclaims unpinned blocks; pinned data and MFS are never collected. A run that outlasts the interval is not doubled, and a failed run is logged and retried at the next interval. Turn it off with `--no-enableIpfsGc`.

The log line is `GC reclaimed <n> cids from the IPFS node <url>` under `bitsocial-cli:ipfs:repoGc`.

**Do not pass kubo's `--enable-gc` daemon flag.** In kubo 0.24.0 to 0.43.0 a daemon started with it never exits on `POST /api/v0/shutdown` ([ipfs/kubo#11424](https://github.com/ipfs/kubo/issues/11424)), which is the request pkc-js sends when it changes the routing config. Driving GC over RPC works on every version.

## Troubleshooting

- **`Cannot start IPFS daemon because the <IPFS API|IPFS Gateway|IPFS Swarm> port <host>:<port> (configured as ...) is already in use`:** another program holds a port from the kubo config. Often it is a kubo left by a daemon that was killed with `SIGKILL`; stop it (`pkill -f "ipfs daemon"` if no other kubo runs on the machine), or change the address in `<repo>/config`.
- **`Failed to call ipfs init`:** the repo directory is not writable, or holds a broken partial repo.
- **kubo keeps restarting:** look for the reason in `bitsocial logs --stderr`, in the `bitsocial-cli:ipfs:startKuboNode` lines before each `exited. Will attempt to restart it`.
- **A config edit has no effect:** kubo reads the config at start. Restart the daemon.
