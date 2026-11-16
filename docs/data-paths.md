# Data paths and Docker

Where bitsocial-cli keeps its data and logs on a host install, what each entry is, and how the Docker image maps them.

## The data directory

| Platform | Default |
| --- | --- |
| Linux | `~/.local/share/bitsocial` (`$XDG_DATA_HOME/bitsocial` when set) |
| macOS | `~/Library/Application Support/bitsocial` |
| Windows | `%LOCALAPPDATA%\bitsocial\Data` |
| Docker image | `/data/bitsocial` |

`bitsocial daemon --pkcOptions.dataPath <dir>` uses another directory. The `challenge`, `page-sort` and `reachability` commands take the same flag and must be given the same value to act on that daemon's data. `community` commands go through the RPC and take `--pkcRpcUrl` instead.

```
<dataPath>/
├── communities/            # one SQLite database per local community, named by address (pkc-js)
├── auth-key                # RPC auth key
├── challenges/             # installed challenge packages
├── page-sorts/             # installed page sort packages
├── reachability/           # reachability config, Caddy binary and certificates
├── reachability-declined   # marker written by `reachability disable` on a node that never ran setup
├── rpc-server/             # RPC server state, including which communities were started (pkc-js)
├── .bitsocial-cli.ipfs/    # kubo repo, unless IPFS_PATH is set
├── exports/                # default destination of `community export`
├── .daemon_states/         # one state file per running daemon
└── storage.db, lru-storage, .bso-resolver/   # caches of pkc-js and the .bso resolver
```

| Entry | Read more |
| --- | --- |
| `auth-key`, `.daemon_states/`, `rpc-server/` | [daemon.md](daemon.md) |
| `challenges/`, `page-sorts/` | [challenges.md](challenges.md), [page-sorts.md](page-sorts.md) |
| `reachability/`, `reachability-declined` | [reachability.md](reachability.md#where-things-live) |
| `.bitsocial-cli.ipfs/` | [kubo.md](kubo.md) |

A directory named `.challenge-install-tmp-<timestamp>` or `.page-sort-install-tmp-<timestamp>` is left by a package install that was interrupted. It can be deleted when no install is running.

### What does not follow `--pkcOptions.dataPath`

These always use the default data directory of the user running the command:

- `.daemon_states/`, so one `update install` finds every daemon.
- `exports/`, the default destination of `community export`. Pass `--path` to write elsewhere.

Logs have their own directory and flag, see [logs.md](logs.md).

### Migration from plebbit-cli

At start the daemon renames the default `plebbit` data directory to `bitsocial` when only the old one exists, and `<dataPath>/subplebbits` to `<dataPath>/communities`. When both the old and the new exist, it warns and uses the new one.

### Backing up

`communities/` holds the communities, including their signers' private keys; losing it loses them. Stop the daemon before copying the directory, so the SQLite files are consistent. For a single community on a running daemon, use `bitsocial community export`. `auth-key` is worth keeping if clients have the auth-key URL bookmarked. The kubo repo can be rebuilt and does not need a backup.

## Docker

The image is `ghcr.io/bitsocialnet/bitsocial-cli`; tags are described in [versioning.md](versioning.md#when-a-release-happens). The README has the compose and `docker run` quick start. What the image sets up (`Dockerfile`):

| | |
| --- | --- |
| Command | `tini -- bitsocial daemon` |
| User | `bitsocial`, uid and gid 1001 |
| `XDG_DATA_HOME=/data` | Data directory `/data/bitsocial` |
| `XDG_STATE_HOME=/logs` | Log directory `/logs/bitsocial` |
| `KUBO_RPC_URL=http://0.0.0.0:50019/api/v0` | kubo RPC API on every interface of the container |
| `IPFS_GATEWAY_URL=http://0.0.0.0:6473` | kubo gateway on every interface of the container |
| Volumes | `/data`, `/logs` |
| Exposed ports | 9138, 50019, 6473, 4001 |
| Health check | A TCP connect to port 9138 every 30 seconds |

Things to know:

- **Use the auth-key URL.** A connection from the host into the container does not count as local, so the web UIs and the RPC need `/<authKey>`. The daemon prints the URLs; read them with `docker compose logs`. Set `PKC_RPC_AUTH_KEY` for a fixed key.
- **Run CLI commands inside the container:** `docker exec bitsocial bitsocial community list`. Inside, the daemon is local and no auth key is needed.
- **`docker logs` shows stdout only.** For debug output run `docker exec bitsocial bitsocial logs -f` ([logs.md](logs.md)).
- **The two kubo env vars only shape a new volume.** They are written to the kubo config when the repo is first created. On an existing `/data` volume, changing them has no effect on kubo and the daemon warns about the mismatch; edit `/data/bitsocial/.bitsocial-cli.ipfs/config` instead ([kubo.md](kubo.md#which-endpoints-the-daemon-uses)).
- **Publishing 50019 exposes the kubo RPC API**, which gives full control of the IPFS node and has no authentication. Publish it only where you need it, e.g. `127.0.0.1:50019:50019`.
- **Publish 4001 TCP and UDP** so other nodes can reach kubo. Ports for browsers are covered in [reachability.md](reachability.md), and a node behind NAT in [tailscale-funnel.md](tailscale-funnel.md).
- **Volumes must be writable by uid 1001.** Named volumes are; a bind-mounted host directory has to be owned by that uid.
- **Update by pulling a newer image** and recreating the container. Do not use `bitsocial update install` inside a container: the change is lost when the container is recreated.
- **Give the daemon time to stop.** It may take up to 120 seconds to shut down its communities and kubo ([daemon.md](daemon.md#shutdown)); Docker kills a container after 10 seconds unless `stop_grace_period` (compose) or `--stop-timeout` says otherwise.
