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

## When a release happens

1. A push to `master` that touches `src/`, `test/`, `config/`, `ci-bin/`, `.github/`, `package.json`, `package-lock.json` or `Dockerfile` runs [CI](../.github/workflows/CI.yml) on Ubuntu, Windows and macOS.
2. When CI succeeds on `master`, **CI build** runs `npm run release -- --ci`. If there are commits since the last tag, release-it:
    - prepends the notes to [`docs/CHANGELOG.md`](CHANGELOG.md) and adds pkc-js entries when the release upgrades pkc-js. That step only warns on failure; it never fails the release.
    - regenerates the README's Commands section. It also builds the oclif manifest, but only for the npm package; the manifest is not committed.
    - commits `chore(release): <version> [skip ci]` as the release bot, tags `v<version>` and creates the GitHub release, using the new changelog section as its body.

    The job then publishes `@bitsocial/bitsocial-cli` to npm with provenance.
3. The published GitHub release triggers **Docker Publish**, which builds and tests the image and pushes `ghcr.io/bitsocialnet/bitsocial-cli` with the tags `<version>`, `<major>.<minor>`, `<major>` and `latest` (for 0.19.124: `0.19.124`, `0.19`, `0`, `latest`). It can be re-run for an existing tag with `workflow_dispatch`, but every run also pushes `latest`, `<major>` and `<major>.<minor>`. Re-running it for anything but the newest release moves those tags back and downgrades operators on `latest`.

Consequences:

- Any merged change in those paths publishes a version, including test-only or CI-only changes.
- Pushes that only touch other files, such as `docs/`, `README.md` or `AGENTS.md`, do not run CI or release. Their commits are included in the next release.
- A cancelled or failed CI run on `master` skips the release (see issue #136). The next successful run releases everything accumulated since the last tag.
- Do not edit `version` in `package.json`, `docs/CHANGELOG.md` or the README's Commands section by hand. The release job regenerates them; change the command definitions in `src/cli/commands/` instead.

## Who receives a release

- `npm install -g @bitsocial/bitsocial-cli` and `bitsocial update install` (which defaults to `latest`) install the newest release, whatever its number.
- The README and `docker-compose.example.yml` use the `latest` image tag. Operators who pin `:0.19` stay on `0.19.x` until they change the tag, so a minor bump is where they opt in. `:0` follows every `0.x` release.

Most operators get every release as soon as it is published. They learn about breaking changes from the release notes, so those notes have to say what to do.

## Breaking changes

Mark a breaking change on the commit that makes it:

- Add `!` after the type or scope, for example `feat(daemon)!: move the RPC endpoint`.
- Add a `BREAKING CHANGE: <what changed and what operators must do>` footer. It appears under "BREAKING CHANGES" in the release notes, so write it as migration guidance.

The next release becomes a minor (`0.20.0`). Surfaces to check when deciding whether a change breaks operators:

- Commands, arguments, flags, aliases and their output, which scripts may parse. The README's Commands section lists them.
- What the daemon serves: the PKC RPC WebSocket and its auth-key URL, web UI paths, and the Kubo API and gateway ports.
- The data, config and log directories, and the Docker paths, volumes, ports and environment variables in the README.
- Supported runtimes: `engines.node` (currently `>=22.19.0`) and the platforms CI covers.
- pkc-js upgrades. pkc-js ships every release as a `0.0.x` patch, including breaking ones, so read every [pkc-js changelog](https://github.com/pkcprotocol/pkc-js/blob/master/docs/CHANGELOG.md) entry in the upgrade range. If a pkc-js change also breaks something for CLI operators, such as an RPC or on-disk data change, mark the upgrade commit and describe the effect on the CLI.

## Leaving `0.x`

There is no plan or date for `1.0.0`; that is a maintainer decision. If it happens:

- With `preMajor`, breaking changes only bump the minor, so `1.0.0` needs an explicit `--increment major` (or an explicit version). CI build runs release-it without `--increment`, so that means a one-off change to how the release job runs.
- At `1.0.0`, remove `preMajor` so breaking changes bump the major and `feat` bumps the minor.
- Docker's `<major>` tag would then move from `0` to `1`, and operators pinned to `:0` would stay behind until they change it.
