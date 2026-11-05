# Contributing to bitsocial-cli

bitsocial-cli is a Bitsocial node: an [oclif](https://oclif.io) CLI and daemon built on [pkc-js](https://github.com/pkcprotocol/pkc-js). It runs communities, a Kubo IPFS node, the PKC RPC WebSocket and the bundled web UIs. Every successful CI run on `master` publishes a release to npm and Docker, and operators receive it through `bitsocial update install` and the `latest` image, so `master` must stay releasable.

Before you start, read:

- The [README](README.md) sections Build from source and Usage, for running the CLI from a checkout and where it keeps data, config and logs.
- [AGENTS.md](AGENTS.md). Its environment, build and test rules apply to human contributors too; the GitHub Issues section and the rest cover coding-agent workflow.
- The [docs index](docs/README.md). Read the topic doc for the area you are changing first; the Docs Lookup table in AGENTS.md maps source paths to docs.
- [docs/versioning.md](docs/versioning.md) for how releases are cut and how to mark a breaking change.

## Setup

```bash
nvm use                               # Node version from .nvmrc
npm ci
npm run build && npm run build:test
npm run test:cli                      # downloads the web UIs first, then runs Vitest
```

Use npm, not yarn or pnpm. `npm ci` also installs the Husky hook that lints commit messages with commitlint.

## Where to help

The [issue tracker](https://github.com/bitsocialnet/bitsocial-cli/issues) is the backlog. For anything larger than a small fix, comment on the issue before starting so work is not duplicated, and open an issue first if none exists.

## Pull requests

- Branch from `master` (fork the repository if you do not have write access) and keep each pull request to one topic.
- Add a test with every feature or bug fix, and make sure `npm run build && npm run build:test` and `npm run test:cli` pass.
- PRs are merged with merge commits, so every commit message on your branch appears in the release notes. Use [Conventional Commits](https://www.conventionalcommits.org/) whose type matches the user-visible effect (`feat`, `fix`, `perf`, ...), and give review-fix commits a meaningful message or squash them into the commit they fix.
- Mark breaking changes with `!` and a `BREAKING CHANGE:` footer that tells operators what to do. That makes the next release a minor, as described in [docs/versioning.md](docs/versioning.md#breaking-changes). Do not start any other body line with "breaking change".
- When a change alters behavior a doc describes (commands, flags, paths, endpoints, output), update that doc in the same PR. When you add a topic doc, add a row to [docs/README.md](docs/README.md) and to the Docs Lookup table in AGENTS.md if it maps to source paths.
- Put `Closes #N` in the PR body, not in commit messages.
- Pin new dependencies to exact versions and commit `package-lock.json`.
- Leave the `version` in `package.json`, `docs/CHANGELOG.md` and the README's Commands section alone. The release job regenerates them; command help comes from the command definitions in `src/cli/commands/`.
- Do not put private infrastructure details, secrets or operator data in issues, PRs or commit messages.

CI runs on PRs that touch `src/`, `test/`, `config/`, `ci-bin/`, `.github/`, the package manifests or the `Dockerfile`. It builds and tests on Ubuntu, Windows and macOS, installs the packed tarball globally, and smoke-tests the Docker image's dependency stage. Review bots comment on PRs; the maintainer decides what is merged.

## License

bitsocial-cli is licensed under [GPL-3.0-or-later](LICENSE). Contributions are accepted under the same license.
