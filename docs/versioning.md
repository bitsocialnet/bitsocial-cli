# Versioning and releases

How bitsocial-cli versions are chosen and published. Read this before changing the package version, marking a breaking change, preparing or debugging a release, or upgrading pkc-js.

The release config is the source of truth: [`config/.release-it.json`](../config/.release-it.json), [`.github/workflows/CI.yml`](../.github/workflows/CI.yml), [`.github/workflows/CI-build.yml`](../.github/workflows/CI-build.yml) and [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml). If this document disagrees with them, they win and this document needs fixing.

## How the next version is chosen

release-it picks the bump from the conventional commits since the last tag. The config sets `preMajor: true`, which keeps breaking changes off a major bump while the CLI is on `0.x`:

| Commits since the last release | Bump | Example |
| --- | --- | --- |
| At least one breaking change: `!` after the type or scope, or a `BREAKING CHANGE:` note in a body | Minor | `0.19.124` → `0.20.0` |
| Anything else, including `feat` | Patch | `0.19.122` → `0.19.123` (contained `feat(reachability)`) |

`preMajor` dates from f645e65 (2026-01-20). The rebrand commit `refactor!: rebrand plebbit-cli to bitsocial-cli`, which has a `BREAKING CHANGE` note, had made release-it bump to `1.0.0`. f645e65 reverted the version to `0.18.0` and added `preMajor`, so that release went out as `0.19.0`. Every release since has been a patch.

### What counts as a breaking-change marker

