# Logs

The daemon writes everything it logs, plus everything it prints, to log files as JSON lines. `bitsocial logs` reads them. Other commands do not write log files.

## Where log files are

| Platform | Default directory |
| --- | --- |
| Linux | `~/.local/state/bitsocial` (`$XDG_STATE_HOME/bitsocial` when set) |
| macOS | `~/Library/Logs/bitsocial` |
| Windows | `%LOCALAPPDATA%\bitsocial\Log` |
| Docker image | `/logs/bitsocial` |

`bitsocial daemon --logPath <dir>` uses another directory. The log directory does not follow `--pkcOptions.dataPath`.

- **One run, one or more files:** a daemon start writes `bitsocial_cli_daemon_<start time>.jsonl`, e.g. `bitsocial_cli_daemon_2026-11-13T13-25-40.108Z.jsonl`. When that file would grow past `--logMaxFileSize` (20 MB by default), the daemon moves on to `<same name>.1.jsonl`, then `.2.jsonl`, and so on. A file is only ever appended to.
- **At most 200 MB in all:** once the files in the directory together exceed `--logMaxTotalSize` (200 MB by default), the daemon deletes the oldest ones, whole files only, never the one it is writing. Disk use therefore stays under that limit plus one file.
- **At most 5 runs:** at start, the daemon deletes every file of the oldest runs so that 5 runs, its own included, keep their files.

Files from versions before JSONL (`bitsocial_cli_daemon_<start time>.log`, timestamped text) count towards both limits and are deleted like the others. `bitsocial logs` still reads them.

## What is in a file

One JSON object per line, the same entries the pkc-js `getLogs` RPC method returns:

```json
{"seq":812,"time":1763040340738,"level":"log","namespace":"pkc-js:local-community","msg":"storeComment: stored comment QmdLPDmb…","tags":{"publicKey":"12D3KooW…","cid":"QmdLPDmb…"}}
```

