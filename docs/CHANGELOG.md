# Changelog

## <small>0.19.16 (2026-02-15)</small>

* build(deps): upgrade plebbit-js ([8943c2c](https://github.com/bitsocialhq/bitsocial-cli/commit/8943c2c))

## <small>0.19.15 (2026-02-11)</small>

* build(deps): upgrade plebbit-js ([aee99d8](https://github.com/bitsocialhq/bitsocial-cli/commit/aee99d8))

## <small>0.19.14 (2026-02-11)</small>

* fix(daemon): ensure Kubo is killed on daemon shutdown and double Ctrl+C ([a91aa00](https://github.com/bitsocialhq/bitsocial-cli/commit/a91aa00))
* fix(daemon): print shutdown message to stdout on Ctrl+C ([c61dce2](https://github.com/bitsocialhq/bitsocial-cli/commit/c61dce2))
* fix(webui): strip 5chan hash redirect script to fix "Cannot GET /" error ([a1b6d6f](https://github.com/bitsocialhq/bitsocial-cli/commit/a1b6d6f))
* docs: replace BitSocial with Bitsocial for consistent naming ([fcec21a](https://github.com/bitsocialhq/bitsocial-cli/commit/fcec21a))

## <small>0.19.13 (2026-02-11)</small>

* docs(docs): update README.md + docs in delete command ([0fd56f8](https://github.com/bitsocialhq/bitsocial-cli/commit/0fd56f8))
* docs(README): mention `bitsocial logs` in Running Daemon section ([2f42f48](https://github.com/bitsocialhq/bitsocial-cli/commit/2f42f48))
* build(deps): upgrade plebbit-js ([11894ef](https://github.com/bitsocialhq/bitsocial-cli/commit/11894ef))
* fix(ci): fail build if no web UIs are downloaded ([004181e](https://github.com/bitsocialhq/bitsocial-cli/commit/004181e))
* fix(docker): use BuildKit secret mounts instead of ARG for GITHUB_TOKEN ([49b79ec](https://github.com/bitsocialhq/bitsocial-cli/commit/49b79ec))
* fix(logs): preserve ANSI colors in log output ([c6b0484](https://github.com/bitsocialhq/bitsocial-cli/commit/c6b0484))

## <small>0.19.12 (2026-02-10)</small>

* docs: add Docker container data paths table to README ([bd3740d](https://github.com/bitsocialhq/bitsocial-cli/commit/bd3740d))
* docs: update Docker exec example to use bitsocial command ([34f87c3](https://github.com/bitsocialhq/bitsocial-cli/commit/34f87c3))
* docs(docs): update README.md and add example for starting all communities ([76b23a4](https://github.com/bitsocialhq/bitsocial-cli/commit/76b23a4))
* build(deps): upgrade plebbit-js ([18df610](https://github.com/bitsocialhq/bitsocial-cli/commit/18df610))
* build(deps): upgrade plebbit-js ([d489947](https://github.com/bitsocialhq/bitsocial-cli/commit/d489947))
* feat: add --tail, --since, --until flags to `bitsocial logs` (docker logs-like) ([e8e5bd1](https://github.com/bitsocialhq/bitsocial-cli/commit/e8e5bd1))
* feat: add 5chan UI and gracefully skip unavailable web UIs ([5447ee1](https://github.com/bitsocialhq/bitsocial-cli/commit/5447ee1))
* feat: make `bitsocial` command available globally in Docker container ([69a2893](https://github.com/bitsocialhq/bitsocial-cli/commit/69a2893))
* feat(docker): add stop_grace_period to allow graceful shutdown ([103f74a](https://github.com/bitsocialhq/bitsocial-cli/commit/103f74a))
* feat(docker): expose IPFS gateway and Kubo API ports ([4220a44](https://github.com/bitsocialhq/bitsocial-cli/commit/4220a44))
* ci: trigger CI pipeline on Dockerfile changes ([c8f325e](https://github.com/bitsocialhq/bitsocial-cli/commit/c8f325e))

## <small>0.19.11 (2026-02-09)</small>

* fix: run WebSocket verification inside Docker container ([4b23cec](https://github.com/bitsocialhq/bitsocial-cli/commit/4b23cec))

## <small>0.19.10 (2026-02-09)</small>

* feat: add container verification to Docker publish workflow ([6b38236](https://github.com/bitsocialhq/bitsocial-cli/commit/6b38236))
* feat: add descriptions for web UI clients in daemon output ([2620d32](https://github.com/bitsocialhq/bitsocial-cli/commit/2620d32))
* feat: always print web UI URLs with auth key ([bf34d30](https://github.com/bitsocialhq/bitsocial-cli/commit/bf34d30))
* fix: add ca-certificates to Docker image for git SSL verification ([85415cf](https://github.com/bitsocialhq/bitsocial-cli/commit/85415cf))

## <small>0.19.9 (2026-02-09)</small>

* feat: add Docker support ([a437478](https://github.com/bitsocialhq/bitsocial-cli/commit/a437478))

## <small>0.19.8 (2026-02-09)</small>

* feat: add community delete command ([059d071](https://github.com/bitsocialhq/bitsocial-cli/commit/059d071))
* build(deps): upgrade plebbit-js ([b767be2](https://github.com/bitsocialhq/bitsocial-cli/commit/b767be2))
* fix: add retry logic to CI pre-release test and normalize error handling in community commands ([ebdc4b4](https://github.com/bitsocialhq/bitsocial-cli/commit/ebdc4b4))

## <small>0.19.7 (2026-02-08)</small>

* build(deps): upgrade plebbit-js ([3ab36e9](https://github.com/bitsocialhq/bitsocial-cli/commit/3ab36e9))

## <small>0.19.6 (2026-02-02)</small>

* build(deps): upgrade plebbit-js ([118763b](https://github.com/bitsocialhq/bitsocial-cli/commit/118763b))

## <small>0.19.5 (2026-02-01)</small>

* fix(ci): avoid direct plebbit-js import in daemon release test ([9d21aaa](https://github.com/bitsocialhq/bitsocial-cli/commit/9d21aaa))
* build(packaging): ci build ([c654609](https://github.com/bitsocialhq/bitsocial-cli/commit/c654609))
* build(packaging): remove dist/ and oclif.manifest.json from git tracking ([79c86ab](https://github.com/bitsocialhq/bitsocial-cli/commit/79c86ab))

## <small>0.19.4 (2026-02-01)</small>

* build(deps): upgrade plebbit-js ([b315d92](https://github.com/bitsocialhq/bitsocial-cli/commit/b315d92))
* build(packaging): ci build ([87da2c4](https://github.com/bitsocialhq/bitsocial-cli/commit/87da2c4))
* build(webuis): remove plebchan from web UIs ([359e24b](https://github.com/bitsocialhq/bitsocial-cli/commit/359e24b))

## <small>0.19.3 (2026-01-29)</small>

* build(deps): upgrade plebbit-js ([dfef175](https://github.com/bitsocialhq/bitsocial-cli/commit/dfef175))
* build(packaging): ci build ([de2ba85](https://github.com/bitsocialhq/bitsocial-cli/commit/de2ba85))

## <small>0.19.2 (2026-01-26)</small>

* build(deps): upgrade plebbit-js ([24a8ccb](https://github.com/bitsocialhq/bitsocial-cli/commit/24a8ccb))
* chore(ci): remove CI-alerts workflow ([a504f96](https://github.com/bitsocialhq/bitsocial-cli/commit/a504f96))

## <small>0.19.1 (2026-01-20)</small>

* docs(changelog): remove duplicate 1.0.0 version ([54809cb](https://github.com/bitsocialhq/bitsocial-cli/commit/54809cb))
* build(packaging): ci build ([fc0cfc5](https://github.com/bitsocialhq/bitsocial-cli/commit/fc0cfc5))

## 0.19.0 (2026-01-20)

* fix(ci): add oclif debug logging and update dependencies ([27d3ffd](https://github.com/bitsocialhq/bitsocial-cli/commit/27d3ffd))
* fix(ci): add write permissions to release workflow and revert version to 0.18.0 ([a2e225e](https://github.com/bitsocialhq/bitsocial-cli/commit/a2e225e))
* fix(ci): prevent auto-bump to major version and revert to 0.18.0 ([906fd5d](https://github.com/bitsocialhq/bitsocial-cli/commit/906fd5d))
* fix(ci): prevent auto-bump to major version and revert to 0.18.0 ([6799c68](https://github.com/bitsocialhq/bitsocial-cli/commit/6799c68))
* fix(release): downgrade @release-it/conventional-changelog to 10.0.1 ([2ba7954](https://github.com/bitsocialhq/bitsocial-cli/commit/2ba7954))
* fix(release): upgrade release-it to 19.2.3 ([64584e6](https://github.com/bitsocialhq/bitsocial-cli/commit/64584e6))
* fix(test): add process isolation to prevent flaky CLI tests ([e68a3ab](https://github.com/bitsocialhq/bitsocial-cli/commit/e68a3ab))
* fix(test): use runCliCommand helper in edit.community.test ([93652c3](https://github.com/bitsocialhq/bitsocial-cli/commit/93652c3))
* chore(formatting): just formatted the file ([1059c9c](https://github.com/bitsocialhq/bitsocial-cli/commit/1059c9c))
* chore(release): 1.0.0 [skip ci] ([19fcf13](https://github.com/bitsocialhq/bitsocial-cli/commit/19fcf13))
* chore(release): 1.0.0 [skip ci] ([48fa4d6](https://github.com/bitsocialhq/bitsocial-cli/commit/48fa4d6))
* chore(release): 1.0.0 [skip ci] ([2002514](https://github.com/bitsocialhq/bitsocial-cli/commit/2002514))
* chore(seeder): remove seeder since it's not needed ([f984a33](https://github.com/bitsocialhq/bitsocial-cli/commit/f984a33))
* docs: add RENAMING_GUIDE.md for bitsocial-cli rebrand ([3b58931](https://github.com/bitsocialhq/bitsocial-cli/commit/3b58931))
* docs: add testing guidelines to AGENTS.md ([4e47bc5](https://github.com/bitsocialhq/bitsocial-cli/commit/4e47bc5))
* docs: expand RENAMING_GUIDE.md with missing items ([5156bb0](https://github.com/bitsocialhq/bitsocial-cli/commit/5156bb0))
* docs: update RENAMING_GUIDE.md with completion status ([0949337](https://github.com/bitsocialhq/bitsocial-cli/commit/0949337))
* docs(claude.md): add claude documentation ([b92886e](https://github.com/bitsocialhq/bitsocial-cli/commit/b92886e))
* docs(readme): update Bitsocial name ([d9d8510](https://github.com/bitsocialhq/bitsocial-cli/commit/d9d8510))
* docs(readme): update references to bitsocial ([3db6ac0](https://github.com/bitsocialhq/bitsocial-cli/commit/3db6ac0))
* feat(cli): add plebbit-js version and commit to --version output ([a22a683](https://github.com/bitsocialhq/bitsocial-cli/commit/a22a683))
* build(deps): upgrade plebbit-js ([77d2d53](https://github.com/bitsocialhq/bitsocial-cli/commit/77d2d53))
* build(deps): upgrade release tooling and include build commits in changelog ([23c2189](https://github.com/bitsocialhq/bitsocial-cli/commit/23c2189))
* build(packaging): ci build ([8b837b7](https://github.com/bitsocialhq/bitsocial-cli/commit/8b837b7))
* test: stabilize cli tests ([4803595](https://github.com/bitsocialhq/bitsocial-cli/commit/4803595))
* refactor(test): migrate from mocha/chai to vitest ([05803f9](https://github.com/bitsocialhq/bitsocial-cli/commit/05803f9))
* refactor!: rebrand plebbit-cli to bitsocial-cli ([37f034d](https://github.com/bitsocialhq/bitsocial-cli/commit/37f034d))



## [0.17.13](https://github.com/plebbit/plebbit-cli/compare/v0.17.12...v0.17.13) (2026-01-04)

## [0.17.12](https://github.com/plebbit/plebbit-cli/compare/v0.17.11...v0.17.12) (2026-01-03)

## [0.17.11](https://github.com/plebbit/plebbit-cli/compare/v0.17.10...v0.17.11) (2025-12-31)

## [0.17.10](https://github.com/plebbit/plebbit-cli/compare/v0.17.9...v0.17.10) (2025-12-26)


### Bug Fixes

* **get:** fix bug with importing Plebbit, and another bug subplebbit get ([6c62c81](https://github.com/plebbit/plebbit-cli/commit/6c62c8155a78a0d777d4dc17cb4a979691b8bc89))

## [0.17.9](https://github.com/plebbit/plebbit-cli/compare/v0.17.8...v0.17.9) (2025-12-23)

## [0.17.8](https://github.com/plebbit/plebbit-cli/compare/v0.17.7...v0.17.8) (2025-12-23)

## [0.17.7](https://github.com/plebbit/plebbit-cli/compare/v0.17.6...v0.17.7) (2025-12-23)


### Bug Fixes

* **kubo:** adjust fetching of kubo version from package.json ([69a0689](https://github.com/plebbit/plebbit-cli/commit/69a06898128a722925ab6f1942ff65268aca782d))

## [0.17.6](https://github.com/plebbit/plebbit-cli/compare/v0.17.5...v0.17.6) (2025-12-23)

## [0.17.5](https://github.com/plebbit/plebbit-cli/compare/v0.17.4...v0.17.5) (2025-10-30)

## [0.17.4](https://github.com/plebbit/plebbit-cli/compare/v0.17.3...v0.17.4) (2025-10-28)

## [0.17.3](https://github.com/plebbit/plebbit-cli/compare/v0.17.2...v0.17.3) (2025-10-26)

## [0.17.2](https://github.com/plebbit/plebbit-cli/compare/v0.17.1...v0.17.2) (2025-10-17)


### Bug Fixes

* **daemon:** handle edge cases with ipfs daemon not getting killed ([6bb878b](https://github.com/plebbit/plebbit-cli/commit/6bb878b4a2664cd5b89c185d1d186282618ae84e))
* **ipfs:** fix default config to make gateway is working + add tests for gateway and RPC API ([c837962](https://github.com/plebbit/plebbit-cli/commit/c8379624875c76a19662374367597cfb72b299ca))
* **ipfs:** update ipfs config to be correct ([e721603](https://github.com/plebbit/plebbit-cli/commit/e72160399f43a330848248a02a41732d57a404e3))

## [0.17.1](https://github.com/plebbit/plebbit-cli/compare/v0.17.0...v0.17.1) (2025-10-17)

# [0.17.0](https://github.com/plebbit/plebbit-cli/compare/v0.16.17...v0.17.0) (2025-10-17)


### Features

* **ipfs:** only merge our default ipfs config when it's a new repo. Also disable redirecting ([586c7c0](https://github.com/plebbit/plebbit-cli/commit/586c7c02103e24038134f9bd27be545a06366295))

## [0.16.17](https://github.com/plebbit/plebbit-cli/compare/v0.16.16...v0.16.17) (2025-10-15)

## [0.16.16](https://github.com/plebbit/plebbit-cli/compare/v0.16.15...v0.16.16) (2025-08-28)

## [0.16.15](https://github.com/plebbit/plebbit-cli/compare/v0.16.14...v0.16.15) (2025-07-28)

## [0.16.14](https://github.com/plebbit/plebbit-cli/compare/v0.16.13...v0.16.14) (2025-07-25)

## [0.16.13](https://github.com/plebbit/plebbit-cli/compare/v0.16.12...v0.16.13) (2025-07-01)

## [0.16.12](https://github.com/plebbit/plebbit-cli/compare/v0.16.11...v0.16.12) (2025-06-23)

## [0.16.11](https://github.com/plebbit/plebbit-cli/compare/v0.16.10...v0.16.11) (2025-06-16)

## [0.16.10](https://github.com/plebbit/plebbit-cli/compare/v0.16.9...v0.16.10) (2025-06-13)


### Bug Fixes

* **cli:** fix bug with not reading args properly in create ([ff81c47](https://github.com/plebbit/plebbit-cli/commit/ff81c470f3cae1fafea0c435c75dfe9605706524))

## [0.16.9](https://github.com/plebbit/plebbit-cli/compare/v0.16.8...v0.16.9) (2025-05-24)

## [0.16.8](https://github.com/plebbit/plebbit-cli/compare/v0.16.7...v0.16.8) (2025-05-21)

## [0.16.7](https://github.com/plebbit/plebbit-cli/compare/v0.16.6...v0.16.7) (2025-05-18)

## [0.16.6](https://github.com/plebbit/plebbit-cli/compare/v0.16.5...v0.16.6) (2025-05-07)

## [0.16.5](https://github.com/plebbit/plebbit-cli/compare/v0.16.4...v0.16.5) (2025-05-07)


### Bug Fixes

* **cli:** make sure subplebbit commands print proper plebbit errors ([b82b1f4](https://github.com/plebbit/plebbit-cli/commit/b82b1f43d968eca15cdcac6952c598bc0d40035b))
* **daemon:** make sure kubo node is killed at the end ([98e1aa1](https://github.com/plebbit/plebbit-cli/commit/98e1aa190eb3d441d74c400f7c19990046752992))
* **rpc:** make sure to handle errors bubbled up to Plebbit instance ([e46c027](https://github.com/plebbit/plebbit-cli/commit/e46c027577d8facd4805ca1c559099768dcf4f32))

## [0.16.4](https://github.com/plebbit/plebbit-cli/compare/v0.16.3...v0.16.4) (2025-05-05)


### Bug Fixes

* **daemon:** make sure not to destroy plebbit or kubo multiple times ([958904d](https://github.com/plebbit/plebbit-cli/commit/958904da554e6dee157c63322c80b6ffa11fe785))

## [0.16.3](https://github.com/plebbit/plebbit-cli/compare/v0.16.2...v0.16.3) (2025-05-04)


### Bug Fixes

* **daemon:** make sure plebbit is destroyed before killing ipfs ([98aea30](https://github.com/plebbit/plebbit-cli/commit/98aea300a0fec994ff49cfb92fa8494495c4ac04))

## [0.16.2](https://github.com/plebbit/plebbit-cli/compare/v0.16.1...v0.16.2) (2025-05-04)

## [0.16.1](https://github.com/plebbit/plebbit-cli/compare/v0.16.0...v0.16.1) (2025-05-03)


### Bug Fixes

* **kubo:** make sure to include other config of AutoTLS ([3cd878b](https://github.com/plebbit/plebbit-cli/commit/3cd878b5afee46e10e231da62cfb76cf3ebc6014))
* **plebbit-js:** fix import of plebbit-js RPC server ([945db86](https://github.com/plebbit/plebbit-cli/commit/945db86cfe7dcda7723292eaa08f70417b837a6f))

# [0.16.0](https://github.com/plebbit/plebbit-cli/compare/v0.15.14...v0.16.0) (2025-01-01)


### Bug Fixes

* **webui:** fix bug with how index.html was changed ([86f0d81](https://github.com/plebbit/plebbit-cli/commit/86f0d81555d4b7380d767332daeff01dc46b86c6))
* **webui:** fix bug with how index.html was changed ([784a8aa](https://github.com/plebbit/plebbit-cli/commit/784a8aade3184a7ada7ebedc0c0778adb1037d86))
* **webui:** forgot to decompress properly ([aa26b8e](https://github.com/plebbit/plebbit-cli/commit/aa26b8e0789235234ec3c6ff0790a723df5bc6cb))
* **webui:** handle local 0.0.0.0 address ([90812f9](https://github.com/plebbit/plebbit-cli/commit/90812f96f9ce85ddd2a06c6d68eeba7f8535fd01))
* **webui:** make sure users don't go to the wrong index.html ([94b9c12](https://github.com/plebbit/plebbit-cli/commit/94b9c12274920c99b0bfc3e6ce81b477dd9565d0))


### Features

* **webui:** add plebchan to plebbit-cli hosted frontends ([d4ed5dd](https://github.com/plebbit/plebbit-cli/commit/d4ed5ddb35695c527cc7cf12c4d06a8a4a1f3c60))

## [0.15.14](https://github.com/plebbit/plebbit-cli/compare/v0.15.13...v0.15.14) (2024-12-28)


### Bug Fixes

* **web-ui:** fix bug where web ui would be cached indefintely ([58b8937](https://github.com/plebbit/plebbit-cli/commit/58b8937b4de95cafcff2cdbaa1db0c2d9f426f45))

## [0.15.13](https://github.com/plebbit/plebbit-cli/compare/v0.15.12...v0.15.13) (2024-12-28)

## [0.15.12](https://github.com/plebbit/plebbit-cli/compare/v0.15.11...v0.15.12) (2024-12-09)


### Reverts

* Revert "refactor(ipfs): change default ipfs port to 50019" ([9f828de](https://github.com/plebbit/plebbit-cli/commit/9f828dee9e3d4971371210a6d89ec50991887e9c))

## [0.15.11](https://github.com/plebbit/plebbit-cli/compare/v0.15.10...v0.15.11) (2024-12-04)


### Bug Fixes

* **ci:** handle error emitting by RPC client ([a1a0e38](https://github.com/plebbit/plebbit-cli/commit/a1a0e389f1a663437a7bfc5190f2bf35f009cb49))

## [0.15.10](https://github.com/plebbit/plebbit-cli/compare/v0.15.9...v0.15.10) (2024-12-04)


### Bug Fixes

* **ci:** make sure to wait a bit before starting the sub ([b3e1755](https://github.com/plebbit/plebbit-cli/commit/b3e175567909cb008a8fdef085d6a9b885db9756))

## [0.15.9](https://github.com/plebbit/plebbit-cli/compare/v0.15.8...v0.15.9) (2024-12-04)


### Bug Fixes

* **ci:** forgot to add command ([c6e1afc](https://github.com/plebbit/plebbit-cli/commit/c6e1afc7d1c5aca3b3327dee215b93e69a51ef8a))

## [0.15.8](https://github.com/plebbit/plebbit-cli/compare/v0.15.7...v0.15.8) (2024-12-04)

## [0.15.7](https://github.com/plebbit/plebbit-cli/compare/v0.15.6...v0.15.7) (2024-12-04)


### Bug Fixes

* **daemon:** remove colon in log file name which is causing windows to throw ([7bc6312](https://github.com/plebbit/plebbit-cli/commit/7bc6312d4cb66d2c3a95a37f06c8ea9fbb98c206))

## [0.15.6](https://github.com/plebbit/plebbit-cli/compare/v0.15.5...v0.15.6) (2024-12-02)


### Bug Fixes

* **windows:** make sure dir is there first (might fix error with windows) ([04df721](https://github.com/plebbit/plebbit-cli/commit/04df72101d0c871f32060fb83f0b3ed62c88916c))

## [0.15.5](https://github.com/plebbit/plebbit-cli/compare/v0.15.4...v0.15.5) (2024-12-01)


### Bug Fixes

* **webuis:** no longer write modified index.html to disk, should fix windows problem ([f674144](https://github.com/plebbit/plebbit-cli/commit/f6741445112bddae4061091c7b3c597f810193ab))
* **windows:** might fix bug with windows failing because it expects log file to be there ([ecf7b29](https://github.com/plebbit/plebbit-cli/commit/ecf7b296eac19eebce41f3c7e100d9fbab0c5a51))

## [0.15.4](https://github.com/plebbit/plebbit-cli/compare/v0.15.3...v0.15.4) (2024-11-30)

## [0.15.3](https://github.com/plebbit/plebbit-cli/compare/v0.15.2...v0.15.3) (2024-11-30)


### Bug Fixes

* **flag:** forgot to omit rpc url ([f364816](https://github.com/plebbit/plebbit-cli/commit/f36481635493d65a4e6e8905c1b6d2118cc499a0))
* **ipfs:** remove gc config that caused pubsub to not work ([206d9fb](https://github.com/plebbit/plebbit-cli/commit/206d9fbdb8712be976c3cc809866c2fba1f2851d))
* **ipfs:** throw a proper error for ipfs init ([9b514e7](https://github.com/plebbit/plebbit-cli/commit/9b514e7f720b5cdb3b2d3571cc7de784bd067fa6))

## [0.15.2](https://github.com/plebbit/plebbit-cli/compare/v0.15.1...v0.15.2) (2024-11-30)

## [0.15.1](https://github.com/plebbit/plebbit-cli/compare/v0.15.0...v0.15.1) (2024-11-27)

# [0.15.0](https://github.com/plebbit/plebbit-cli/compare/v0.14.4...v0.15.0) (2024-11-27)


### Features

* **command line parsing:** make sure --field value --field value is parsed as an array (WIP) ([f65e82d](https://github.com/plebbit/plebbit-cli/commit/f65e82d92d7239f362b503388705024124bf572b))
* **daemon:** enable AutoTLS by default to allow browser nodes to connect to daemon runners ([6219ace](https://github.com/plebbit/plebbit-cli/commit/6219ace4c231f25ce661fa92b80cc19549a82ee8))
* **daemon:** enable ipfs gc by default ([de8dee1](https://github.com/plebbit/plebbit-cli/commit/de8dee1e764ce54f653c3593ae57baf4e71fb769))
* **daemon:** implement plebbit options for daemon and change names of flags ([25519cf](https://github.com/plebbit/plebbit-cli/commit/25519cfce5c3cc08c4111359e46e944c9cc6319b))
* **logs:** add a new flag to specify directory which will be used to store logs ([a704661](https://github.com/plebbit/plebbit-cli/commit/a7046615b55a757a34b4554e7b07b4b3c4d5b016))

## [0.14.4](https://github.com/plebbit/plebbit-cli/compare/v0.14.3...v0.14.4) (2024-11-10)

## [0.14.3](https://github.com/plebbit/plebbit-cli/compare/v0.14.2...v0.14.3) (2024-11-05)

## [0.14.2](https://github.com/plebbit/plebbit-cli/compare/v0.14.1...v0.14.2) (2024-11-04)

## [0.14.1](https://github.com/plebbit/plebbit-cli/compare/v0.14.0...v0.14.1) (2024-11-04)


### Bug Fixes

* **install:** make sure to remove prior versions files ([e9593ed](https://github.com/plebbit/plebbit-cli/commit/e9593ed84320bf5597f63b581e8d16c2935bbdc1))

# [0.14.0](https://github.com/plebbit/plebbit-cli/compare/v0.13.5...v0.14.0) (2024-11-04)


### Bug Fixes

* **type:** make sure to not to use internal types of plebbit-js ([591a7c4](https://github.com/plebbit/plebbit-cli/commit/591a7c4e51547c0ebf8fb4463d62a5ffd129ca72))


### Features

* **daemon:** plebbit-cli will use http router (trackers) by default ([2b23129](https://github.com/plebbit/plebbit-cli/commit/2b23129f28d593d19fde170e63022830ee0e54c5))

## [0.13.7](https://github.com/plebbit/plebbit-cli/compare/v0.13.6...v0.13.7) (2024-08-31)

## [0.13.6](https://github.com/plebbit/plebbit-cli/compare/v0.13.5...v0.13.6) (2024-08-31)


### Bug Fixes

* **type:** make sure to not to use internal types of plebbit-js ([591a7c4](https://github.com/plebbit/plebbit-cli/commit/591a7c4e51547c0ebf8fb4463d62a5ffd129ca72))

## [0.13.5](https://github.com/plebbit/plebbit-cli/compare/v0.13.4...v0.13.5) (2024-07-06)

## [0.13.4](https://github.com/plebbit/plebbit-cli/compare/v0.13.3...v0.13.4) (2024-06-12)

## [0.13.3](https://github.com/plebbit/plebbit-cli/compare/v0.13.2...v0.13.3) (2024-05-15)

## [0.13.2](https://github.com/plebbit/plebbit-cli/compare/v0.13.1...v0.13.2) (2024-05-15)

## [0.13.1](https://github.com/plebbit/plebbit-cli/compare/v0.13.0...v0.13.1) (2024-05-15)

# [0.13.0](https://github.com/plebbit/plebbit-cli/compare/v0.12.4...v0.13.0) (2024-05-15)


### Bug Fixes

* **logs:** make sure to close the log file on process exiting, also don't write to file if over 20mb ([85629ad](https://github.com/plebbit/plebbit-cli/commit/85629ad52d2a07c51e7ebfe8aa8f00344cfe6405))


### Features

* **types:** correct types and tests ([48ad0bb](https://github.com/plebbit/plebbit-cli/commit/48ad0bb3fe4a33136e41f79db87efa6d3a194e13))

## [0.12.4](https://github.com/plebbit/plebbit-cli/compare/v0.12.3...v0.12.4) (2024-05-08)


### Bug Fixes

* **web ui:** correct the traversal of web uis dir when calling plebbit from anywhere ([52a0c87](https://github.com/plebbit/plebbit-cli/commit/52a0c875899d19dc03f9fa64e3b2c565da5e40ea))

## [0.12.3](https://github.com/plebbit/plebbit-cli/compare/v0.12.2...v0.12.3) (2024-05-08)

## [0.12.2](https://github.com/plebbit/plebbit-cli/compare/v0.12.1...v0.12.2) (2024-05-08)

## [0.12.1](https://github.com/plebbit/plebbit-cli/compare/v0.12.0...v0.12.1) (2024-05-08)

# [0.12.0](https://github.com/plebbit/plebbit-cli/compare/v0.11.37...v0.12.0) (2024-05-08)


### Bug Fixes

* **ipfs:** config server seems to not cause congestion, needs further testing ([fc651b6](https://github.com/plebbit/plebbit-cli/commit/fc651b679656256ef42687e322f5da4790a650e9))
* **log:** make sure directory of logs is recurisvely created ([6417cea](https://github.com/plebbit/plebbit-cli/commit/6417cea8223f25e5a681b9dbd4dc0103bd0d8474))
* **webui:** fix some bugs related to rpc within webui ([f3d734b](https://github.com/plebbit/plebbit-cli/commit/f3d734b031c52bcbc98ed6d20b97cbe385080dde))
* **webui:** fix some bugs with web ui ([43134b1](https://github.com/plebbit/plebbit-cli/commit/43134b13dce3c24dfec797f2285991f8d4cea914))
* **webui:** rework the webui logic to include web uis as part of the .tar.gz of plebbit-cli ([f7a603e](https://github.com/plebbit/plebbit-cli/commit/f7a603e51189699aa44a8e3d8864dc3e98b2a962))


### Features

* **daemon:** daemon will host seedit web ui to manage subs by default (WIP) ([6acac53](https://github.com/plebbit/plebbit-cli/commit/6acac5357bbd7342d8c3be1caa193256d356b000))
* **logs:** implement storing logs and default debug namespace ([c9e9c2d](https://github.com/plebbit/plebbit-cli/commit/c9e9c2dade6ab9c9adfcb56f5fd34463fae55020))
* **subplebbit-get:** implement plebbit subplebbit get ([6b83c53](https://github.com/plebbit/plebbit-cli/commit/6b83c5330aaa38ead091612c67bc6df106d279df))

## [0.11.37](https://github.com/plebbit/plebbit-cli/compare/v0.11.36...v0.11.37) (2024-04-03)

## [0.11.36](https://github.com/plebbit/plebbit-cli/compare/v0.11.35...v0.11.36) (2024-03-31)

## [0.11.35](https://github.com/plebbit/plebbit-cli/compare/v0.11.34...v0.11.35) (2024-03-31)

## [0.11.34](https://github.com/plebbit/plebbit-cli/compare/v0.11.33...v0.11.34) (2024-03-29)

## [0.11.33](https://github.com/plebbit/plebbit-cli/compare/v0.11.32...v0.11.33) (2024-03-29)

## [0.11.32](https://github.com/plebbit/plebbit-cli/compare/v0.11.31...v0.11.32) (2024-03-23)


### Bug Fixes

* **daemon:** fix bugs with starting multiple ipfs and plebbit daemons ([c2d1539](https://github.com/plebbit/plebbit-cli/commit/c2d153941fe8f4cb2952d8a272195ecad179d014))
* **daemon:** plebbit daemon will use and monitor IPFS and Plebbit RPC started by other processes ([2aea8f5](https://github.com/plebbit/plebbit-cli/commit/2aea8f58512fab0c02ad703cebe978c4c2e4b2b1))
* **daemon:** write rpc auth key to the correct path ([5408abf](https://github.com/plebbit/plebbit-cli/commit/5408abf949a19f04369f1df0dd3d4fc8733b4a3d))

## [0.11.31](https://github.com/plebbit/plebbit-cli/compare/v0.11.30...v0.11.31) (2024-03-22)


### Bug Fixes

* **edit:** throw if user tries to edit a remote sub ([2b4c245](https://github.com/plebbit/plebbit-cli/commit/2b4c245785397f2d2745004baca8cc3c00484d4c))

## [0.11.30](https://github.com/plebbit/plebbit-cli/compare/v0.11.29...v0.11.30) (2024-03-14)

## [0.11.29](https://github.com/plebbit/plebbit-cli/compare/v0.11.28...v0.11.29) (2024-03-14)

## [0.11.28](https://github.com/plebbit/plebbit-cli/compare/v0.11.27...v0.11.28) (2024-03-13)

## [0.11.27](https://github.com/plebbit/plebbit-cli/compare/v0.11.26...v0.11.27) (2024-03-13)

## [0.11.26](https://github.com/plebbit/plebbit-cli/compare/v0.11.25...v0.11.26) (2024-03-13)

## [0.11.25](https://github.com/plebbit/plebbit-cli/compare/v0.11.24...v0.11.25) (2024-03-13)


### Bug Fixes

* **list:** fix bug with started = true when sub isn't actually running ([e5f5ee6](https://github.com/plebbit/plebbit-cli/commit/e5f5ee69ddebc1a363902583d83881a7295839aa))

## [0.11.24](https://github.com/plebbit/plebbit-cli/compare/v0.11.23...v0.11.24) (2024-03-12)

## [0.11.23](https://github.com/plebbit/plebbit-cli/compare/v0.11.22...v0.11.23) (2024-03-12)

## [0.11.22](https://github.com/plebbit/plebbit-cli/compare/v0.11.21...v0.11.22) (2024-03-06)

## [0.11.21](https://github.com/plebbit/plebbit-cli/compare/v0.11.20...v0.11.21) (2024-03-06)

## [0.11.20](https://github.com/plebbit/plebbit-cli/compare/v0.11.19...v0.11.20) (2024-03-06)

## [0.11.19](https://github.com/plebbit/plebbit-cli/compare/v0.11.18...v0.11.19) (2024-03-06)

## [0.11.18](https://github.com/plebbit/plebbit-cli/compare/v0.11.17...v0.11.18) (2024-03-06)

## [0.11.17](https://github.com/plebbit/plebbit-cli/compare/v0.11.16...v0.11.17) (2024-03-06)

## [0.11.16](https://github.com/plebbit/plebbit-cli/compare/v0.11.15...v0.11.16) (2024-03-06)

## [0.11.15](https://github.com/plebbit/plebbit-cli/compare/v0.11.14...v0.11.15) (2024-03-06)

## [0.11.14](https://github.com/plebbit/plebbit-cli/compare/v0.11.13...v0.11.14) (2024-03-06)

## [0.11.13](https://github.com/plebbit/plebbit-cli/compare/v0.11.12...v0.11.13) (2024-03-04)

## [0.11.12](https://github.com/plebbit/plebbit-cli/compare/v0.11.11...v0.11.12) (2024-03-02)


### Bug Fixes

* **install:** relative argument not needed ([80e9a83](https://github.com/plebbit/plebbit-cli/commit/80e9a831e0c9a3b364dccf2bc2cc5f43bbf706df))

## [0.11.11](https://github.com/plebbit/plebbit-cli/compare/v0.11.10...v0.11.11) (2024-02-18)

## [0.11.10](https://github.com/plebbit/plebbit-cli/compare/v0.11.9...v0.11.10) (2024-02-18)

## [0.11.9](https://github.com/plebbit/plebbit-cli/compare/v0.11.8...v0.11.9) (2024-02-18)


### Bug Fixes

* remove fs-extra, not needed ([9754233](https://github.com/plebbit/plebbit-cli/commit/9754233b275f341354c4a47a0dca2d1544f0da30))

## [0.11.8](https://github.com/plebbit/plebbit-cli/compare/v0.11.7...v0.11.8) (2024-02-17)

## [0.11.7](https://github.com/plebbit/plebbit-cli/compare/v0.11.6...v0.11.7) (2024-02-17)

## [0.11.6](https://github.com/plebbit/plebbit-cli/compare/v0.11.5...v0.11.6) (2024-02-17)

## [0.11.5](https://github.com/plebbit/plebbit-cli/compare/v0.11.4...v0.11.5) (2024-02-17)

## [0.11.4](https://github.com/plebbit/plebbit-cli/compare/v0.11.3...v0.11.4) (2024-02-17)

## [0.11.3](https://github.com/plebbit/plebbit-cli/compare/v0.11.2...v0.11.3) (2024-02-17)

## [0.11.2](https://github.com/plebbit/plebbit-cli/compare/v0.11.1...v0.11.2) (2024-02-17)


### Bug Fixes

* fix import errors caused by plebbit-js going ESM only ([76b2407](https://github.com/plebbit/plebbit-cli/commit/76b24076f50228e35117ba3bddad16d3af2ce8b3))

## [0.11.1](https://github.com/plebbit/plebbit-cli/compare/v0.11.0...v0.11.1) (2024-01-03)

# [0.11.0](https://github.com/plebbit/plebbit-cli/compare/v0.10.2...v0.11.0) (2023-12-31)


### Features

* **daemon:** plebbit daemon will use ipfs API instead of starting a new daemon if api port is used ([7c8a1c1](https://github.com/plebbit/plebbit-cli/commit/7c8a1c1c5d336a5ce45f53ea0a8deaa0590f39b0))

## [0.10.2](https://github.com/plebbit/plebbit-cli/compare/v0.10.1...v0.10.2) (2023-12-11)

## [0.10.1](https://github.com/plebbit/plebbit-cli/compare/v0.10.0...v0.10.1) (2023-12-09)

# [0.10.0](https://github.com/plebbit/plebbit-cli/compare/v0.9.6...v0.10.0) (2023-12-05)


### Features

* **daemon:** add rpc auth key to plebbit rpc ([79fa920](https://github.com/plebbit/plebbit-cli/commit/79fa9204c408d50a10bc0e8b979c9e8aefb081bf))

## [0.9.6](https://github.com/plebbit/plebbit-cli/compare/v0.9.5...v0.9.6) (2023-11-24)

## [0.9.5](https://github.com/plebbit/plebbit-cli/compare/v0.9.4...v0.9.5) (2023-11-24)

## [0.9.4](https://github.com/plebbit/plebbit-cli/compare/v0.9.3...v0.9.4) (2023-11-22)

## [0.9.3](https://github.com/plebbit/plebbit-cli/compare/v0.9.2...v0.9.3) (2023-11-18)

## [0.9.2](https://github.com/plebbit/plebbit-cli/compare/v0.9.1...v0.9.2) (2023-11-18)


### Bug Fixes

* **list:** make sure plebbit is destroyed ([f04c1a1](https://github.com/plebbit/plebbit-cli/commit/f04c1a1d6afe91ef2c500abdbd90734c76e89623))

## [0.9.1](https://github.com/plebbit/plebbit-cli/compare/v0.9.0...v0.9.1) (2023-11-18)

# [0.9.0](https://github.com/plebbit/plebbit-cli/compare/v0.8.2...v0.9.0) (2023-11-18)


### Features

* **create:** implement dynamic flags for subplebbit create ([c3e33d8](https://github.com/plebbit/plebbit-cli/commit/c3e33d831896739f0580cd67c9af1eb42744dd8b))
* **edit:** implement dynamic flags for editing a subplebbit ([3c3c9c5](https://github.com/plebbit/plebbit-cli/commit/3c3c9c5a32a9f827cb48280298d58ca45de10505))

## [0.8.2](https://github.com/plebbit/plebbit-cli/compare/v0.8.1...v0.8.2) (2023-11-13)


### Bug Fixes

* **daemon:** fix rpc import problem with daemon command ([5cadece](https://github.com/plebbit/plebbit-cli/commit/5cadece48aeef12ba64d68781332c6590460bf17))

## [0.8.1](https://github.com/plebbit/plebbit-cli/compare/v0.8.0...v0.8.1) (2023-11-13)

# [0.8.0](https://github.com/plebbit/plebbit-cli/compare/v0.7.15...v0.8.0) (2023-11-13)


### Bug Fixes

* **cli:** make sure websocket connection is closed down after cli command ([5b7a3a7](https://github.com/plebbit/plebbit-cli/commit/5b7a3a7637846783020e3ebd264a5dcf32d6d369))
* **cli:** no need to fetch startedState if -q is used ([26d3ee6](https://github.com/plebbit/plebbit-cli/commit/26d3ee6ed6502d5f3b90b2d740c2fab428753fd6))
* **daemon:** corrected printed gateway url ([1d722a9](https://github.com/plebbit/plebbit-cli/commit/1d722a9c97c0e40753e25704b138c70c0e69bcdb))
* **daemon:** make sure rpc server is destroyed when process is exited ([34d1b8d](https://github.com/plebbit/plebbit-cli/commit/34d1b8da89592f0863a7ab780e3b08f8058cff7c))
* **seeder:** comment out seeding functionality for now ([a566152](https://github.com/plebbit/plebbit-cli/commit/a56615242dc7a533dab8ac6cef108de8a41a9a4c))


### Features

* **ci:** to force a new release ([e7405a1](https://github.com/plebbit/plebbit-cli/commit/e7405a19a1d94b4296d43842f29d184cc157e1ac))
* **ci:** to trigger a new release ([aa6c5a9](https://github.com/plebbit/plebbit-cli/commit/aa6c5a93489b3fd08b75ab8a699fca2ebb282afa))

* build(deps): upgrade plebbit-js and kubo and remove unneeded code (3c9fd7c)
* fix(daemon): make sure rpc server is destroyed when process is exited (34d1b8d)
* fix(cli): make sure websocket connection is closed down after cli command (5b7a3a7)
* fix(daemon): corrected printed gateway url (1d722a9)
* test(cli): fix tests and CI (2230bc8)
* style(cli): clearer messages (cdaedc9)
* fix(cli): no need to fetch startedState if -q is used (26d3ee6)
* test(create): migrate cli create command to latest plebbit-cli (418e3b3)
* refactor(cli): migrate the CLI codebase to plebbit-js with rpc. HTTP API not needed anymore (39dc54f)
* build(deps): upgrade deps including plebbit-js (a7f5ec8)
* fix(seeder): comment out seeding functionality for now (a566152)
* Delete plebwhales.eth (e1f1ca3)
* Update README.md (9075efa)
* build(packaging): ci build (45d10a3)

## [0.7.16](https://github.com/plebbit/plebbit-cli/compare/v0.7.15...v0.7.16) (2023-08-31)

## [0.7.15](https://github.com/plebbit/plebbit-cli/compare/v0.7.14...v0.7.15) (2023-08-30)

## [0.7.14](https://github.com/plebbit/plebbit-cli/compare/v0.7.13...v0.7.14) (2023-08-29)

## [0.7.13](https://github.com/plebbit/plebbit-cli/compare/v0.7.12...v0.7.13) (2023-08-27)

## [0.7.12](https://github.com/plebbit/plebbit-cli/compare/v0.7.11...v0.7.12) (2023-08-23)

## [0.7.11](https://github.com/plebbit/plebbit-cli/compare/v0.7.10...v0.7.11) (2023-08-22)

## [0.7.10](https://github.com/plebbit/plebbit-cli/compare/v0.7.9...v0.7.10) (2023-08-22)


### Bug Fixes

* **api:** add error event handler for Plebbit ([4524984](https://github.com/plebbit/plebbit-cli/commit/45249842d16da3677ba94054c67c01614cdcabf0))

## [0.7.9](https://github.com/plebbit/plebbit-cli/compare/v0.7.8...v0.7.9) (2023-08-18)


### Bug Fixes

* **api:** handle error events of subs ([0141fb4](https://github.com/plebbit/plebbit-cli/commit/0141fb4aa4dba53d8f8436676b9ac3dadb5cc45c))
* **api:** handle error events of subs ([50527b3](https://github.com/plebbit/plebbit-cli/commit/50527b33f13af745352c88fa3e93a0e34b2bbc9b))

## [0.7.8](https://github.com/plebbit/plebbit-cli/compare/v0.7.7...v0.7.8) (2023-08-17)


### Performance Improvements

* **daemon:** optimize seeding ([fa27931](https://github.com/plebbit/plebbit-cli/commit/fa279319c5d27e3a9b976ec959f92d252e66b8d9))

## [0.7.7](https://github.com/plebbit/plebbit-cli/compare/v0.7.6...v0.7.7) (2023-07-20)

## [0.7.6](https://github.com/plebbit/plebbit-cli/compare/v0.7.5...v0.7.6) (2023-07-16)

## [0.7.5](https://github.com/plebbit/plebbit-cli/compare/v0.7.4...v0.7.5) (2023-07-16)

## [0.7.4](https://github.com/plebbit/plebbit-cli/compare/v0.7.3...v0.7.4) (2023-07-12)

## [0.7.3](https://github.com/plebbit/plebbit-cli/compare/v0.7.2...v0.7.3) (2023-06-16)

## [0.7.2](https://github.com/plebbit/plebbit-cli/compare/v0.7.1...v0.7.2) (2023-04-23)

## [0.7.1](https://github.com/plebbit/plebbit-cli/compare/v0.7.0...v0.7.1) (2023-04-23)


### Bug Fixes

* **api:** fixed bug where daemon --seed expects node to be online at all time ([cdf3ac3](https://github.com/plebbit/plebbit-cli/commit/cdf3ac3e0b1ff10941ddeb3f6e3ba85cae31d140)), closes [#8](https://github.com/plebbit/plebbit-cli/issues/8)

# [0.7.0](https://github.com/plebbit/plebbit-cli/compare/v0.6.6...v0.7.0) (2023-04-18)


### Bug Fixes

* **api:** start seeding immedietly, no need to wait for 5 minutes ([f917fbd](https://github.com/plebbit/plebbit-cli/commit/f917fbd0676207cb3aa4ecd3e9f22ceb1e75f8ab))
* **cli:** seed flag is now separated into a boolean for seeding, and another flag for seeded subs ([ba9aa48](https://github.com/plebbit/plebbit-cli/commit/ba9aa4877a12916d6350c2274110558ab8d56e34))
* **deps:** migrate ipfs when running daemon ([41107c5](https://github.com/plebbit/plebbit-cli/commit/41107c55c5d046d80ddbee148f75927c1b141dbd))


### Features

* **api:** added an option to seed subs publications as well as propagation of their msgs ([71d4032](https://github.com/plebbit/plebbit-cli/commit/71d4032c0ee724eee8d827a3d90780406b8ba78f)), closes [#5](https://github.com/plebbit/plebbit-cli/issues/5)
* **api:** added an option to seed subs publications as well as propgation of their msgs ([11369f2](https://github.com/plebbit/plebbit-cli/commit/11369f2cc485ab8bd6817d8aa2001cc308cb807e)), closes [#5](https://github.com/plebbit/plebbit-cli/issues/5)


### Performance Improvements

* **api:** increase time between seedings from 5m to 10m ([6050a9b](https://github.com/plebbit/plebbit-cli/commit/6050a9b80ae6eef94e68fb8f79da459992304ad2))
* **api:** limit concurrency with ipns and add more debug msgs ([11a9d78](https://github.com/plebbit/plebbit-cli/commit/11a9d78715cbf6ebaf00c13f2519413e9f2eb404))

## [0.6.6](https://github.com/plebbit/plebbit-cli/compare/v0.6.5...v0.6.6) (2023-04-18)

## [0.6.5](https://github.com/plebbit/plebbit-cli/compare/v0.6.4...v0.6.5) (2023-04-01)

## [0.6.4](https://github.com/plebbit/plebbit-cli/compare/v0.6.3...v0.6.4) (2023-03-31)


### Bug Fixes

* **api:** rework the logic of subplebbit create HTTP endpoint ([3e0c832](https://github.com/plebbit/plebbit-cli/commit/3e0c83208ae4dfa809ab796c42dfe0bc6c89cef0))
* **cli:** fixed bug where cli role set creates a new sub instead of editing existing one ([5e4ed72](https://github.com/plebbit/plebbit-cli/commit/5e4ed72d4fefbe0412edeba8633ddce1fc776c9c))

## [0.6.3](https://github.com/plebbit/plebbit-cli/compare/v0.6.2...v0.6.3) (2023-03-30)

## [0.6.2](https://github.com/plebbit/plebbit-cli/compare/v0.6.1...v0.6.2) (2023-03-30)

## [0.6.1](https://github.com/plebbit/plebbit-cli/compare/v0.6.0...v0.6.1) (2023-03-30)

# [0.6.0](https://github.com/plebbit/plebbit-cli/compare/v0.5.1...v0.6.0) (2023-03-30)


### Features

* **cli:** add settings field to subplebbit edit in CLI ([0521c17](https://github.com/plebbit/plebbit-cli/commit/0521c17bcd58e051e0e8b44a1057cd5cfb50df53))

## [0.5.1](https://github.com/plebbit/plebbit-cli/compare/v0.5.0...v0.5.1) (2023-03-30)

# [0.5.0](https://github.com/plebbit/plebbit-cli/compare/v0.4.1...v0.5.0) (2023-01-16)


### Features

* **deps:** update plebbit-js ([af72a6b](https://github.com/plebbit/plebbit-cli/commit/af72a6bf8081b3773159a8da729cb5637004af8f))

## [0.4.1](https://github.com/plebbit/plebbit-cli/compare/v0.4.0...v0.4.1) (2022-12-23)

# [0.4.0](https://github.com/plebbit/plebbit-cli/compare/v0.3.1...v0.4.0) (2022-12-20)


### Features

* **cli:** implemented `plebbit subplebbit stop` to stop running subs from receiving and publishing ([f9e5c0a](https://github.com/plebbit/plebbit-cli/commit/f9e5c0ad59d06437597cd3097fd9d86c024ad8ae))

## [0.3.1](https://github.com/plebbit/plebbit-cli/compare/v1.3.0...v0.3.1) (2022-12-20)

# [0.3.0](https://github.com/plebbit/plebbit-cli/compare/0.2.0...v0.3.0) (2022-12-14)


### Features

* **cli:** a cli command to remove authors' roles within a subplebbit ([372a1e6](https://github.com/plebbit/plebbit-cli/commit/372a1e639fe0134ff1bc8a660e5e28c48c8c6125))

# [0.2.0](https://github.com/plebbit/plebbit-cli/compare/v0.1.1...v0.2.0) (2022-12-14)


### Features

* **cli:** a cli command to set roles for authors within a subplebbit ([d16d0ab](https://github.com/plebbit/plebbit-cli/commit/d16d0abfdf8e4c8a453d6f25e36d053c0ada267d))

## [0.1.1](https://github.com/plebbit/plebbit-cli/compare/v0.1.0...v0.1.1) (2022-12-13)


### Bug Fixes

* **cli:** iPFS node is restarted everytime it exits because of an error ([128e725](https://github.com/plebbit/plebbit-cli/commit/128e7259c25b49f9fa5566d052e08191c89f3dbb))

# [0.1.0](https://github.com/plebbit/plebbit-cli/compare/v0.0.0...v0.1.0) (2022-12-07)


### Features

* **cli-subplebbit-create:** replace privateKey option with privateKeyPath. A path to PEM file ([2f99706](https://github.com/plebbit/plebbit-cli/commit/2f99706eacbf3ad471e1364f2f399287638320a6))
* **cli-subplebbit-create:** start subplebbit after creating automatically ([2fb0dd5](https://github.com/plebbit/plebbit-cli/commit/2fb0dd520de86721aa740df34ed18085ace0661a))

# 0.0.1 (2022-12-06)


### Bug Fixes

* **cli:** use a different data path for IPFS node within daemon ([b98ed86](https://github.com/plebbit/plebbit-cli/commit/b98ed86c2ffdad33628dbcde34456aa75eae1c9e))