- The conventional-commits parser matches `BREAKING CHANGE` or `BREAKING-CHANGE` case-insensitively at the start of a body line, after optional whitespace, `*` or `|`, and accepts a space instead of a colon. A body line such as "Breaking change in X: ..." or "* breaking-change: ..." in any commit in the range makes the next release a minor. pkc-js released an accidental `0.1.0` this way (pkc-js 990a2a0ad). Do not start a body line with "breaking change" unless you mean it.
- PRs are merged with merge commits (for example #223), so every commit on a PR branch enters the release range, not just one squashed commit. A marker in any of them counts, and so does one in the merge commit, whose body is the PR title. A PR titled "Breaking change handling for X" bumps the minor.
- When a release upgrades pkc-js, [`ci-bin/pkc-js-changelog.ts`](../ci-bin/pkc-js-changelog.ts) copies the pkc-js changelog entries into the release notes. It runs after the version is chosen, so pkc-js breaking notes do not bump the CLI. Pasting those notes into an upgrade commit's body would.

Two checks reject a marker that is not paired with `!` in the commit header, both built on [`ci-bin/breaking-change-marker.ts`](../ci-bin/breaking-change-marker.ts):

- The commitlint hook ([`commitlint.config.mjs`](../commitlint.config.mjs)) refuses a commit whose body has such a line.
- The [Commit messages](../.github/workflows/commit-messages.yml) workflow fails a pull request when its title or one of its commits has one. It runs again when the title is edited.

Neither sees a merge commit message edited by hand in the merge dialog, so leave GitHub's default there.

## When a release happens

1. A push to `master` that touches `src/`, `test/`, `config/`, `ci-bin/`, `.github/`, `package.json`, `package-lock.json` or `Dockerfile` runs [CI](../.github/workflows/CI.yml) on Ubuntu, Windows and macOS.
2. When that CI run succeeds, **CI build** runs `npm run release -- --ci`. If there are commits since the last tag, release-it:
    - prepends the notes to [`docs/CHANGELOG.md`](CHANGELOG.md) and adds pkc-js entries when the release upgrades pkc-js. That step only warns on failure; it never fails the release.
    - regenerates the README's Commands section. It also builds the oclif manifest, but only for the npm package; the manifest is not committed.
    - commits `chore(release): <version> [skip ci]` as the release bot, tags `v<version>` and creates the GitHub release, using the new changelog section as its body.

    The job then publishes `@bitsocial/bitsocial-cli` to npm with provenance.
3. The published GitHub release triggers **Docker Publish**, which builds and tests the image and pushes `ghcr.io/bitsocialnet/bitsocial-cli` with the tags `<version>`, `<major>.<minor>`, `<major>` and `latest` (for 0.19.124: `0.19.124`, `0.19`, `0`, `latest`). It can be re-run for an existing tag with `workflow_dispatch`. A run always pushes `<version>`, and pushes each of the other three only when the release is the newest one that tag stands for: `latest` for the newest release overall, `<major>` for the newest with that major, `<major>.<minor>` for the newest with that major and minor ([`ci-bin/docker-moving-tags.ts`](../ci-bin/docker-moving-tags.ts)). Re-running it for an older release therefore rebuilds that version without moving the tags operators follow. A pre-release tag only ever gets its `<version>` tag.

Consequences:

- Any merged change in those paths publishes a version, including test-only or CI-only changes.
- Pushes that only touch other files, such as `docs/`, `README.md` or `AGENTS.md`, do not run CI or release. Their commits are included in the next release.
- Only a CI run for a push to `master` can release. A pull request's CI run never does, whatever its branch is called.
- A cancelled or failed CI run on `master` skips the release (see issue #136). The next successful run releases everything accumulated since the last tag.
- Do not edit `version` in `package.json`, `docs/CHANGELOG.md` or the README's Commands section by hand. The release job regenerates them; change the command definitions in `src/cli/commands/` instead.

## Who receives a release

- `npm install -g @bitsocial/bitsocial-cli` and `bitsocial update install` (which defaults to `latest`) install the newest release, whatever its number.
- The README and `docker-compose.example.yml` use the `latest` image tag. Operators who pin `:0.19` stay on `0.19.x` until they change the tag, so a minor bump is where they opt in. `:0` follows every `0.x` release.

Most operators get every release as soon as it is published. They learn about breaking changes from the release notes, so those notes have to say what to do.

## Breaking changes

Mark a breaking change on the commit that makes it:

- Add `!` after the type or scope, for example `feat(daemon)!: move the RPC endpoint`.
- Add a `BREAKING CHANGE: <what changed and what operators must do>` footer. Operators read it in the release notes, so write it as migration guidance.

The next release becomes a minor (`0.20.0`). Surfaces to check when deciding whether a change breaks operators:

- Commands, arguments, flags, aliases and their output, which scripts may parse. The README's Commands section lists them.
- What the daemon serves: the PKC RPC WebSocket and its auth-key URL, web UI paths, and the Kubo API and gateway ports.
- The data, config and log directories, and the Docker paths, volumes, ports and environment variables in the README.
- Supported runtimes: `engines.node` (currently `>=22.19.0`) and the platforms CI covers. `bin/run` enforces `engines.node` at start through `bin/node-version-guard.js`, before it loads the CLI from `bin/run-cli.js`. The check is reached on Node 18.19 and later 18.x releases, and on 20.10 and later. Older versions (up to 18.18, and 20.0 to 20.9) cannot load the extensionless `bin/run` in a `"type": "module"` package, so they fail with `ERR_UNKNOWN_FILE_EXTENSION` before the check runs. `bin/run` imports nothing but `fs` and the guard before the check, because any other import may be what breaks on an old Node. The guard only understands the `>=x.y.z` form: with any other range it lets every version through, and `test/cli/node-version-guard.test.ts` fails to say so. Raising the minimum makes the CLI refuse to start on the versions it drops.
- pkc-js upgrades. pkc-js ships every release as a `0.0.x` patch, including breaking ones, so read every [pkc-js changelog](https://github.com/pkcprotocol/pkc-js/blob/master/docs/CHANGELOG.md) entry in the upgrade range. If a pkc-js change also breaks something for CLI operators, such as an RPC or on-disk data change, mark the upgrade commit and describe the effect on the CLI.

## Leaving `0.x`

There is no plan or date for `1.0.0`; that is a maintainer decision. If it happens:

- With `preMajor`, breaking changes only bump the minor, so `1.0.0` needs an explicit `--increment major` (or an explicit version). CI build runs release-it without `--increment`, so that means a one-off change to how the release job runs.
- At `1.0.0`, remove `preMajor` so breaking changes bump the major and `feat` bumps the minor.
- Docker's `<major>` tag would then move from `0` to `1`, and operators pinned to `:0` would stay behind until they change it.