| Field | Meaning |
| --- | --- |
| `seq` | Sequence number of the daemon's logger root; increases by one per entry it logs. Left out on the rare entry logged through another root |
| `time` | Unix time in milliseconds |
| `level` | `log`, `error` or `trace` |
| `namespace` | Who logged it, see [the namespaces](#choosing-what-is-logged) |
| `msg` | The message, with no color escapes. An error's whole stack is in it, on several lines |
| `tags` | Identifiers of what the line is about: `publicKey` (a community), `signature` (a publication or challenge exchange), `cid`, `parentCid`. `{}` when there are none |

The daemon, pkc-js and the pkc-js RPC server all log through one logger root, which the daemon creates and passes to pkc-js. What reaches stdout or stderr another way is logged too:

| Output | Terminal | Log file |
| --- | --- | --- |
| stdout (startup lines, warnings for the operator) | yes | yes, namespace `bitsocial-cli:stdout`, level `log` |
| Debug output of bitsocial-cli and pkc-js | no | yes, under its own namespace |
| Anything else written to stderr | no | yes, namespace `bitsocial-cli:stderr`, level `error` |
| Uncaught exceptions and unhandled rejections | yes | yes, as `bitsocial-cli:stderr` |

So `docker logs`, `journalctl` and the terminal show stdout only. Anything the operator must see is printed to stdout for that reason. If the log file cannot take an entry, it is printed to the terminal instead of being lost.

## `bitsocial logs`

```bash
bitsocial logs                       # print the newest run's log and exit
bitsocial logs -f                    # then keep following it
bitsocial logs -n 50                 # last 50 entries
bitsocial logs --since 1h            # 30s, 42m, 2h, 1d, or an ISO 8601 timestamp
bitsocial logs --since 2026-01-02T13:23:37Z --until 2026-01-02T14:00:00Z
bitsocial logs --level error         # only errors; repeat the flag for several levels
bitsocial logs --stdout              # only what the terminal showed
bitsocial logs --stderr              # only what it did not
bitsocial logs --json                # one JSON object per entry, for jq
bitsocial logs --color | less -R     # colored namespaces and errors
bitsocial logs --logPath <dir>       # when the daemon was started with --logPath
```

Each entry prints as `[time] [level] namespace [key=value, ...] msg`, with the tag block left out when there are no tags. Continuation lines of a multi-line message follow without a prefix:

```
[2026-11-13T13:25:40.738Z] [log] bitsocial-cli:stdout Bitsocial data path: /home/me/.local/share/bitsocial
[2026-11-13T13:25:41.002Z] [log] bitsocial-cli:daemon Started kubo ipfs process with pid (1234)
[2026-11-13T13:48:03.136Z] [log] pkc-js:local-community:challenge-exchange [publicKey=12D3KooW…, signature=2kdyNcqC…] _publishChallenges: Community 12D3KooW… with pubsub topic …
[2026-11-13T13:48:03.303Z] [error] pkc-js:comment [signature=h3L3L5aE…] _handleIncomingChallengeVerificationPubsubMessage: Challenge exchange with publication comment has failed to pass
```

- It reads **every file of the newest run**, in order. To read an earlier run, open its files directly.
- Output has **no color escapes unless `--color` is given**, also on a terminal, so it can go straight into `grep`. Escapes stored in old text files are stripped too.
- `-n` counts entries, not lines: a multi-line entry counts once.
- `--since` and `--until` are applied first, then `--stdout`/`--stderr` and `--level`, then `-n`.
- `-f` moves on to the next file when the daemon rotates, and to the new run's file when the daemon restarts (saying `--- switched to new log file: ... ---` on stderr only for the latter). It polls about every 300 ms.
- `--json` prints old text entries as objects with `tags: {}`. It cannot be combined with `--color`.
- It needs no running daemon and does not connect to one. It reads the files on this machine only.

In Docker: `docker exec bitsocial bitsocial logs -f`.

### Finding lines with grep and jq

| Goal | Command | Notes |
| --- | --- | --- |
| One community | `bitsocial logs \| grep -F "publicKey=$KEY"` | `grep -F "$KEY"` also returns lines that only mention the key in the message |
| One challenge exchange | `bitsocial logs \| grep -F "signature=$SIG"` | Use `-F`: signatures are base64 with `+` and `/`. The community-side `handleChallengeRequest:` and `storeComment:` lines carry only `publicKey` |
| One comment | `bitsocial logs \| grep -F "cid=$CID"` | Does not match `parentCid=`; `grep -F "parentCid=$CID"` gives its replies' lines. Before the cid is assigned, the lines are only under `signature=` |
| One function | `bitsocial logs \| grep -E '^\[[^]]+\] \[[a-z]+\] [^ ]+ (\[[^]]*\] )?storeComment: '` | `grep -F 'storeComment: '` is shorter but also matches the name inside messages. pkc-js prefixes every `pkc-js:*` message with its function name |
| Errors only | `bitsocial logs --level error` | |
| A community's errors, with stacks | `bitsocial logs --json --level error \| jq -r 'select(.tags.publicKey == "'"$KEY"'") \| .msg'` | grep returns only an error's first line; the stack is in `msg` |
| Follow with a filter | `bitsocial logs -f -n 0 \| grep --line-buffered -F "publicKey=$KEY"` | |
| Entries of one namespace | `bitsocial logs --json \| jq -c 'select(.namespace \| startswith("pkc-js:local-community"))'` | |

## Choosing what is logged

The daemon enables the debug namespaces `bitsocial*,pkc*,-pkc*trace` by default: log and error level of bitsocial-cli and pkc-js, no pkc-js trace. `DEBUG` selects others:

```bash
DEBUG='bitsocial*,pkc*' bitsocial daemon     # includes pkc-js trace output: every RPC call, update-loop detail
```

`bitsocial-cli:stdout` and `bitsocial-cli:stderr` are always added, so what the daemon prints is in the file whatever `DEBUG` says, unless `DEBUG` excludes them explicitly (`-bitsocial*`). An idle community logs nothing at the default level.

pkc-logger formats each message itself: objects to depth 4, at most 50 keys or array items, strings cut at 2,000 characters, and 16 KiB per message. That applies to captured stdout and stderr text too, so a very long printed line ends in `…`. `DEBUG_DEPTH` has no effect.

`bin/run-cli.js`, which `bin/run` loads once it has checked the Node version, removes `DEBUG` from the environment before the CLI loads and passes it on as `_PKC_DEBUG`, so the `debug` module never prints to the terminal on its own. Setting `_PKC_DEBUG` directly has the same effect and wins over `DEBUG`. `DEBUG=0` or an empty value means unset.

Useful namespaces:

| Namespace | What |
| --- | --- |
| `bitsocial-cli:daemon` | Startup, shutdown, kubo restarts |
| `bitsocial-cli:daemon:startDaemonServer` | RPC server, web UI requests, package reloads |
| `bitsocial-cli:ipfs:startKuboNode` | kubo's own output and start failures |
| `bitsocial-cli:ipfs:repoGc` | Garbage collection runs |
| `bitsocial-cli:reachability` | Reachability runtime |
| `bitsocial-cli:stdout`, `bitsocial-cli:stderr` | What reached stdout or stderr outside a logger |
| `pkc-js:*` | pkc-js |
| `pkc-js-rpc:pkc-ws-server` | The pkc-js RPC server |

Commands other than `daemon` print debug output to their own stderr, and only when a namespace is set (same variables). They pass their logger root to pkc-js as well, so `DEBUG=pkc* bitsocial community list` shows pkc-js's lines.

## The `getLogs` RPC method

pkc-js answers `getLogs` (`pkc.getLogs({ tags, regex, since, until, limit, cursor, order, rpcUrl })`) from the daemon's logger root, so it returns the daemon's, pkc-js's and the RPC server's entries, including the stdout and stderr ones. It reads an in-memory buffer of about 4 MiB that starts empty at every daemon start; the files hold more. Anyone with the RPC auth key can call it. Serving it from the files is tracked in issue #257.

## Troubleshooting

- **`Log directory does not exist` / `No log files found`:** no daemon has run with that log directory. Pass the `--logPath` the daemon was started with.
- **`bitsocial logs` shows an old run:** a newer daemon writes to another directory (`--logPath`, another user, or a container volume).
- **The start of a long run is missing:** its oldest files were deleted to stay within `--logMaxTotalSize`.
- **`-f` prints `--- log file was truncated, following it from its start ---`:** something other than the daemon emptied or replaced the file (or an old version's daemon trimmed its text log in place).
