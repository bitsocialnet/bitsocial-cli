# Logs

The daemon writes everything it prints, plus all debug output, to a log file. `bitsocial logs` reads it. Other commands do not write log files.

## Where log files are

| Platform | Default directory |
| --- | --- |
| Linux | `~/.local/state/bitsocial` (`$XDG_STATE_HOME/bitsocial` when set) |
| macOS | `~/Library/Logs/bitsocial` |
| Windows | `%LOCALAPPDATA%\bitsocial\Log` |
| Docker image | `/logs/bitsocial` |

`bitsocial daemon --logPath <dir>` uses another directory. The log directory does not follow `--pkcOptions.dataPath`.

- **One file per daemon start:** `bitsocial_cli_daemon_<start time>.log`, e.g. `bitsocial_cli_daemon_2026-11-13T13-25-40.108Z.log`.
- **At most 5 files:** when 5 exist at start, the oldest is deleted.
- **At most about 20 MB each:** once a daemon has written 20 MB, it rewrites the file in place to its last 15 MB, starting on a line boundary. A long-running daemon therefore keeps its recent history and loses the oldest.

## What goes where

| Output | Terminal | Log file |
| --- | --- | --- |
| stdout (startup lines, warnings for the operator) | yes | yes, tagged `[stdout]` |
| stderr and debug output from bitsocial-cli, pkc-js and kubo | no | yes, tagged `[stderr]` |
| Uncaught exceptions and unhandled rejections | yes | yes |

So `docker logs`, `journalctl` and the terminal show stdout only. Anything the operator must see is printed to stdout for that reason. If the log file cannot take a write, debug output falls back to the terminal instead of being lost.

Each entry starts with a UTC timestamp and the stream:

```
[2026-11-13T13:25:40.738Z] [stdout] Bitsocial data path: /home/me/.local/share/bitsocial
[2026-11-13T13:25:41.002Z] [stderr] bitsocial-cli:daemon Started kubo ipfs process with pid (1234) +0ms
```

Lines without that prefix continue the entry above them (multi-line objects, stack traces).

## `bitsocial logs`

```bash
bitsocial logs                       # print the newest log file and exit
bitsocial logs -f                    # then keep following it
bitsocial logs -n 50                 # last 50 entries
bitsocial logs --since 1h            # 30s, 42m, 2h, 1d, or an ISO 8601 timestamp
bitsocial logs --since 2026-01-02T13:23:37Z --until 2026-01-02T14:00:00Z
bitsocial logs --stdout              # only what the terminal showed
bitsocial logs --stderr              # only debug output
bitsocial logs --logPath <dir>       # when the daemon was started with --logPath
```

- It reads **only the newest file**. To read an earlier run, open its file directly.
- `-n` counts entries, not lines: a multi-line entry counts once.
- `--since` and `--until` are applied first, then `--stdout` or `--stderr`, then `-n`.
- `-f` keeps up when the daemon trims the file, and switches to a newer file when the daemon restarts (it looks about every 3 seconds, and says `--- switched to new log file: ... ---` on stderr).
- It needs no running daemon and does not connect to one.

In Docker: `docker exec bitsocial bitsocial logs -f`.

## Choosing what is logged

The daemon enables the debug namespaces `bitsocial*,pkc*,-pkc*trace` by default. `DEBUG` selects others and `DEBUG_DEPTH` sets how deep objects are printed (default 10):

```bash
DEBUG='bitsocial*,pkc*' bitsocial daemon     # includes pkc-js trace output
```

**Known gap:** `bin/run` moves `DEBUG` to `_PLEBBIT_DEBUG` before the CLI loads, a name nothing reads since the rename, so `DEBUG` currently has no effect and the default namespaces are used. Until that is fixed, set `_PKC_DEBUG` instead: `_PKC_DEBUG='bitsocial*,pkc*' bitsocial daemon`.

Useful namespaces:

| Namespace | What |
| --- | --- |
| `bitsocial-cli:daemon` | Startup, shutdown, kubo restarts |
| `bitsocial-cli:daemon:startDaemonServer` | RPC server, web UI requests, package reloads |
| `bitsocial-cli:ipfs:startKuboNode` | kubo's own output and start failures |
| `bitsocial-cli:ipfs:repoGc` | Garbage collection runs |
| `bitsocial-cli:reachability` | Reachability runtime |
| `pkc-js:*` | pkc-js |

Commands other than `daemon` print debug output to their own stderr, and only when a namespace is set (same variables).

## Troubleshooting

- **`Log directory does not exist` / `No log files found`:** no daemon has run with that log directory. Pass the `--logPath` the daemon was started with.
- **`bitsocial logs` shows an old run:** a newer daemon writes to another directory (`--logPath`, another user, or a container volume).
- **The start of a long run is missing:** the file was trimmed at 20 MB.
- **`-f` prints `--- log file was truncated, following it from its start ---`:** the file was emptied or replaced by something other than the daemon's own trim.
