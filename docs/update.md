# Updating bitsocial-cli

`bitsocial update` installs another version of the CLI from npm and restarts the running daemons onto it. For how versions are chosen and published, see [versioning.md](versioning.md). A Docker node is updated by pulling a newer image instead, see [data-paths.md](data-paths.md#docker).

## Commands

```bash
bitsocial update check                    # compare the installed version with the latest on npm
bitsocial update versions                 # list published versions, newest first; * marks the installed one; --limit <n>
bitsocial update install                  # install the latest version
bitsocial update install 0.19.40          # install a specific version (also downgrades)
bitsocial update install --force          # reinstall even if already on that version
bitsocial update install --no-restart-daemons
```

The daemon also checks at start and prints `Update available: v<latest> (current: v<current>). Run 'bitsocial update install' to upgrade.`

All of it needs `npm`. The CLI uses the npm that ships with the Node running it, and falls back to `npm` on `PATH`.

## What `install` does

1. Find the running daemons from their state files ([daemon.md](daemon.md#state-file)).
2. With `--no-restart-daemons`, refuse if any daemon is running: `<n> daemon(s) running. Stop them first, then retry.`
3. Resolve the target version. If the registry cannot be reached, or the CLI is already on that version and `--force` is not set, stop here with every daemon still running.
4. Stop the daemons that no supervisor manages ([below](#how-daemons-are-restarted)).
5. Install: try the fast update, then fall back to `npm install -g @bitsocial/bitsocial-cli@<version>`.
6. Start the stopped daemons again and restart the supervised ones.

If the install fails, the daemons stopped in step 4 are started again on the version that is still installed, and the command exits 1.

## Fast update

The fast path (`src/update/fast-update.ts`) avoids a full `npm install -g`:

1. `npm pack` the new version into a staging directory next to the install and extract it.
2. Compare `dependencies` in the old and new `package.json`. If they differ, fall back.
3. Download the web UIs the new version pins that the current install does not already hold ([web-uis.md](web-uis.md)).
4. Move `node_modules` and `dist/webuis` from the current install into staging.
5. Swap the staging directory into place.

It falls back to the full install when dependencies changed, a web UI download fails, the staging directory is on another filesystem, or any step throws. A failed attempt puts `node_modules` and `dist/webuis` back first. `--force` skips the fast path.

Set `GITHUB_TOKEN` if web UI downloads hit GitHub's API rate limit.

## How daemons are restarted

| Daemon | What `install` does |
| --- | --- |
| Started by hand (terminal, `nohup`, tmux, a user-level service) | Before installing: `SIGINT`, then wait up to 120 seconds for the process to exit. After installing: spawn `bitsocial daemon <same arguments>` detached, in the daemon's recorded working directory and with its recorded `IPFS_PATH`, `KUBO_RPC_URL` and `IPFS_GATEWAY_URL`, then wait up to 30 seconds for its RPC port |
| A systemd system service | Left running during the install, then `systemctl restart <unit>` |

- **Why wait for the process, not the port:** a stopping daemon frees its RPC port before its kubo has exited. Starting the new daemon in that window fails on the kubo API port.
- **Why systemd daemons are not respawned by the updater:** a detached replacement would not belong to the unit and would fight it for the RPC port.
- **How a systemd daemon is recognized:** `INVOCATION_ID` is set, and the daemon is the unit's main process or its direct child (an `ExecStart=/bin/sh -c ...` wrapper). A daemon that merely runs somewhere inside another service, such as a CI runner, is not treated as supervised. `systemctl --user` units are not recognized and are handled like daemons started by hand.
- **Permissions:** `systemctl restart` needs the rights to restart the unit. Without them the install succeeds and the command ends with `Updated the binary but failed to restart systemd unit <unit>`; restart it yourself with `sudo systemctl restart <unit>`.
- **A respawned daemon is detached** from the terminal that ran the update, and its output goes only to its log file. Read it with `bitsocial logs --stdout`.

## Gotchas

- **The install that is updated is the one running the command.** `npm install -g` uses the global prefix of the Node that runs `bitsocial update install`, and the fast path swaps that same install directory. If the daemon runs from another Node install (for example a systemd unit with its own `PATH`, while your shell uses an nvm version), the daemon restarts on its old version and the CLI in your shell is now newer than the daemon. Run the update with the same Node the daemon uses, and compare `bitsocial --version` in both environments when commands stop reaching the daemon after an update.
- **The respawn runs `bitsocial` from `PATH`** of the shell that ran the update. If that is not found, `install` warns `Failed to spawn daemon for args: ...` and the daemon stays down.
- **`Daemon may not have started — port <n> not responding after 30s`:** the respawned daemon did not open its RPC port in time. Check `bitsocial logs`.
- **`Daemon (PID <n>) did not shut down within 120 seconds`:** the update is aborted before installing. Daemons already stopped are started again.
- **`update check` says the installed version is newer than the latest release:** this is a build from source or a version that was unpublished.

## Source

| File | Role |
| --- | --- |
| `src/cli/commands/update/` | The three commands, and the side effects of stopping and starting daemons |
| `src/update/restart-orchestration.ts` | Which daemons are stopped, respawned or restarted through a supervisor |
| `src/update/fast-update.ts` | The fast path |
| `src/update/npm-registry.ts`, `src/common-utils/npm.ts` | `npm view`, `npm install -g`, finding npm |
| `src/common-utils/daemon-state.ts` | State files, PID identity, systemd detection |
