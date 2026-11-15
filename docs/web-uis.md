# Web UIs

The daemon serves the web UIs pinned in `webuis` in `package.json`, each at `/<name>` on the RPC port. They are GitHub release builds, downloaded into `dist/webuis` and never shipped in the npm package.

## Every web UI must ship a release manifest

A web UI build must contain `<app>-release-manifest.json` at its root, with a `releaseTag` equal to the tag of its GitHub release:

```json
{ "schema": "bitsocial.release-manifest.v1", "appName": "seedit", "releaseTag": "v0.6.3" }
```

bitsocial-cli uses it to tell which version a directory in `dist/webuis` holds. A web UI built for another bitsocial-cli may use other schemas, so a directory is installed, reused or served only when its `releaseTag` equals the tag of its pin. A build without the manifest cannot be pinned: the download is rejected.

A directory belongs to the pin whose repository name is part of the directory name, e.g. `seedit-html-0.6.3` to `https://github.com/bitsocialnet/seedit/releases/tag/v0.6.3`.

## Where the rule is applied

| Step | Code | What it does |
| --- | --- | --- |
| `npm install`, `npm run ci:download-web-uis` | `bin/postinstall.js` | Reuses a directory that holds the pinned version and downloads the others. Skips entirely when every pin is installed and nothing else is in `dist/webuis`. |
| `bitsocial update install` (fast update) | `src/update/fast-update.ts` | Reuses a directory that holds the version the new release pins and downloads the others before anything is swapped. |
| Daemon start | `src/webui/daemon-server.ts` | Serves a directory only when it holds the pinned version. |

The helper they share is `src/webui/release-manifest.ts`. `bin/postinstall.js` has its own copy, because it runs without `dist/`.

## When a web UI cannot be installed

- **postinstall** drops it, with a `Warning: Dropped <owner>/<repo>@<tag>: <reason>` line, and removes any other version of it from `dist/webuis`. The other web UIs are installed, and the next run tries the dropped one again. It exits 1 only when no web UI could be installed, or when `dist/webuis` is missing after a failed swap.
- **fast update** gives up and `update install` falls back to `npm install -g`, whose postinstall follows the rule above.
- **the daemon** does not serve a directory that is not the pinned version, prints `Not serving the web UI in <dir>: <reason>` to its log, and keeps running. This happens in a checkout whose pins changed without postinstall running, and for directories left by an older bitsocial-cli.

A SHA-256 mismatch on a downloaded zip is different: postinstall exits 1 at once.

## Changing a pin

`npm run update-webuis` rewrites the pins to the latest releases. Check that the new release has the release manifest before committing the pin; postinstall rejects it otherwise.
