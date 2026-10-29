# Changelog

## <small>0.19.115 (2026-10-29)</small>

* ci: add Claude Code review workflow ([607cba2](https://github.com/bitsocialnet/bitsocial-cli/commit/607cba2))
* ci: add Claude Code review workflow [skip github-alerts] ([5cece64](https://github.com/bitsocialnet/bitsocial-cli/commit/5cece64))
* ci: add Claude Code review workflow [skip github-alerts] ([3e79639](https://github.com/bitsocialnet/bitsocial-cli/commit/3e79639))
* ci: check earlier Claude comments before the no-issues summary [skip github-alerts] ([b42b8bb](https://github.com/bitsocialnet/bitsocial-cli/commit/b42b8bb))

## <small>0.19.114 (2026-10-27)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.126 ([bbbf81b](https://github.com/bitsocialnet/bitsocial-cli/commit/bbbf81b))
  * pkc-js [0.0.126](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.126) (2026-10-27)
    * fix: deflake state-order, startup-burst and RPC-timeout tests ([#435](https://github.com/pkcprotocol/pkc-js/issues/435) [#437](https://github.com/pkcprotocol/pkc-js/issues/437) [#265](https://github.com/pkcprotocol/pkc-js/issues/265) [#266](https://github.com/pkcprotocol/pkc-js/issues/266) [#253](https://github.com/pkcprotocol/pkc-js/issues/253)) ([#449](https://github.com/pkcprotocol/pkc-js/issues/449)) ([00d4231](https://github.com/pkcprotocol/pkc-js/commit/00d4231e0a702c4e6935604aedda7a50e36b9a92)), closes [#330](https://github.com/pkcprotocol/pkc-js/issues/330) [#456](https://github.com/pkcprotocol/pkc-js/issues/456)
  * pkc-js [0.0.125](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.125) (2026-10-27)
    * feat(community-list): add CommunityList, immutable signed lists of curated communities ([#309](https://github.com/pkcprotocol/pkc-js/issues/309)) ([b619f17](https://github.com/pkcprotocol/pkc-js/commit/b619f17c9b12e7c650aacde532943a1adb1ffb5d)), closes [#21](https://github.com/pkcprotocol/pkc-js/issues/21) [#342](https://github.com/pkcprotocol/pkc-js/issues/342) [#353](https://github.com/pkcprotocol/pkc-js/issues/353)
    * fix(deps): bump undici, zod, ws, uuid and probe-image-size for security advisories ([#452](https://github.com/pkcprotocol/pkc-js/issues/452)) ([f65551c](https://github.com/pkcprotocol/pkc-js/commit/f65551c080ee79689859b7d3188ec4de285a4fae))
  * pkc-js [0.0.124](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.124) (2026-10-23)
    * fix(community): match author names across .bso/.eth and letter case ([#424](https://github.com/pkcprotocol/pkc-js/issues/424)) ([#445](https://github.com/pkcprotocol/pkc-js/issues/445)) ([88dbac3](https://github.com/pkcprotocol/pkc-js/commit/88dbac3d1de69084d2c48c84641db3a7b1e8fd9e))
  * pkc-js [0.0.123](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.123) (2026-10-23)
    * fix(community): reject publications whose author.name has an uppercase letter ([#447](https://github.com/pkcprotocol/pkc-js/issues/447)) ([#448](https://github.com/pkcprotocol/pkc-js/issues/448)) ([134cacc](https://github.com/pkcprotocol/pkc-js/commit/134cacc15ae443a7b2a050dc059bdc105617faa4))
  * pkc-js [0.0.122](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.122) (2026-10-23)
    * fix(helia): turn off the delegated-routing Cache API cache and delete leftovers ([#442](https://github.com/pkcprotocol/pkc-js/issues/442)) ([f49e396](https://github.com/pkcprotocol/pkc-js/commit/f49e39648794ffd7177344e21ac438d4f5ddebfd)), closes [ipfs/helia-delegated-routing-v1-http-api#208](https://github.com/ipfs/helia-delegated-routing-v1-http-api/issues/208)
  * pkc-js [0.0.121](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.121) (2026-10-23)
    * fix(signer): reject AES-GCM decryption when the authentication tag does not match ([#418](https://github.com/pkcprotocol/pkc-js/issues/418)) ([#441](https://github.com/pkcprotocol/pkc-js/issues/441)) ([6cdd530](https://github.com/pkcprotocol/pkc-js/commit/6cdd5301c0a28f40e56c7c23b80461ab47bcb605))

## <small>0.19.113 (2026-10-23)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.120 ([bbf3b50](https://github.com/bitsocialnet/bitsocial-cli/commit/bbf3b50))
  * pkc-js [0.0.120](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.120) (2026-10-23)
    * fix(community): apply one identity rule to pages and to name edits ([#401](https://github.com/pkcprotocol/pkc-js/issues/401), [#430](https://github.com/pkcprotocol/pkc-js/issues/430)) ([#414](https://github.com/pkcprotocol/pkc-js/issues/414)) ([c6b6f93](https://github.com/pkcprotocol/pkc-js/commit/c6b6f93219a3d6c4e4d419c462a2e7693c1ef0c2)), closes [#413](https://github.com/pkcprotocol/pkc-js/issues/413)

## <small>0.19.112 (2026-10-21)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.119 ([f65f3b3](https://github.com/bitsocialnet/bitsocial-cli/commit/f65f3b3))
  * pkc-js [0.0.119](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.119) (2026-10-21)
    * feat(community): author profiles as a community configuration, with suggested.uiType ([#31](https://github.com/pkcprotocol/pkc-js/issues/31)) ([#268](https://github.com/pkcprotocol/pkc-js/issues/268)) ([1bd1b5c](https://github.com/pkcprotocol/pkc-js/commit/1bd1b5c4d2ab1141b03d34dbf98f0a5c80433cc9)), closes [#32](https://github.com/pkcprotocol/pkc-js/issues/32) [#237](https://github.com/pkcprotocol/pkc-js/issues/237) [#287](https://github.com/pkcprotocol/pkc-js/issues/287) [#294](https://github.com/pkcprotocol/pkc-js/issues/294) [#267](https://github.com/pkcprotocol/pkc-js/issues/267)

## <small>0.19.111 (2026-10-21)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.118 ([40c0405](https://github.com/bitsocialnet/bitsocial-cli/commit/40c0405))
  * pkc-js [0.0.118](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.118) (2026-10-20)
    * fix(challenges): name unregistered challenges and refuse to start until they load ([#429](https://github.com/pkcprotocol/pkc-js/issues/429)) ([9ddba5a](https://github.com/pkcprotocol/pkc-js/commit/9ddba5a7fb5cf86747fbe19a6e2c482bfa116212)), closes [#428](https://github.com/pkcprotocol/pkc-js/issues/428) [#428](https://github.com/pkcprotocol/pkc-js/issues/428) [#428](https://github.com/pkcprotocol/pkc-js/issues/428)
  * pkc-js [0.0.117](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.117) (2026-10-20)
    * fix(rpc): keep RPC subscriptions alive across websocket reconnects ([#425](https://github.com/pkcprotocol/pkc-js/issues/425)) ([#426](https://github.com/pkcprotocol/pkc-js/issues/426)) ([c6ef875](https://github.com/pkcprotocol/pkc-js/commit/c6ef8759f985b3830cca1a57671e8a5bea6c3fc6))
  * pkc-js [0.0.116](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.116) (2026-10-20)
    * fix(community): keep a purge and its moderation row when MFS cleanup fails ([#420](https://github.com/pkcprotocol/pkc-js/issues/420)) ([#421](https://github.com/pkcprotocol/pkc-js/issues/421)) ([3db8af3](https://github.com/pkcprotocol/pkc-js/commit/3db8af3a2bda422586e704b41945fe1c257408d8))

## <small>0.19.110 (2026-10-20)</small>

* test: handle the running community's error event and point the e2e assertions at pkc-js#429 ([af35719](https://github.com/bitsocialnet/bitsocial-cli/commit/af35719)), closes [pkc-js#429](https://github.com/pkc-js/issues/429)
* test: reproduce challenge remove deleting a package a community still uses ([4e954b7](https://github.com/bitsocialnet/bitsocial-cli/commit/4e954b7))
* fix: refuse challenge remove while a community's settings.challenges still uses the package ([9a6b6ff](https://github.com/bitsocialnet/bitsocial-cli/commit/9a6b6ff))

## <small>0.19.109 (2026-10-20)</small>

* fix: quote bracketed flags in command examples and replace the stale captcha-canvas-v3 challenge ([b165c8c](https://github.com/bitsocialnet/bitsocial-cli/commit/b165c8c))
* docs: add docs index, challenges.md and page-sorts.md, and an AGENTS.md docs lookup ([4c1d1a0](https://github.com/bitsocialnet/bitsocial-cli/commit/4c1d1a0))
* docs: quote bracketed challenge flags and scope the docs index rule to topic docs ([22d95c4](https://github.com/bitsocialnet/bitsocial-cli/commit/22d95c4))

## <small>0.19.108 (2026-10-20)</small>

* feat: show page sort sortName in list and warn when an upgrade changes it ([31e2cd0](https://github.com/bitsocialnet/bitsocial-cli/commit/31e2cd0))

## <small>0.19.107 (2026-10-20)</small>

* fix: reload replaced CommonJS package entry points instead of the cached module ([c6a9218](https://github.com/bitsocialnet/bitsocial-cli/commit/c6a9218))
* fix: validate package names and keep the auth key path in reload URLs ([79ed6e4](https://github.com/bitsocialnet/bitsocial-cli/commit/79ed6e4))
* test: cover page sort packages against a real daemon ([c4c4d27](https://github.com/bitsocialnet/bitsocial-cli/commit/c4c4d27))
* test: strip the Windows oclif wrap marker in the page-sort refusal check ([e714498](https://github.com/bitsocialnet/bitsocial-cli/commit/e714498))
* feat: add page-sort install/list/remove for pkc-js page sort packages ([f3608e0](https://github.com/bitsocialnet/bitsocial-cli/commit/f3608e0)), closes [#171](https://github.com/bitsocialnet/bitsocial-cli/issues/171)
* refactor: extract a generic package registry from challenge-utils ([6c20dda](https://github.com/bitsocialnet/bitsocial-cli/commit/6c20dda)), closes [#164](https://github.com/bitsocialnet/bitsocial-cli/issues/164)
* chore(deps): upgrade @pkcprotocol/pkc-js from 0.0.114 to 0.0.115
  * pkc-js [0.0.115](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.115) (2026-10-19)
    * feat(community): reload challenge and page sort packages in running communities ([#415](https://github.com/pkcprotocol/pkc-js/issues/415)) ([2a95dcb](https://github.com/pkcprotocol/pkc-js/commit/2a95dcb76897c17961d7dcdbbf3ef11d71ca56eb))
    * fix(community): stop a failing exchange rolling back another exchange's insert ([#417](https://github.com/pkcprotocol/pkc-js/issues/417)) ([#419](https://github.com/pkcprotocol/pkc-js/issues/419)) ([9571e37](https://github.com/pkcprotocol/pkc-js/commit/9571e3732edc827143e000464410c2cc61a8dfc9)), closes [#387](https://github.com/pkcprotocol/pkc-js/issues/387) [#387](https://github.com/pkcprotocol/pkc-js/issues/387)
    * fix(pubsub): retry and fall back when a pubsub subscribe fails to connect ([#422](https://github.com/pkcprotocol/pkc-js/issues/422)) ([#423](https://github.com/pkcprotocol/pkc-js/issues/423)) ([74f5b83](https://github.com/pkcprotocol/pkc-js/commit/74f5b83f76b1ad147dccfdb9af930428cc55ea99))

## <small>0.19.106 (2026-10-19)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.114 ([2e4e018](https://github.com/bitsocialnet/bitsocial-cli/commit/2e4e018))
  * pkc-js [0.0.114](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.114) (2026-10-18)
    * fix(ci): run one release at a time so overlapping runs cannot publish the same version ([c036a2e](https://github.com/pkcprotocol/pkc-js/commit/c036a2e41b10216b4259384c9ba142bb0a6fb6fc)), closes [#408](https://github.com/pkcprotocol/pkc-js/issues/408)
    * fix(release): publish the [#408](https://github.com/pkcprotocol/pkc-js/issues/408) tombstone fix as 0.0.114 ([f2d0229](https://github.com/pkcprotocol/pkc-js/commit/f2d02295b94b72a8c515f8bf0bd10764b7086141))
  * pkc-js [0.0.113](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.113) (2026-10-18)
    * fix(community): skip removed/deleted replies in reply counts and bumps, keep the replies under them ([#404](https://github.com/pkcprotocol/pkc-js/issues/404)) ([29e0206](https://github.com/pkcprotocol/pkc-js/commit/29e020614277af10fb047f73cc3311cb4472f2ed)), closes [#403](https://github.com/pkcprotocol/pkc-js/issues/403) [#403](https://github.com/pkcprotocol/pkc-js/issues/403) [#405](https://github.com/pkcprotocol/pkc-js/issues/405) [#405](https://github.com/pkcprotocol/pkc-js/issues/405) [#403](https://github.com/pkcprotocol/pkc-js/issues/403) [#405](https://github.com/pkcprotocol/pkc-js/issues/405)
    * fix(pages): pass tombstone replies to requireReplies page sorts ([#408](https://github.com/pkcprotocol/pkc-js/issues/408)) ([0ac709c](https://github.com/pkcprotocol/pkc-js/commit/0ac709c8f07cded5d71290f88ced4c9c565ad6bd)), closes [#407](https://github.com/pkcprotocol/pkc-js/issues/407) [#407](https://github.com/pkcprotocol/pkc-js/issues/407) [#407](https://github.com/pkcprotocol/pkc-js/issues/407) [#407](https://github.com/pkcprotocol/pkc-js/issues/407)
  * pkc-js [0.0.112](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.112) (2026-10-18)
    * fix(types): let a page entry pass as PageSortReplyEntry under exactOptionalPropertyTypes ([470b742](https://github.com/pkcprotocol/pkc-js/commit/470b74295ec99d9ae2049c5c79e003146a07c7eb)), closes [#402](https://github.com/pkcprotocol/pkc-js/issues/402)
  * pkc-js [0.0.111](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.111) (2026-10-18)
    * fix(community): give an author's concurrent publications one pseudonymity alias ([#399](https://github.com/pkcprotocol/pkc-js/issues/399)) ([#400](https://github.com/pkcprotocol/pkc-js/issues/400)) ([df73eec](https://github.com/pkcprotocol/pkc-js/commit/df73eece358e19e37ac2509db3d444afd0112b65))

## <small>0.19.105 (2026-10-17)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.110 ([695f9fd](https://github.com/bitsocialnet/bitsocial-cli/commit/695f9fd))
  * pkc-js [0.0.110](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.110) (2026-10-17)
    * feat(types): export page sort settings entry and score argument types ([#397](https://github.com/pkcprotocol/pkc-js/issues/397)) ([#398](https://github.com/pkcprotocol/pkc-js/issues/398)) ([3f35c22](https://github.com/pkcprotocol/pkc-js/commit/3f35c22c1822094dc5df082e98b76f3a3a6fcc2e))
  * pkc-js [0.0.109](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.109) (2026-10-16)
    * fix(clients): decode streamed gateway bodies with stream:true to keep split multi-byte chars ([#395](https://github.com/pkcprotocol/pkc-js/issues/395)) ([#396](https://github.com/pkcprotocol/pkc-js/issues/396)) ([fba1c51](https://github.com/pkcprotocol/pkc-js/commit/fba1c5143a4aa25f9f1939094671a4fe8df7f54b)), closes [#321](https://github.com/pkcprotocol/pkc-js/issues/321)
  * pkc-js [0.0.108](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.108) (2026-10-16)
    * feat(community): configurable page sorts via settings.pages ([#73](https://github.com/pkcprotocol/pkc-js/issues/73)) ([#346](https://github.com/pkcprotocol/pkc-js/issues/346)) ([6882fa2](https://github.com/pkcprotocol/pkc-js/commit/6882fa286c1eeb71bd1ac3d8f93ff2e56ad641fe)), closes [#348](https://github.com/pkcprotocol/pkc-js/issues/348) [#351](https://github.com/pkcprotocol/pkc-js/issues/351) [#351](https://github.com/pkcprotocol/pkc-js/issues/351) [#352](https://github.com/pkcprotocol/pkc-js/issues/352) [#352](https://github.com/pkcprotocol/pkc-js/issues/352) [#355](https://github.com/pkcprotocol/pkc-js/issues/355) [#355](https://github.com/pkcprotocol/pkc-js/issues/355) [#355](https://github.com/pkcprotocol/pkc-js/issues/355) [#142](https://github.com/pkcprotocol/pkc-js/issues/142) [#304](https://github.com/pkcprotocol/pkc-js/issues/304) [#355](https://github.com/pkcprotocol/pkc-js/issues/355) [#355](https://github.com/pkcprotocol/pkc-js/issues/355) [#355](https://github.com/pkcprotocol/pkc-js/issues/355) [#359](https://github.com/pkcprotocol/pkc-js/issues/359) [#359](https://github.com/pkcprotocol/pkc-js/issues/359) [#351](https://github.com/pkcprotocol/pkc-js/issues/351) [#386](https://github.com/pkcprotocol/pkc-js/issues/386) [#387](https://github.com/pkcprotocol/pkc-js/issues/387) [#386](https://github.com/pkcprotocol/pkc-js/issues/386) [#386](https://github.com/pkcprotocol/pkc-js/issues/386) [#389](https://github.com/pkcprotocol/pkc-js/issues/389) [#389](https://github.com/pkcprotocol/pkc-js/issues/389) [#389](https://github.com/pkcprotocol/pkc-js/issues/389) [#352](https://github.com/pkcprotocol/pkc-js/issues/352) [#352](https://github.com/pkcprotocol/pkc-js/issues/352)
    * fix(helia): keep the newest IPNS record under concurrent local store writes ([#321](https://github.com/pkcprotocol/pkc-js/issues/321)) ([#394](https://github.com/pkcprotocol/pkc-js/issues/394)) ([2f5aa9f](https://github.com/pkcprotocol/pkc-js/commit/2f5aa9fdae5051c6a50a984774d62d18159860e9))
  * pkc-js [0.0.107](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.107) (2026-10-16)
    * feat(helia): report ERR_COMMUNITY_UNREACHABLE_FROM_THIS_CLIENT for relay-only providers ([#377](https://github.com/pkcprotocol/pkc-js/issues/377)) ([#392](https://github.com/pkcprotocol/pkc-js/issues/392)) ([494ed7c](https://github.com/pkcprotocol/pkc-js/commit/494ed7ceca6535a2939611cbb25d452a076b9cf1)), closes [#215](https://github.com/pkcprotocol/pkc-js/issues/215)
    * fix(rpc): emit updatingstatechange for succeeded, failed and waiting-retry over RPC ([#364](https://github.com/pkcprotocol/pkc-js/issues/364)) ([#393](https://github.com/pkcprotocol/pkc-js/issues/393)) ([41a38c9](https://github.com/pkcprotocol/pkc-js/commit/41a38c94fdda0ee6ee7ff9248afcf4199801a32a))

## <small>0.19.104 (2026-10-16)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.106 ([0b41c7c](https://github.com/bitsocialnet/bitsocial-cli/commit/0b41c7c))
  * pkc-js [0.0.106](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.106) (2026-10-16)
    * fix(community): reject publications it cannot store verbatim instead of freezing the board ([#387](https://github.com/pkcprotocol/pkc-js/issues/387)) ([#388](https://github.com/pkcprotocol/pkc-js/issues/388)) ([a679a36](https://github.com/pkcprotocol/pkc-js/commit/a679a36f0fb3f0012f9035c54c9cd55675ed8d49))

## <small>0.19.103 (2026-10-14)</small>

* docs(changelog): backfill pkc-js changes under every past pkc-js upgrade ([1b31f86](https://github.com/bitsocialnet/bitsocial-cli/commit/1b31f86))
* docs(changelog): list the pkc-js 0.0.104 and 0.0.105 changes under the 0.19.101 upgrade ([8f7b3ed](https://github.com/bitsocialnet/bitsocial-cli/commit/8f7b3ed))
* fix(release): attach pkc-js changes to the upgrade bullet, not any bullet mentioning pkc-js ([2a87cfe](https://github.com/bitsocialnet/bitsocial-cli/commit/2a87cfe))
* feat(release): nest the pkc-js changelog under pkc-js upgrade bullets in release notes ([8917c0f](https://github.com/bitsocialnet/bitsocial-cli/commit/8917c0f))

## <small>0.19.102 (2026-10-14)</small>

* fix(community): stop a community the daemon is running in `community stop` ([d679efb](https://github.com/bitsocialnet/bitsocial-cli/commit/d679efb)), closes [#153](https://github.com/bitsocialnet/bitsocial-cli/issues/153)
* test(community): reproduce `community stop` leaving a daemon-started community running ([2e29b6a](https://github.com/bitsocialnet/bitsocial-cli/commit/2e29b6a))

## <small>0.19.101 (2026-10-14)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.105 ([d359769](https://github.com/bitsocialnet/bitsocial-cli/commit/d359769))
  * pkc-js [0.0.105](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.105) (2026-10-14)
    * fix(community): retry IPNS resolve on undici connect timeout instead of stopping updates ([#384](https://github.com/pkcprotocol/pkc-js/issues/384)) ([#385](https://github.com/pkcprotocol/pkc-js/issues/385)) ([bc7fd42](https://github.com/pkcprotocol/pkc-js/commit/bc7fd4254e92fa561ef921cd42e9c62bbf39c81c)), closes [#265](https://github.com/pkcprotocol/pkc-js/issues/265) [#383](https://github.com/pkcprotocol/pkc-js/issues/383) [#346](https://github.com/pkcprotocol/pkc-js/issues/346) [#383](https://github.com/pkcprotocol/pkc-js/issues/383) [#265](https://github.com/pkcprotocol/pkc-js/issues/265) [#265](https://github.com/pkcprotocol/pkc-js/issues/265)
    * fix(node): stop listCommunitiesSync leaking an fd per directory under communities/ ([#382](https://github.com/pkcprotocol/pkc-js/issues/382)) ([ab2f3be](https://github.com/pkcprotocol/pkc-js/commit/ab2f3be3ca6011251d51f4c1da165c3df55943c1)), closes [#380](https://github.com/pkcprotocol/pkc-js/issues/380) [#380](https://github.com/pkcprotocol/pkc-js/issues/380)
  * pkc-js [0.0.104](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.104) (2026-10-11)
    * fix(community): report why an author name could not be verified, not a silent non-match ([#358](https://github.com/pkcprotocol/pkc-js/issues/358)) ([f35bff0](https://github.com/pkcprotocol/pkc-js/commit/f35bff09eb3f6c49cb374d160442cd92dc29706a)), closes [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#354](https://github.com/pkcprotocol/pkc-js/issues/354) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#354](https://github.com/pkcprotocol/pkc-js/issues/354) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#353](https://github.com/pkcprotocol/pkc-js/issues/353) [#353](https://github.com/pkcprotocol/pkc-js/issues/353)

## <small>0.19.100 (2026-10-14)</small>

* chore(deps): upgrade husky to 9.1.7 ([b8feb2f](https://github.com/bitsocialnet/bitsocial-cli/commit/b8feb2f))
* fix(challenge): locate the npm pack tarball on disk instead of parsing stdout ([cf61121](https://github.com/bitsocialnet/bitsocial-cli/commit/cf61121))
* fix(prepare): install husky hooks in git worktrees ([31d33af](https://github.com/bitsocialnet/bitsocial-cli/commit/31d33af))
* test(prepare): isolate the husky test from the developer's git environment ([49c8f99](https://github.com/bitsocialnet/bitsocial-cli/commit/49c8f99))

## <small>0.19.99 (2026-10-11)</small>

* chore(brand): refresh Bitsocial logo colors ([ea26887](https://github.com/bitsocialnet/bitsocial-cli/commit/ea26887))
* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.103 and kubo to 0.43.1 ([92a513d](https://github.com/bitsocialnet/bitsocial-cli/commit/92a513d)), closes [ipfs/kubo#11447](https://github.com/ipfs/kubo/issues/11447)
  * pkc-js [0.0.103](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.103) (2026-10-11)
    * fix(community): make CommunityEdit.name owner-only like the legacy address field ([#374](https://github.com/pkcprotocol/pkc-js/issues/374)) ([2855535](https://github.com/pkcprotocol/pkc-js/commit/2855535028dcd02ab48ff944d6402ea0c5921c8d)), closes [#373](https://github.com/pkcprotocol/pkc-js/issues/373) [#373](https://github.com/pkcprotocol/pkc-js/issues/373)
  * pkc-js [0.0.102](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.102) (2026-10-11)
    * feat(community): add features.noArchive to block archiving posts ([#366](https://github.com/pkcprotocol/pkc-js/issues/366)) ([c088cd2](https://github.com/pkcprotocol/pkc-js/commit/c088cd299d947d1c5efc9d456769c5f09db70c1e))
  * pkc-js [0.0.101](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.101) (2026-09-08)
    * fix(community): bind excludes, roles and address lists to the signer and drop exclude.address ([#294](https://github.com/pkcprotocol/pkc-js/issues/294)) ([1c8fb8e](https://github.com/pkcprotocol/pkc-js/commit/1c8fb8e09e05b1429b6411641b3bbf00ed44c371)), closes [#295](https://github.com/pkcprotocol/pkc-js/issues/295) [#333](https://github.com/pkcprotocol/pkc-js/issues/333)
  * pkc-js [0.0.100](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.100) (2026-09-07)
    * fix(publication): drop duplicate challenge deliveries and reject a second challenge answer ([#349](https://github.com/pkcprotocol/pkc-js/issues/349)) ([#350](https://github.com/pkcprotocol/pkc-js/issues/350)) ([2522fae](https://github.com/pkcprotocol/pkc-js/commit/2522fae41550c5bc7508f995d5d0893bfe727b64)), closes [#340](https://github.com/pkcprotocol/pkc-js/issues/340)
    * perf(community): pace gateway polls on max-age, fix If-None-Match, publish 20s record ttl ([#338](https://github.com/pkcprotocol/pkc-js/issues/338)) ([bdec5c3](https://github.com/pkcprotocol/pkc-js/commit/bdec5c3f1d079afda8cb402505b70276d1cda096)), closes [#328](https://github.com/pkcprotocol/pkc-js/issues/328) [#328](https://github.com/pkcprotocol/pkc-js/issues/328) [#328](https://github.com/pkcprotocol/pkc-js/issues/328) [#328](https://github.com/pkcprotocol/pkc-js/issues/328)

## <small>0.19.98 (2026-09-16)</small>

* docs: point the community edit web UI hint at bitsocial.net/projects ([cb36821](https://github.com/bitsocialnet/bitsocial-cli/commit/cb36821))

## <small>0.19.97 (2026-09-06)</small>

* chore: upgrade @pkcprotocol/pkc-js from 0.0.89 to 0.0.99 ([46546c5](https://github.com/bitsocialnet/bitsocial-cli/commit/46546c5))
  * pkc-js [0.0.99](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.99) (2026-09-06)
    * fix: answer overlapping challenge requests once and keep a challenged exchange alive ([#228](https://github.com/pkcprotocol/pkc-js/issues/228) [#340](https://github.com/pkcprotocol/pkc-js/issues/340)) ([#341](https://github.com/pkcprotocol/pkc-js/issues/341)) ([5556ae3](https://github.com/pkcprotocol/pkc-js/commit/5556ae34a6dfac473fe13597386e43ad5942d240))
    * fix(helia): end in-flight block fetches on caller abort and pkc.destroy() ([#345](https://github.com/pkcprotocol/pkc-js/issues/345)) ([77d0e5a](https://github.com/pkcprotocol/pkc-js/commit/77d0e5abe42fb192e721df2f8e9f1b346e7c953b)), closes [#325](https://github.com/pkcprotocol/pkc-js/issues/325)
  * pkc-js [0.0.98](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.98) (2026-09-04)
    * fix(community): wake the publish loop on votes, comment edits and mod-queue comments ([#333](https://github.com/pkcprotocol/pkc-js/issues/333)) ([7963bfd](https://github.com/pkcprotocol/pkc-js/commit/7963bfd547e795e5e7df44b75177f05be74eb4dd)), closes [#226](https://github.com/pkcprotocol/pkc-js/issues/226) [#334](https://github.com/pkcprotocol/pkc-js/issues/334) [#335](https://github.com/pkcprotocol/pkc-js/issues/335) [#226](https://github.com/pkcprotocol/pkc-js/issues/226)
  * pkc-js [0.0.97](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.97) (2026-09-04)
    * fix(community): flush the pre-purge update cid even when the purge lands mid-publish-cycle ([#336](https://github.com/pkcprotocol/pkc-js/issues/336)) ([#337](https://github.com/pkcprotocol/pkc-js/issues/337)) ([60963d5](https://github.com/pkcprotocol/pkc-js/commit/60963d502ad5178c9615ba7ac5dbb060d9675713)), closes [#305](https://github.com/pkcprotocol/pkc-js/issues/305)
  * pkc-js [0.0.96](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.96) (2026-09-03)
    * fix(community): announce key migration to joiners attaching in the recordless window ([#323](https://github.com/pkcprotocol/pkc-js/issues/323) [#332](https://github.com/pkcprotocol/pkc-js/issues/332)) ([#327](https://github.com/pkcprotocol/pkc-js/issues/327)) ([6232a2f](https://github.com/pkcprotocol/pkc-js/commit/6232a2fe7f501c8b60e38b9495deaaf8a1ffca08))
  * pkc-js [0.0.95](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.95) (2026-09-03)
    * perf(helia): serve subscribed IPNS names from cache while the push channel is healthy ([#330](https://github.com/pkcprotocol/pkc-js/issues/330)) ([#331](https://github.com/pkcprotocol/pkc-js/issues/331)) ([0125580](https://github.com/pkcprotocol/pkc-js/commit/012558033e786d2d546ec7f5f5971e0474257a99)), closes [#329](https://github.com/pkcprotocol/pkc-js/issues/329) [#329](https://github.com/pkcprotocol/pkc-js/issues/329) [#329](https://github.com/pkcprotocol/pkc-js/issues/329) [301/#307](https://github.com/301/pkc-js/issues/307) [308/#311](https://github.com/308/pkc-js/issues/311) [#311](https://github.com/pkcprotocol/pkc-js/issues/311)
  * pkc-js [0.0.94](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.94) (2026-09-03)
    * fix(rpc): make client and server destroy() wait for their websockets to close ([#326](https://github.com/pkcprotocol/pkc-js/issues/326)) ([8af4868](https://github.com/pkcprotocol/pkc-js/commit/8af4868e75ca84627291036dc2007fe9b3b97176)), closes [#325](https://github.com/pkcprotocol/pkc-js/issues/325)
    * perf(community): drive kubo/helia updates from gossip pushes instead of a 1s poll ([#308](https://github.com/pkcprotocol/pkc-js/issues/308) [#307](https://github.com/pkcprotocol/pkc-js/issues/307)) ([#311](https://github.com/pkcprotocol/pkc-js/issues/311)) ([bf7aedb](https://github.com/pkcprotocol/pkc-js/commit/bf7aedbe6e4038d9f937f0ead66b186519551f55)), closes [#312](https://github.com/pkcprotocol/pkc-js/issues/312) [#312](https://github.com/pkcprotocol/pkc-js/issues/312) [#312](https://github.com/pkcprotocol/pkc-js/issues/312) [#312](https://github.com/pkcprotocol/pkc-js/issues/312) [#312](https://github.com/pkcprotocol/pkc-js/issues/312) [#145](https://github.com/pkcprotocol/pkc-js/issues/145) [#138](https://github.com/pkcprotocol/pkc-js/issues/138) [#312](https://github.com/pkcprotocol/pkc-js/issues/312) [#312](https://github.com/pkcprotocol/pkc-js/issues/312)
  * pkc-js [0.0.93](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.93) (2026-09-02)
    * fix(rpc): deliver subscribe-time errors to late listeners across update, publish, and start ([#299](https://github.com/pkcprotocol/pkc-js/issues/299)) ([#313](https://github.com/pkcprotocol/pkc-js/issues/313)) ([eff51d0](https://github.com/pkcprotocol/pkc-js/commit/eff51d08705d74f45957b007f62b5706d16d5576)), closes [#314](https://github.com/pkcprotocol/pkc-js/issues/314) [#314](https://github.com/pkcprotocol/pkc-js/issues/314) [#314](https://github.com/pkcprotocol/pkc-js/issues/314) [#314](https://github.com/pkcprotocol/pkc-js/issues/314) [#316](https://github.com/pkcprotocol/pkc-js/issues/316) [#315](https://github.com/pkcprotocol/pkc-js/issues/315) [#316](https://github.com/pkcprotocol/pkc-js/issues/316)
  * pkc-js [0.0.92](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.92) (2026-09-01)
    * fix(community): defer unpinning superseded cids so repo.gc cannot race clients still fetching them ([#306](https://github.com/pkcprotocol/pkc-js/issues/306)) ([871703c](https://github.com/pkcprotocol/pkc-js/commit/871703c2a3294228582b15cf08e3d0fa6c6dc653)), closes [#305](https://github.com/pkcprotocol/pkc-js/issues/305)
  * pkc-js [0.0.91](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.91) (2026-08-31)
    * fix(community): rm purged post's postUpdates MFS entry when the purge lands mid-sync ([#304](https://github.com/pkcprotocol/pkc-js/issues/304)) ([#303](https://github.com/pkcprotocol/pkc-js/issues/303)) ([5f06b97](https://github.com/pkcprotocol/pkc-js/commit/5f06b971aa3e5f248a42eec5013c16864fb2374a)), closes [#253](https://github.com/pkcprotocol/pkc-js/issues/253) [#142](https://github.com/pkcprotocol/pkc-js/issues/142)
  * pkc-js [0.0.90](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.90) (2026-08-31)
    * perf(helia): serve repeat IPNS resolves from the gossip-fed record cache, not a refetch ([#301](https://github.com/pkcprotocol/pkc-js/issues/301)) ([#302](https://github.com/pkcprotocol/pkc-js/issues/302)) ([18432cd](https://github.com/pkcprotocol/pkc-js/commit/18432cd5c5fe13ae7982a8ad31d7ed08ae06ebfe))

## <small>0.19.96 (2026-09-02)</small>

* fix: pre-seed kubo Routing config so pkc-js init does not restart kubo ([65f3c58](https://github.com/bitsocialnet/bitsocial-cli/commit/65f3c58))
* docs: require Closes #N in PR bodies so issues auto-close on merge ([776daaa](https://github.com/bitsocialnet/bitsocial-cli/commit/776daaa)), closes [#N](https://github.com/bitsocialnet/bitsocial-cli/issues/N)

## <small>0.19.95 (2026-08-31)</small>

* test: surface diagnostics when a completion-time command times out (#140) ([c4c40e5](https://github.com/bitsocialnet/bitsocial-cli/commit/c4c40e5)), closes [#140](https://github.com/bitsocialnet/bitsocial-cli/issues/140)
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.85 -> 0.0.89 ([a639363](https://github.com/bitsocialnet/bitsocial-cli/commit/a639363))
  * pkc-js [0.0.89](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.89) (2026-08-30)
    * fix(deps): upgrade helia to v7 and bump libp2p/ipfs ecosystem deps ([#293](https://github.com/pkcprotocol/pkc-js/issues/293)) ([e533cf9](https://github.com/pkcprotocol/pkc-js/commit/e533cf9ebd662340e8cd2b882f1b69217168dd42)), closes [#292](https://github.com/pkcprotocol/pkc-js/issues/292)
  * pkc-js [0.0.88](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.88) (2026-08-26)
    * fix(community): make statsCid optional on CommunityIpfsSchema ([#298](https://github.com/pkcprotocol/pkc-js/issues/298)) ([2aa45bf](https://github.com/pkcprotocol/pkc-js/commit/2aa45bf17d2e10c68ce6d021cd86aed5e10ffe2d)), closes [#297](https://github.com/pkcprotocol/pkc-js/issues/297)
    * build(ci): make the PR title releasable-commit check runnable locally ([#296](https://github.com/pkcprotocol/pkc-js/issues/296)) ([e5c3cef](https://github.com/pkcprotocol/pkc-js/commit/e5c3cef06b27b15568c55d8a45c8e6a06b057191))
  * pkc-js [0.0.87](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.87) (2026-08-26)
    * BREAKING CHANGE(deps): in gossipsub 17.0.0: maxTopicBytesPerPeer bounds the
    * chore(deps): upgrade @libp2p/gossipsub to 17.0.0 and dedupe the libp2p tree ([#279](https://github.com/pkcprotocol/pkc-js/issues/279)) ([38d3a1f](https://github.com/pkcprotocol/pkc-js/commit/38d3a1f394cbdcbb009908860f3705cc9750154e))
    * fix(community): await the source db removal in delete() instead of a fire-and-forget rm ([#291](https://github.com/pkcprotocol/pkc-js/issues/291)) ([812a5fa](https://github.com/pkcprotocol/pkc-js/commit/812a5fa93c53ff78d67ff4eee393598041a0f060))
    * fix(community): scope the process-wide started-community registry by dataPath ([#280](https://github.com/pkcprotocol/pkc-js/issues/280)) ([43f9b92](https://github.com/pkcprotocol/pkc-js/commit/43f9b9257d8fcc43aa6cbd204048af66e18a4bc7)), closes [#238](https://github.com/pkcprotocol/pkc-js/issues/238)
    * fix(release): force patch version bumps and ignore the conventional recommended bump ([990a2a0](https://github.com/pkcprotocol/pkc-js/commit/990a2a0ad3359aab6fc0c1b499da65a2bca75058)), closes [#279](https://github.com/pkcprotocol/pkc-js/issues/279)
    * revert: Revert "chore(release): 0.1.0 [skip ci]" ([6a8b23b](https://github.com/pkcprotocol/pkc-js/commit/6a8b23b96390ff6239741216911c219fdcc9f6e6))
    * revert: Revert "chore(release): 0.2.0 [skip ci]" ([7ab90bc](https://github.com/pkcprotocol/pkc-js/commit/7ab90bcd411c477e9b56c6d77506bce9ef1be729))
  * pkc-js [0.0.86](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.86) (2026-08-22)
    * fix(community): announce key migration to late joiners and survive update() after a migration ([#289](https://github.com/pkcprotocol/pkc-js/issues/289)) ([af8a7b7](https://github.com/pkcprotocol/pkc-js/commit/af8a7b71ec53e380e18e7da259cf052e03304ee9)), closes [#129](https://github.com/pkcprotocol/pkc-js/issues/129) [#119](https://github.com/pkcprotocol/pkc-js/issues/119) [#197](https://github.com/pkcprotocol/pkc-js/issues/197)

## <small>0.19.94 (2026-08-22)</small>

* ci: install the packed tarball to the fast volume on windows (#136) ([a2231d0](https://github.com/bitsocialnet/bitsocial-cli/commit/a2231d0)), closes [#136](https://github.com/bitsocialnet/bitsocial-cli/issues/136)

## <small>0.19.93 (2026-08-21)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.83 -> 0.0.85 ([f4eeb66](https://github.com/bitsocialnet/bitsocial-cli/commit/f4eeb66))
  * pkc-js [0.0.85](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.85) (2026-08-21)
    * feat(challenges): add validateChallengeSettings and core optionInputs validation ([#283](https://github.com/pkcprotocol/pkc-js/issues/283)) ([#288](https://github.com/pkcprotocol/pkc-js/issues/288)) ([d902872](https://github.com/pkcprotocol/pkc-js/commit/d9028724e21cc29c98bb4c360ccbd894f3422476))
    * feat(challenges): publish opt-in public challenge options in the community record ([#282](https://github.com/pkcprotocol/pkc-js/issues/282)) ([#287](https://github.com/pkcprotocol/pkc-js/issues/287)) ([01e1b2f](https://github.com/pkcprotocol/pkc-js/commit/01e1b2fcfae128efa62438e5d3a5370f13d2f6fd))
    * upgrade note: An `edit()` carrying an undeclared option key, a missing `required` option, or an undeclared `publicOptions` entry now **throws** instead of saving. Failures are aggregated across every challenge into one `PKCError` with code `ERR_CHALLENGE_SETTINGS_VALIDATION_FAILED_FOR_CHALLENGES`, whose `details.failures` is `{challengeIndex, challengeName, error}[]`.
    * upgrade note: A community that already has such config persisted emits one `error` event per invalid challenge **on every start**, carrying `{challengeIndex, challengeName, communityAddress}`. The community still starts: a persisted bad config never takes startup down.
  * pkc-js [0.0.84](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.84) (2026-08-20)
    * feat(pkc): cancel in-flight community fetches via abortSignal, publication.stop() and destroy() ([#276](https://github.com/pkcprotocol/pkc-js/issues/276)) ([6aa14f3](https://github.com/pkcprotocol/pkc-js/commit/6aa14f31d52ddb89e1b007d2415ed9d5497d409c)), closes [#275](https://github.com/pkcprotocol/pkc-js/issues/275) [#196](https://github.com/pkcprotocol/pkc-js/issues/196) [#277](https://github.com/pkcprotocol/pkc-js/issues/277) [#145](https://github.com/pkcprotocol/pkc-js/issues/145) [#146](https://github.com/pkcprotocol/pkc-js/issues/146) [#278](https://github.com/pkcprotocol/pkc-js/issues/278)
* docs(changelog): warn to back up community DBs before the 0.19.92 migration ([5810493](https://github.com/bitsocialnet/bitsocial-cli/commit/5810493))

## <small>0.19.92 (2026-08-17)</small>

> [!WARNING]
> **Back up your community databases before upgrading.** This release permanently deletes old comments that fail current signature validation.
>
> The pkc-js 0.0.83 bump makes community databases that predate the latest schema loadable again. Loading them lets the pending schema migration finally run, and that migration includes a validation pass that **deletes** any comment failing today's signature rules. On databases that had been stuck unmigrated, this pass runs for the first time.
>
> **What gets deleted:** comments signed before 2024-11-01 by old clients that set `protocolVersion` on the record without including it in `signature.signedPropertyNames`. Each one is removed along with its replies. On one production node this deleted 1264 comments plus their cascaded replies across 12 communities, with two small archive-only communities losing nearly all of their history.
>
> **What is safe:** anything signed on or after 2024-11-01. Since that point `signedPropertyNames` has always included `protocolVersion`, so no recent or active content is affected.
>
> **Back up first,** with the daemon stopped so the files are quiescent:
>
> ```sh
> systemctl stop bitsocial     # or however you run the daemon
> cp -a ~/.local/share/bitsocial/communities ~/bitsocial-communities-backup
> ```
>
> The migration does write its own copy to `communities/.backup_before_migration/`, but that copy is **deleted as soon as the migration succeeds**, so it is not a substitute for your own backup.

* test(daemon): poll waitForKuboReady instead of a one-shot fetch in the KUBO_RPC_URL test ([2612210](https://github.com/bitsocialnet/bitsocial-cli/commit/2612210)), closes [#95](https://github.com/bitsocialnet/bitsocial-cli/issues/95) [#133](https://github.com/bitsocialnet/bitsocial-cli/issues/133)
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.82 -> 0.0.83 ([c5d59ad](https://github.com/bitsocialnet/bitsocial-cli/commit/c5d59ad))
  * pkc-js [0.0.83](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.83) (2026-08-17)
    * fix(community): load communities whose DB predates the latest schema ([#273](https://github.com/pkcprotocol/pkc-js/issues/273)) ([#274](https://github.com/pkcprotocol/pkc-js/issues/274)) ([7c03d75](https://github.com/pkcprotocol/pkc-js/commit/7c03d7583dc9d3225127cc18d41971088d108c0f))

## <small>0.19.91 (2026-08-17)</small>

* test(daemon-state): isolate the states dir so a parallel daemon's prune can't delete test files ([11da835](https://github.com/bitsocialnet/bitsocial-cli/commit/11da835)), closes [#130](https://github.com/bitsocialnet/bitsocial-cli/issues/130)
* test(daemon): retry the bind race when the CLI's own port guard fires (issue #128) ([5efb310](https://github.com/bitsocialnet/bitsocial-cli/commit/5efb310)), closes [#128](https://github.com/bitsocialnet/bitsocial-cli/issues/128)

## <small>0.19.90 (2026-08-17)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.81 -> 0.0.82 ([a6e1794](https://github.com/bitsocialnet/bitsocial-cli/commit/a6e1794))
  * pkc-js [0.0.82](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.82) (2026-08-17)
    * feat(crosspost): embed the reposted comment in comment.crosspost ([#32](https://github.com/pkcprotocol/pkc-js/issues/32)) ([#248](https://github.com/pkcprotocol/pkc-js/issues/248)) ([8d7cd4c](https://github.com/pkcprotocol/pkc-js/commit/8d7cd4c9a1fc3fbc29bc374d09113e4631e7580f)), closes [#249](https://github.com/pkcprotocol/pkc-js/issues/249) [#249](https://github.com/pkcprotocol/pkc-js/issues/249) [#251](https://github.com/pkcprotocol/pkc-js/issues/251) [#254](https://github.com/pkcprotocol/pkc-js/issues/254) [#249](https://github.com/pkcprotocol/pkc-js/issues/249) [#249](https://github.com/pkcprotocol/pkc-js/issues/249) [#250](https://github.com/pkcprotocol/pkc-js/issues/250) [#255](https://github.com/pkcprotocol/pkc-js/issues/255) [#249](https://github.com/pkcprotocol/pkc-js/issues/249) [#250](https://github.com/pkcprotocol/pkc-js/issues/250) [#249](https://github.com/pkcprotocol/pkc-js/issues/249) [#251](https://github.com/pkcprotocol/pkc-js/issues/251) [#250](https://github.com/pkcprotocol/pkc-js/issues/250) [#251](https://github.com/pkcprotocol/pkc-js/issues/251) [#251](https://github.com/pkcprotocol/pkc-js/issues/251) [#250](https://github.com/pkcprotocol/pkc-js/issues/250)
    * fix(pkc): stop in-flight publications in destroy() and drain their background community refresh ([#271](https://github.com/pkcprotocol/pkc-js/issues/271)) ([ddd8bfe](https://github.com/pkcprotocol/pkc-js/commit/ddd8bfedc93d67446b67f665b06dfc9a991861af)), closes [#270](https://github.com/pkcprotocol/pkc-js/issues/270)

## <small>0.19.89 (2026-08-14)</small>

* fix(challenge): close two holes in the content key, assert test readiness ([fec6a31](https://github.com/bitsocialnet/bitsocial-cli/commit/fec6a31))
* fix(challenge): reload replaced challenge packages instead of cached ESM modules ([4e59472](https://github.com/bitsocialnet/bitsocial-cli/commit/4e59472))
* fix(challenge): reload the daemon that actually serves the data path, not localhost:9138 ([6f37b98](https://github.com/bitsocialnet/bitsocial-cli/commit/6f37b98)), closes [#124](https://github.com/bitsocialnet/bitsocial-cli/issues/124)
* fix(challenge): target the reload at --pkcRpcUrl instead of a hardcoded url ([d88c2bc](https://github.com/bitsocialnet/bitsocial-cli/commit/d88c2bc)), closes [#124](https://github.com/bitsocialnet/bitsocial-cli/issues/124)
* fix(challenge): unregister removed challenges and bound the reload request ([cd12cd2](https://github.com/bitsocialnet/bitsocial-cli/commit/cd12cd2))
* test(challenge): reproduce stale ESM module after same-name upgrade (#124) ([0237f02](https://github.com/bitsocialnet/bitsocial-cli/commit/0237f02)), closes [#124](https://github.com/bitsocialnet/bitsocial-cli/issues/124)
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.77 -> 0.0.81 ([1cc8952](https://github.com/bitsocialnet/bitsocial-cli/commit/1cc8952)), closes [#256](https://github.com/bitsocialnet/bitsocial-cli/issues/256) [#259](https://github.com/bitsocialnet/bitsocial-cli/issues/259) [#260](https://github.com/bitsocialnet/bitsocial-cli/issues/260) [#263](https://github.com/bitsocialnet/bitsocial-cli/issues/263)
  * pkc-js [0.0.81](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.81) (2026-08-13)
    * fix(kubo): pin the pubsub topic block in the block.put call so a repo gc cannot delete it ([888da96](https://github.com/pkcprotocol/pkc-js/commit/888da9648304ab1f46008dd976a9beac628f4c0a))
    * fix(kubo): remove the address rewriter proxy that now degrades provider records ([#263](https://github.com/pkcprotocol/pkc-js/issues/263)) ([08ca094](https://github.com/pkcprotocol/pkc-js/commit/08ca094dd7537039c0ac9b043c0539bda27dc7ee)), closes [#262](https://github.com/pkcprotocol/pkc-js/issues/262) [ipfs/kubo#11394](https://github.com/ipfs/kubo/issues/11394) [ipfs/kubo#11369](https://github.com/ipfs/kubo/issues/11369) [kubo#11369](https://github.com/pkcprotocol/kubo/issues/11369)
  * pkc-js [0.0.80](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.80) (2026-08-12)
    * feat(community): delegated records advertise their anchor; claim-first nameResolved ([#260](https://github.com/pkcprotocol/pkc-js/issues/260)) ([8ba6cb5](https://github.com/pkcprotocol/pkc-js/commit/8ba6cb5e0e117108884c694c4ff31febad5b9d37)), closes [#257](https://github.com/pkcprotocol/pkc-js/issues/257) [#257](https://github.com/pkcprotocol/pkc-js/issues/257) [#257](https://github.com/pkcprotocol/pkc-js/issues/257) [#257](https://github.com/pkcprotocol/pkc-js/issues/257) [#257](https://github.com/pkcprotocol/pkc-js/issues/257) [#261](https://github.com/pkcprotocol/pkc-js/issues/261) [#261](https://github.com/pkcprotocol/pkc-js/issues/261)
  * pkc-js [0.0.79](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.79) (2026-08-12)
    * fix(helia): detach peer:update listener when the provider stream throws ([#256](https://github.com/pkcprotocol/pkc-js/issues/256)) ([488c1cb](https://github.com/pkcprotocol/pkc-js/commit/488c1cbad6afb55dfe5bd29addf1e08c06f552c2))
    * fix(kubo): run repo GC hourly per daemon instead of on a StorageMax watermark ([#259](https://github.com/pkcprotocol/pkc-js/issues/259)) ([7a0c849](https://github.com/pkcprotocol/pkc-js/commit/7a0c849dd2ccf7e980bdd0af22c552a769c70770)), closes [#225](https://github.com/pkcprotocol/pkc-js/issues/225) [#225](https://github.com/pkcprotocol/pkc-js/issues/225) [pkcprotocol/pkc-js#225](https://github.com/pkcprotocol/pkc-js/issues/225) [pkcprotocol/pkc-js#258](https://github.com/pkcprotocol/pkc-js/issues/258) [#225](https://github.com/pkcprotocol/pkc-js/issues/225) [pkcprotocol/pkc-js#258](https://github.com/pkcprotocol/pkc-js/issues/258)
  * pkc-js [0.0.78](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.78) (2026-08-07)

## <small>0.19.88 (2026-08-08)</small>

* chore(deps): upgrade 5chan web UI v0.9.7 -> v0.9.17 ([49c6c1e](https://github.com/bitsocialnet/bitsocial-cli/commit/49c6c1e))

## <small>0.19.87 (2026-08-07)</small>

* refactor(daemon): run repo gc unconditionally every hour ([d67d486](https://github.com/bitsocialnet/bitsocial-cli/commit/d67d486))
* feat(daemon): periodic IPFS repo GC over kubo RPC, upgrade kubo 0.43.0 + pkc-js 0.0.77 ([6757a87](https://github.com/bitsocialnet/bitsocial-cli/commit/6757a87)), closes [ipfs/kubo#11424](https://github.com/ipfs/kubo/issues/11424)
  * pkc-js [0.0.77](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.77) (2026-08-07)
  * pkc-js [0.0.76](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.76) (2026-08-01)
    * feat(community): delegated community identity and delegation setup ([#237](https://github.com/pkcprotocol/pkc-js/issues/237)) ([d2fe541](https://github.com/pkcprotocol/pkc-js/commit/d2fe541538afb8ef63c178a37249de6a9fe27ddf)), closes [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#234](https://github.com/pkcprotocol/pkc-js/issues/234) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#234](https://github.com/pkcprotocol/pkc-js/issues/234) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#234](https://github.com/pkcprotocol/pkc-js/issues/234) [#234](https://github.com/pkcprotocol/pkc-js/issues/234) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#234](https://github.com/pkcprotocol/pkc-js/issues/234) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#233](https://github.com/pkcprotocol/pkc-js/issues/233)
  * pkc-js [0.0.75](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.75) (2026-08-01)
    * perf(helia): persist blocks per runtime behind a size-capped LRU blockstore ([#241](https://github.com/pkcprotocol/pkc-js/issues/241)) ([5c12ac8](https://github.com/pkcprotocol/pkc-js/commit/5c12ac80645e6117695a28075b6918ea74cf4fde)), closes [#240](https://github.com/pkcprotocol/pkc-js/issues/240) [#240](https://github.com/pkcprotocol/pkc-js/issues/240)
  * pkc-js [0.0.74](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.74) (2026-07-30)
    * feat(community): settings.disablePubsubChallengeExchange, no pubsubTopic fallback ([#236](https://github.com/pkcprotocol/pkc-js/issues/236)) ([ce8dc11](https://github.com/pkcprotocol/pkc-js/commit/ce8dc11f1f1103d54f1a9920bf966f39bf9edf3e)), closes [#229](https://github.com/pkcprotocol/pkc-js/issues/229) [#229](https://github.com/pkcprotocol/pkc-js/issues/229) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#233](https://github.com/pkcprotocol/pkc-js/issues/233) [#229](https://github.com/pkcprotocol/pkc-js/issues/229) [#129](https://github.com/pkcprotocol/pkc-js/issues/129)

## <small>0.19.86 (2026-07-30)</small>

* ci: speed up global install with --prefer-offline ([ff6aa9b](https://github.com/bitsocialnet/bitsocial-cli/commit/ff6aa9b))
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.71 -> 0.0.73 (issue #118) ([0382b13](https://github.com/bitsocialnet/bitsocial-cli/commit/0382b13)), closes [#118](https://github.com/bitsocialnet/bitsocial-cli/issues/118)
  * pkc-js [0.0.73](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.73) (2026-07-27)
    * fix(community): stop stale_replies from re-flagging parents of its own batch ([#230](https://github.com/pkcprotocol/pkc-js/issues/230)) ([#231](https://github.com/pkcprotocol/pkc-js/issues/231)) ([75417f9](https://github.com/pkcprotocol/pkc-js/commit/75417f9f900a8491ebe2b5d0ef64ec2ca841224e)), closes [209/#211](https://github.com/209/pkc-js/issues/211) [#211](https://github.com/pkcprotocol/pkc-js/issues/211)
  * pkc-js [0.0.72](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.72) (2026-07-19)
    * feat(helia): expose a public, semver-covered accessor for the shared Helia node ([#223](https://github.com/pkcprotocol/pkc-js/issues/223)) ([2d56020](https://github.com/pkcprotocol/pkc-js/commit/2d56020f87d48677d2426d258e51ff3fdaabc301)), closes [#221](https://github.com/pkcprotocol/pkc-js/issues/221)

## <small>0.19.85 (2026-07-14)</small>

* chore(deps): upgrade pkc-js 0.0.71, bso-resolver 0.0.10 (issue #116) ([1d7d301](https://github.com/bitsocialnet/bitsocial-cli/commit/1d7d301)), closes [#116](https://github.com/bitsocialnet/bitsocial-cli/issues/116)
  * pkc-js [0.0.71](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.71) (2026-07-14)
    * perf(helia): parallelize delegated-routing lookups and fail over stalled bitswap session blocks ([#220](https://github.com/pkcprotocol/pkc-js/issues/220)) ([603fe4d](https://github.com/pkcprotocol/pkc-js/commit/603fe4d91ac514286ad348c6db9218fd4d05eccb)), closes [#218](https://github.com/pkcprotocol/pkc-js/issues/218) [#189](https://github.com/pkcprotocol/pkc-js/issues/189) [#218](https://github.com/pkcprotocol/pkc-js/issues/218) [#189](https://github.com/pkcprotocol/pkc-js/issues/189) [#218](https://github.com/pkcprotocol/pkc-js/issues/218)
  * pkc-js [0.0.70](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.70) (2026-07-13)
    * fix(helia): retry addr-limited provider dials once the provider stream completes ([#214](https://github.com/pkcprotocol/pkc-js/issues/214)) ([68e3e5f](https://github.com/pkcprotocol/pkc-js/commit/68e3e5fcdfd0a720c0a24f743bcf218738847614)), closes [#213](https://github.com/pkcprotocol/pkc-js/issues/213) [#216](https://github.com/pkcprotocol/pkc-js/issues/216) [#215](https://github.com/pkcprotocol/pkc-js/issues/215) [#213](https://github.com/pkcprotocol/pkc-js/issues/213) [#215](https://github.com/pkcprotocol/pkc-js/issues/215)

## <small>0.19.84 (2026-07-12)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.62 -> 0.0.69 (issue #114) ([231d826](https://github.com/bitsocialnet/bitsocial-cli/commit/231d826)), closes [#114](https://github.com/bitsocialnet/bitsocial-cli/issues/114)
  * pkc-js [0.0.69](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.69) (2026-07-11)
    * fix(community): stamp CommentUpdate insertedAt before the batch reads the DB ([#211](https://github.com/pkcprotocol/pkc-js/issues/211)) ([49ddc90](https://github.com/pkcprotocol/pkc-js/commit/49ddc9015cfd0adc7be4649ba343f073118f730d)), closes [#209](https://github.com/pkcprotocol/pkc-js/issues/209) [#209](https://github.com/pkcprotocol/pkc-js/issues/209)
    * fix(helia): cache direct-fetched IPNS records at the pubsub routing layer ([#212](https://github.com/pkcprotocol/pkc-js/issues/212)) ([4986f35](https://github.com/pkcprotocol/pkc-js/commit/4986f35b8f0db4aa802d59c966cf0518c173cfd0)), closes [#210](https://github.com/pkcprotocol/pkc-js/issues/210) [#210](https://github.com/pkcprotocol/pkc-js/issues/210) [#202](https://github.com/pkcprotocol/pkc-js/issues/202)
  * pkc-js [0.0.68](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.68) (2026-07-10)
    * perf(helia): scope bitswap session seed peers to the community being fetched ([#203](https://github.com/pkcprotocol/pkc-js/issues/203)) ([02e7a25](https://github.com/pkcprotocol/pkc-js/commit/02e7a25782f95bc0b1059ab1e799bd1116f74cf1)), closes [#202](https://github.com/pkcprotocol/pkc-js/issues/202)
  * pkc-js [0.0.67](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.67) (2026-07-10)
    * fix(community): discard fetch results that land after a key migration ([#206](https://github.com/pkcprotocol/pkc-js/issues/206)) ([892aa55](https://github.com/pkcprotocol/pkc-js/commit/892aa559c64ab09e475737b9bc2f221bac0c6e16)), closes [#205](https://github.com/pkcprotocol/pkc-js/issues/205)
  * pkc-js [0.0.66](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.66) (2026-07-10)
    * fix(helia): don't count undialable providers toward maxPeers in direct IPNS fetch ([#192](https://github.com/pkcprotocol/pkc-js/issues/192)) ([5cebc93](https://github.com/pkcprotocol/pkc-js/commit/5cebc9388e53adc842d442a192c316cfa4530d75)), closes [#186](https://github.com/pkcprotocol/pkc-js/issues/186) [#188](https://github.com/pkcprotocol/pkc-js/issues/188)
    * fix: remove accidentally committed node_modules self-symlink ([9c647d5](https://github.com/pkcprotocol/pkc-js/commit/9c647d59be5f1100dae35d7ad0d2023ed7ebc868)), closes [#177](https://github.com/pkcprotocol/pkc-js/issues/177)
    * fix(rpc): add per-call timeout to PKCRpcClient so a lost response can't hang callers forever ([#196](https://github.com/pkcprotocol/pkc-js/issues/196)) ([7cdc6a1](https://github.com/pkcprotocol/pkc-js/commit/7cdc6a14ead60465ad5986a8cd33e179d896cac4)), closes [#195](https://github.com/pkcprotocol/pkc-js/issues/195) [method#N](https://github.com/pkcprotocol/method/issues/N)
    * perf(helia): fetch DAGs through bitswap sessions seeded with connected peers ([#191](https://github.com/pkcprotocol/pkc-js/issues/191)) ([209b846](https://github.com/pkcprotocol/pkc-js/commit/209b84691abee6c66928833b3a693c33e7352ddf)), closes [#189](https://github.com/pkcprotocol/pkc-js/issues/189)
    * perf(signatures): use WebCrypto Ed25519 verify when available ([#190](https://github.com/pkcprotocol/pkc-js/issues/190)) ([ddc8a4a](https://github.com/pkcprotocol/pkc-js/commit/ddc8a4a8b6018f5ef164a65ff741ff8f454b1128)), closes [#187](https://github.com/pkcprotocol/pkc-js/issues/187) [#138](https://github.com/pkcprotocol/pkc-js/issues/138)
  * pkc-js [0.0.65](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.65) (2026-07-08)
    * feat(helia): fetch IPNS records directly from providers/subscribers ([#185](https://github.com/pkcprotocol/pkc-js/issues/185)) ([#186](https://github.com/pkcprotocol/pkc-js/issues/186)) ([75f03f9](https://github.com/pkcprotocol/pkc-js/commit/75f03f915a455599359165eb9a184a8f5b68a188))
  * pkc-js [0.0.64](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.64) (2026-07-07)
    * perf(import): tree-shake remeda (v2 + named imports) ([#180](https://github.com/pkcprotocol/pkc-js/issues/180)) ([0707680](https://github.com/pkcprotocol/pkc-js/commit/07076800cdfd7048fb79870e3914f34058cae1ba)), closes [#178](https://github.com/pkcprotocol/pkc-js/issues/178)
  * pkc-js [0.0.63](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.63) (2026-07-06)
    * fix(rpc): recover community subscription stranded when its shared updating entry stops ([#129](https://github.com/pkcprotocol/pkc-js/issues/129)) ([#182](https://github.com/pkcprotocol/pkc-js/issues/182)) ([b7f22f8](https://github.com/pkcprotocol/pkc-js/commit/b7f22f8ad6b230fa2e9450932b5dcf67d3db2dad)), closes [#181](https://github.com/pkcprotocol/pkc-js/issues/181)
    * perf(import): defer kubo + ipns/blockstore off the eager import path ([#177](https://github.com/pkcprotocol/pkc-js/issues/177)) ([b8bff07](https://github.com/pkcprotocol/pkc-js/commit/b8bff077b918654db23453468e414bb317d4534a)), closes [#120](https://github.com/pkcprotocol/pkc-js/issues/120)

## <small>0.19.83 (2026-06-29)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.59 -> 0.0.62 (issue #112) ([be4a354](https://github.com/bitsocialnet/bitsocial-cli/commit/be4a354)), closes [#112](https://github.com/bitsocialnet/bitsocial-cli/issues/112)
  * pkc-js [0.0.62](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.62) (2026-06-29)
    * fix(helia): tolerate per-router errors in content-routing findProviders ([#171](https://github.com/pkcprotocol/pkc-js/issues/171)) ([#172](https://github.com/pkcprotocol/pkc-js/issues/172)) ([a1d77c7](https://github.com/pkcprotocol/pkc-js/commit/a1d77c7dc89aabc0b37fbb20c9ed2aa3af30a0b1))
  * pkc-js [0.0.61](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.61) (2026-06-29)
  * pkc-js [0.0.60](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.60) (2026-06-29)
    * fix(destroy): force-reset libp2p sockets and abort pending re-publish on destroy ([#168](https://github.com/pkcprotocol/pkc-js/issues/168)) ([2aa1d2a](https://github.com/pkcprotocol/pkc-js/commit/2aa1d2a382c2914c5f27dce863bfbecde1ad9257))

## <small>0.19.82 (2026-06-28)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.57 -> 0.0.59 (issue #111) ([3ba0d5f](https://github.com/bitsocialnet/bitsocial-cli/commit/3ba0d5f)), closes [#111](https://github.com/bitsocialnet/bitsocial-cli/issues/111)
  * pkc-js [0.0.59](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.59) (2026-06-28)
    * feat(helia): reject WebRTC + WebTransport dials by default ([#167](https://github.com/pkcprotocol/pkc-js/issues/167)) ([8f9f8db](https://github.com/pkcprotocol/pkc-js/commit/8f9f8db866ecf531314682999a760c9788ccc29d)), closes [#166](https://github.com/pkcprotocol/pkc-js/issues/166)
  * pkc-js [0.0.58](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.58) (2026-06-28)
    * feat(local-community): allow mods to reply to locked posts ([#165](https://github.com/pkcprotocol/pkc-js/issues/165)) ([b32830e](https://github.com/pkcprotocol/pkc-js/commit/b32830e8adf7e049decbafffe2c86b11ddbde9d3)), closes [#164](https://github.com/pkcprotocol/pkc-js/issues/164)
    * fix(local-community): clearer error when post is missing required link ([d8dcd57](https://github.com/pkcprotocol/pkc-js/commit/d8dcd57e9e6ca1b61466cb326dfeea5f932e1c18))

## <small>0.19.81 (2026-06-26)</small>

* ci: retry global install to survive transient kubo download failures (#110) ([6262e96](https://github.com/bitsocialnet/bitsocial-cli/commit/6262e96)), closes [#110](https://github.com/bitsocialnet/bitsocial-cli/issues/110)
* ci: retry npm ci too, kubo download flakiness hits every install step (#110) ([2243a7f](https://github.com/bitsocialnet/bitsocial-cli/commit/2243a7f)), closes [#110](https://github.com/bitsocialnet/bitsocial-cli/issues/110)

## <small>0.19.80 (2026-06-26)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.55 -> 0.0.57 (issue #109) ([1f11cb2](https://github.com/bitsocialnet/bitsocial-cli/commit/1f11cb2)), closes [#109](https://github.com/bitsocialnet/bitsocial-cli/issues/109)
  * pkc-js [0.0.57](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.57) (2026-06-26)
    * feat(local-community): re-provide connection CIDs when browser-dialable addresses rotate ([#162](https://github.com/pkcprotocol/pkc-js/issues/162)) ([7143ee3](https://github.com/pkcprotocol/pkc-js/commit/7143ee32bcf9156220fb5e80eced4c474299568c)), closes [#161](https://github.com/pkcprotocol/pkc-js/issues/161)
  * pkc-js [0.0.56](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.56) (2026-06-26)
    * fix(rewriter): only persist request logs once their outcome is known ([#157](https://github.com/pkcprotocol/pkc-js/issues/157)) ([#159](https://github.com/pkcprotocol/pkc-js/issues/159)) ([3330f7f](https://github.com/pkcprotocol/pkc-js/commit/3330f7f5b78fb1fe3026e4fe172fe83669fa003b))
    * fix(rpc): survive boot-time Kubo restart during auto-start ([#158](https://github.com/pkcprotocol/pkc-js/issues/158)) ([#160](https://github.com/pkcprotocol/pkc-js/issues/160)) ([1113736](https://github.com/pkcprotocol/pkc-js/commit/111373692ce08def45915ead1f1e71dfb950f344)), closes [#157](https://github.com/pkcprotocol/pkc-js/issues/157)
* chore(deps): upgrade 5chan web UI v0.9.4 -> v0.9.7 ([0d56889](https://github.com/bitsocialnet/bitsocial-cli/commit/0d56889))

## <small>0.19.79 (2026-06-26)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.53 -> 0.0.54 (issue #107) ([25d0a8f](https://github.com/bitsocialnet/bitsocial-cli/commit/25d0a8f)), closes [#107](https://github.com/bitsocialnet/bitsocial-cli/issues/107)
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.54 -> 0.0.55 (issue #108) ([d2fb663](https://github.com/bitsocialnet/bitsocial-cli/commit/d2fb663)), closes [#108](https://github.com/bitsocialnet/bitsocial-cli/issues/108)
  * pkc-js [0.0.55](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.55) (2026-06-26)
    * fix(kubo): strip /p2p suffix and dedupe addrs in rewriter proxy ([#156](https://github.com/pkcprotocol/pkc-js/issues/156)) ([0ad83da](https://github.com/pkcprotocol/pkc-js/commit/0ad83dae0dde1017577eeb3f6adb87f8720d7f76))
  * pkc-js [0.0.54](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.54) (2026-06-25)
    * feat(kubo): restore address rewriter proxy for provider records ([#155](https://github.com/pkcprotocol/pkc-js/issues/155)) ([5409134](https://github.com/pkcprotocol/pkc-js/commit/5409134b04284ac37580360765a763ff928889d8)), closes [#154](https://github.com/pkcprotocol/pkc-js/issues/154) [ipfs/kubo#11369](https://github.com/ipfs/kubo/issues/11369)
* chore(deps): upgrade 5chan web UI v0.8.5 -> v0.9.4 ([2460804](https://github.com/bitsocialnet/bitsocial-cli/commit/2460804))

## <small>0.19.78 (2026-06-25)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.51 -> 0.0.53 (issue #106) ([7d3a79e](https://github.com/bitsocialnet/bitsocial-cli/commit/7d3a79e)), closes [#106](https://github.com/bitsocialnet/bitsocial-cli/issues/106)
  * pkc-js [0.0.53](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.53) (2026-06-25)
  * pkc-js [0.0.52](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.52) (2026-06-25)
    * feat(routers): add routerofbitsocial.xyz and bsotracker.online to default HTTP routers ([f81506d](https://github.com/pkcprotocol/pkc-js/commit/f81506d2104e00945573193861a49247b7635ea4))
* feat(routers): add routerofbitsocial.xyz and bsotracker.online to default HTTP routers (issue #105) ([b6e8d06](https://github.com/bitsocialnet/bitsocial-cli/commit/b6e8d06)), closes [#105](https://github.com/bitsocialnet/bitsocial-cli/issues/105)

## <small>0.19.77 (2026-06-25)</small>

* fix(ipfs): replace deprecated --enable-namesys-pubsub flag with Ipns.UsePubsub config (issue #103) ([dc607b2](https://github.com/bitsocialnet/bitsocial-cli/commit/dc607b2)), closes [#103](https://github.com/bitsocialnet/bitsocial-cli/issues/103)

## <small>0.19.76 (2026-06-25)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.50 -> 0.0.51 (issue #102) ([5dbffc5](https://github.com/bitsocialnet/bitsocial-cli/commit/5dbffc5)), closes [#102](https://github.com/bitsocialnet/bitsocial-cli/issues/102)
  * pkc-js [0.0.51](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.51) (2026-06-25)
    * feat(kubo): restore address rewriter proxy for HTTP-router provider records ([#152](https://github.com/pkcprotocol/pkc-js/issues/152)) ([d3a0fa7](https://github.com/pkcprotocol/pkc-js/commit/d3a0fa7f34426ec7edd64825f25d133062a3e5b1)), closes [#128](https://github.com/pkcprotocol/pkc-js/issues/128) [kubo#11369](https://github.com/pkcprotocol/kubo/issues/11369) [#151](https://github.com/pkcprotocol/pkc-js/issues/151)
    * fix(kubo): flush MFS root before repo.gc (ipfs/kubo[#10842](https://github.com/pkcprotocol/pkc-js/issues/10842) wedge) ([#153](https://github.com/pkcprotocol/pkc-js/issues/153)) ([889532b](https://github.com/pkcprotocol/pkc-js/commit/889532b60dfb14126d4f8397f032329f2b723e4e)), closes [#128](https://github.com/pkcprotocol/pkc-js/issues/128) [kubo#11369](https://github.com/pkcprotocol/kubo/issues/11369) [#151](https://github.com/pkcprotocol/pkc-js/issues/151)

## <small>0.19.75 (2026-06-24)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.49 -> 0.0.50 (issue #101) ([43af72e](https://github.com/bitsocialnet/bitsocial-cli/commit/43af72e)), closes [#101](https://github.com/bitsocialnet/bitsocial-cli/issues/101)
  * pkc-js [0.0.50](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.50) (2026-06-24)
    * feat(kubo): force-announce browser-dialable addrs via AppendAnnounce (workaround kubo[#11369](https://github.com/pkcprotocol/pkc-js/issues/11369)) ([#151](https://github.com/pkcprotocol/pkc-js/issues/151)) ([3a5fbfe](https://github.com/pkcprotocol/pkc-js/commit/3a5fbfe9c57780f944204013996d13ac44c8a151)), closes [#150](https://github.com/pkcprotocol/pkc-js/issues/150)

## <small>0.19.74 (2026-06-24)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.48 -> 0.0.49 (issue #100) ([c1be32d](https://github.com/bitsocialnet/bitsocial-cli/commit/c1be32d)), closes [#100](https://github.com/bitsocialnet/bitsocial-cli/issues/100)
  * pkc-js [0.0.49](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.49) (2026-06-24)
    * fix: eliminate abort-listener and pending-map memory leaks ([#144](https://github.com/pkcprotocol/pkc-js/issues/144)–[#148](https://github.com/pkcprotocol/pkc-js/issues/148)) ([#149](https://github.com/pkcprotocol/pkc-js/issues/149)) ([e7b0697](https://github.com/pkcprotocol/pkc-js/commit/e7b0697c663dd595d9e97329dd67fba2cc57e6e9)), closes [#145](https://github.com/pkcprotocol/pkc-js/issues/145) [#145](https://github.com/pkcprotocol/pkc-js/issues/145) [#146](https://github.com/pkcprotocol/pkc-js/issues/146) [#146](https://github.com/pkcprotocol/pkc-js/issues/146) [#147](https://github.com/pkcprotocol/pkc-js/issues/147) [#147](https://github.com/pkcprotocol/pkc-js/issues/147) [#145](https://github.com/pkcprotocol/pkc-js/issues/145) [#146](https://github.com/pkcprotocol/pkc-js/issues/146) [#147](https://github.com/pkcprotocol/pkc-js/issues/147)
    * fix(test): make rpc comment-update state assertion robust to cache skips ([789b427](https://github.com/pkcprotocol/pkc-js/commit/789b427fbd0ffb436d686ccd41a526cc030e7fe2))
* fix(daemon): cap startup-failure shutdown + pin its test to the injected path (issue #98) ([bf4778e](https://github.com/bitsocialnet/bitsocial-cli/commit/bf4778e)), closes [#98](https://github.com/bitsocialnet/bitsocial-cli/issues/98) [#87](https://github.com/bitsocialnet/bitsocial-cli/issues/87)
* fix(daemon): run async kubo cleanup before process.exit on startup failure (issue #98) ([7d94cdb](https://github.com/bitsocialnet/bitsocial-cli/commit/7d94cdb)), closes [#98](https://github.com/bitsocialnet/bitsocial-cli/issues/98) [87/#97](https://github.com/bitsocialnet/bitsocial-cli/issues/97)

## <small>0.19.73 (2026-06-13)</small>

* test(daemon): poll waitForKuboReady when verifying kubo is up (issue #95) ([d06787d](https://github.com/bitsocialnet/bitsocial-cli/commit/d06787d)), closes [#95](https://github.com/bitsocialnet/bitsocial-cli/issues/95)
* test(daemon): retry the bind race when the daemon's pre-bind guard fires (issue #97) ([22093a6](https://github.com/bitsocialnet/bitsocial-cli/commit/22093a6)), closes [#97](https://github.com/bitsocialnet/bitsocial-cli/issues/97)
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.47 -> 0.0.48 (issue #96) ([091566d](https://github.com/bitsocialnet/bitsocial-cli/commit/091566d)), closes [#96](https://github.com/bitsocialnet/bitsocial-cli/issues/96)
  * pkc-js [0.0.48](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.48) (2026-06-13)
    * fix(community): skip purged comments in postUpdates MFS sync ([#143](https://github.com/pkcprotocol/pkc-js/issues/143)) ([8b68b7f](https://github.com/pkcprotocol/pkc-js/commit/8b68b7ff4825178c42a47f66a50df9b0842f4a2d)), closes [#142](https://github.com/pkcprotocol/pkc-js/issues/142)
    * build(deps): upgrade helia and libp2p dependencies ([#140](https://github.com/pkcprotocol/pkc-js/issues/140)) ([7f4304e](https://github.com/pkcprotocol/pkc-js/commit/7f4304ece6d25cbb31e50e5d47609a1d60f81bb3)), closes [#139](https://github.com/pkcprotocol/pkc-js/issues/139) [#139](https://github.com/pkcprotocol/pkc-js/issues/139)
* fix(daemon-state): tolerate Windows EPERM/EACCES/EBUSY when pruning stale state files (issue #94) ([d341f64](https://github.com/bitsocialnet/bitsocial-cli/commit/d341f64)), closes [#94](https://github.com/bitsocialnet/bitsocial-cli/issues/94)
* docs(community/list): note -q is much faster than the default (#76) ([c04145f](https://github.com/bitsocialnet/bitsocial-cli/commit/c04145f)), closes [#76](https://github.com/bitsocialnet/bitsocial-cli/issues/76)
* perf(cli): enable V8 compile cache in bin/run (#90) ([ff7b40c](https://github.com/bitsocialnet/bitsocial-cli/commit/ff7b40c)), closes [#90](https://github.com/bitsocialnet/bitsocial-cli/issues/90)

## <small>0.19.72 (2026-06-12)</small>

* fix(update): require MainPID ownership before treating a daemon as systemd-managed (issue #92) ([28591bd](https://github.com/bitsocialnet/bitsocial-cli/commit/28591bd)), closes [#92](https://github.com/bitsocialnet/bitsocial-cli/issues/92) [#89](https://github.com/bitsocialnet/bitsocial-cli/issues/89) [pre-#82](https://github.com/pre-/issues/82)
* test: absorb pkc-js 0.0.46+ kubo restart and async edit visibility (issue #91) ([1849ff8](https://github.com/bitsocialnet/bitsocial-cli/commit/1849ff8)), closes [#91](https://github.com/bitsocialnet/bitsocial-cli/issues/91)
* chore(deps): upgrade @pkcprotocol/pkc-js 0.0.45 -> 0.0.47 (issue #91) ([555cdde](https://github.com/bitsocialnet/bitsocial-cli/commit/555cdde)), closes [#91](https://github.com/bitsocialnet/bitsocial-cli/issues/91)
  * pkc-js [0.0.47](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.47) (2026-06-12)
  * pkc-js [0.0.46](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.46) (2026-06-11)
    * fix(rpc): don't let one failing settings-change handler strand other subscriptions ([#129](https://github.com/pkcprotocol/pkc-js/issues/129)) ([#130](https://github.com/pkcprotocol/pkc-js/issues/130)) ([13ca91d](https://github.com/pkcprotocol/pkc-js/commit/13ca91d320f06353ee1b090f3e76ee3135e08e46))
    * perf: optimize package import/startup time - lazy-load, compile cache, bundled dist ([#120](https://github.com/pkcprotocol/pkc-js/issues/120)) ([#126](https://github.com/pkcprotocol/pkc-js/issues/126)) ([51e3a87](https://github.com/pkcprotocol/pkc-js/commit/51e3a8714617d9ddc9ec8a6ca1c0f2ce35cb8770)), closes [#124](https://github.com/pkcprotocol/pkc-js/issues/124) [#125](https://github.com/pkcprotocol/pkc-js/issues/125) [ipfs/kubo#10842](https://github.com/ipfs/kubo/issues/10842)

## <small>0.19.71 (2026-06-09)</small>

* fix(update): restart systemd-managed daemons via their supervisor (#82) ([49a7026](https://github.com/bitsocialnet/bitsocial-cli/commit/49a7026)), closes [#82](https://github.com/bitsocialnet/bitsocial-cli/issues/82) [#82](https://github.com/bitsocialnet/bitsocial-cli/issues/82)
* test: dynamically allocate kubo/daemon ports with bind-race retry (#87) ([8e1e407](https://github.com/bitsocialnet/bitsocial-cli/commit/8e1e407)), closes [#87](https://github.com/bitsocialnet/bitsocial-cli/issues/87)
* test: fix Windows swarm 4001 collision + address CodeRabbit review (#87) ([bb891cb](https://github.com/bitsocialnet/bitsocial-cli/commit/bb891cb)), closes [#87](https://github.com/bitsocialnet/bitsocial-cli/issues/87)

## <small>0.19.70 (2026-06-09)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.45 ([7a3d0a5](https://github.com/bitsocialnet/bitsocial-cli/commit/7a3d0a5))
  * pkc-js [0.0.45](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.45) (2026-06-09)
    * feat(community): add exportCommunityModLogs to expose CommentModerations ([#89](https://github.com/pkcprotocol/pkc-js/issues/89)) ([#123](https://github.com/pkcprotocol/pkc-js/issues/123)) ([7cd8c1f](https://github.com/pkcprotocol/pkc-js/commit/7cd8c1f821d3e57207f97d8fc2747adc5d44466d))
  * pkc-js [0.0.44](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.44) (2026-06-09)
    * fix(community): retry MFS files.stat on transient Kubo connection errors ([#122](https://github.com/pkcprotocol/pkc-js/issues/122)) ([d909552](https://github.com/pkcprotocol/pkc-js/commit/d90955222ef724ab4511cfb1530b744f2a06b7ea))
  * pkc-js [0.0.43](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.43) (2026-06-09)
  * pkc-js [0.0.42](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.42) (2026-06-09)
    * feat(community): load delegated IPNS communities (anchor → minter) ([#117](https://github.com/pkcprotocol/pkc-js/issues/117)) ([c8ef36d](https://github.com/pkcprotocol/pkc-js/commit/c8ef36d6e53cf3672721e8c13141e4cdd2a9b7cf)), closes [#93](https://github.com/pkcprotocol/pkc-js/issues/93) [ipfs/kubo#11351](https://github.com/ipfs/kubo/issues/11351) [#findIpnsRecord](https://github.com/pkcprotocol/pkc-js/issues/findIpnsRecord) [ipfs/helia#1041](https://github.com/ipfs/helia/issues/1041) [#118](https://github.com/pkcprotocol/pkc-js/issues/118) [#119](https://github.com/pkcprotocol/pkc-js/issues/119) [#119](https://github.com/pkcprotocol/pkc-js/issues/119) [#119](https://github.com/pkcprotocol/pkc-js/issues/119) [#119](https://github.com/pkcprotocol/pkc-js/issues/119)

## <small>0.19.69 (2026-06-09)</small>

* fix(deps): pin undici@8 so pkc-js body-timeout polyfill covers @libp2p/http ([fc76c35](https://github.com/bitsocialnet/bitsocial-cli/commit/fc76c35)), closes [#84](https://github.com/bitsocialnet/bitsocial-cli/issues/84)

## <small>0.19.68 (2026-06-09)</small>

* chore(deps): upgrade kubo 0.41.0 -> 0.42.0 (issue #80) ([5659d37](https://github.com/bitsocialnet/bitsocial-cli/commit/5659d37)), closes [#80](https://github.com/bitsocialnet/bitsocial-cli/issues/80)

## <small>0.19.67 (2026-06-09)</small>

* fix(logs): close race that dropped appends in -f follow mode (issue #77) ([d0e5e40](https://github.com/bitsocialnet/bitsocial-cli/commit/d0e5e40)), closes [#77](https://github.com/bitsocialnet/bitsocial-cli/issues/77) [#77](https://github.com/bitsocialnet/bitsocial-cli/issues/77)
* fix(update): align restart wait budget with daemon shutdown budget ([8680386](https://github.com/bitsocialnet/bitsocial-cli/commit/8680386))
* fix(update): wait for daemon process exit, not RPC port, before restart (issue #70) ([73458b4](https://github.com/bitsocialnet/bitsocial-cli/commit/73458b4)), closes [#70](https://github.com/bitsocialnet/bitsocial-cli/issues/70)
* test: add diagnostics to logs -f append-follow test (issue #77) ([c26e21f](https://github.com/bitsocialnet/bitsocial-cli/commit/c26e21f)), closes [#77](https://github.com/bitsocialnet/bitsocial-cli/issues/77) [#77](https://github.com/bitsocialnet/bitsocial-cli/issues/77)
* test: deflake logs -f follow tests and kubo restart-race detect window ([89371c6](https://github.com/bitsocialnet/bitsocial-cli/commit/89371c6)), closes [#77](https://github.com/bitsocialnet/bitsocial-cli/issues/77)
* test: fix diagnostics gap + widen restart window in kubo cleanup test ([4ae1b1e](https://github.com/bitsocialnet/bitsocial-cli/commit/4ae1b1e)), closes [#77](https://github.com/bitsocialnet/bitsocial-cli/issues/77)
* test(daemon-state): skip PID-reuse identity tests on Windows ([f3f403c](https://github.com/bitsocialnet/bitsocial-cli/commit/f3f403c)), closes [#66](https://github.com/bitsocialnet/bitsocial-cli/issues/66)
* test(kubo): retry RPC+gateway integration startup on port race ([475a943](https://github.com/bitsocialnet/bitsocial-cli/commit/475a943))
* test(update): assert update install exits 0 before checking restart marker ([3c986e0](https://github.com/bitsocialnet/bitsocial-cli/commit/3c986e0))

## <small>0.19.66 (2026-06-08)</small>

* fix(daemon-state): detect PID reuse so stale state files aren't treated as live daemons (#66) ([fe3609e](https://github.com/bitsocialnet/bitsocial-cli/commit/fe3609e)), closes [#66](https://github.com/bitsocialnet/bitsocial-cli/issues/66)
* fix(daemon): bound the shutdown wait on in-flight kubo starts (PR #71 review) ([10905a9](https://github.com/bitsocialnet/bitsocial-cli/commit/10905a9)), closes [#71](https://github.com/bitsocialnet/bitsocial-cli/issues/71)
* fix(daemon): eliminate kubo restart races that orphan kubo or hang shutdown (issue #70) ([6b61044](https://github.com/bitsocialnet/bitsocial-cli/commit/6b61044)), closes [#70](https://github.com/bitsocialnet/bitsocial-cli/issues/70)
* fix(daemon): guard shutdown against signal-exit re-raising SIGTERM mid-cleanup (issue #70) ([36ac0f4](https://github.com/bitsocialnet/bitsocial-cli/commit/36ac0f4)), closes [#70](https://github.com/bitsocialnet/bitsocial-cli/issues/70)
* test(daemon): dump daemon log files when restart-cleanup test fails on CI (issue #70) ([61a0594](https://github.com/bitsocialnet/bitsocial-cli/commit/61a0594)), closes [#70](https://github.com/bitsocialnet/bitsocial-cli/issues/70)
* feat(challenge): npm-style commands — idempotent install, npm-like output and aliases (#68) ([6af6148](https://github.com/bitsocialnet/bitsocial-cli/commit/6af6148)), closes [#68](https://github.com/bitsocialnet/bitsocial-cli/issues/68)

## <small>0.19.65 (2026-06-07)</small>

* fix(banner): improve terminal contrast ([203e44c](https://github.com/bitsocialnet/bitsocial-cli/commit/203e44c))
* fix(community): address CodeRabbit review on export command (#65) ([779a85f](https://github.com/bitsocialnet/bitsocial-cli/commit/779a85f)), closes [#65](https://github.com/bitsocialnet/bitsocial-cli/issues/65)
* fix(daemon): register cleanup before startup ([0c1f6b3](https://github.com/bitsocialnet/bitsocial-cli/commit/0c1f6b3))
* fix(daemon): stop express's catch-all 404 from clobbering /exports downloads ([0e40b4f](https://github.com/bitsocialnet/bitsocial-cli/commit/0e40b4f))
* feat(community): add `bitsocial community export` command (#64) ([53821e4](https://github.com/bitsocialnet/bitsocial-cli/commit/53821e4)), closes [#64](https://github.com/bitsocialnet/bitsocial-cli/issues/64) [pkcprotocol/pkc-js#100](https://github.com/pkcprotocol/pkc-js/issues/100)
* feat(community): default export destination to <dataPath>/exports/<address>_<datetime>.sqlite ([52c5ac1](https://github.com/bitsocialnet/bitsocial-cli/commit/52c5ac1))
* feat(update): hint at `bitsocial logs --stdout` after restarting daemons ([2df026a](https://github.com/bitsocialnet/bitsocial-cli/commit/2df026a))
* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.41 ([b246b8b](https://github.com/bitsocialnet/bitsocial-cli/commit/b246b8b))
  * pkc-js [0.0.41](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.41) (2026-06-06)
    * feat(community): community.export() — embedded ([#79](https://github.com/pkcprotocol/pkc-js/issues/79)) ([#100](https://github.com/pkcprotocol/pkc-js/issues/100)) ([3a3eef1](https://github.com/pkcprotocol/pkc-js/commit/3a3eef1e2d17a8ccca5258048b76160f9c2249c6)), closes [#1](https://github.com/pkcprotocol/pkc-js/issues/1) [#2](https://github.com/pkcprotocol/pkc-js/issues/2) [#2](https://github.com/pkcprotocol/pkc-js/issues/2) [#3](https://github.com/pkcprotocol/pkc-js/issues/3) [#3](https://github.com/pkcprotocol/pkc-js/issues/3) [#3](https://github.com/pkcprotocol/pkc-js/issues/3) [#3](https://github.com/pkcprotocol/pkc-js/issues/3) [#2](https://github.com/pkcprotocol/pkc-js/issues/2)

## <small>0.19.64 (2026-06-03)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.40 ([a19c8ac](https://github.com/bitsocialnet/bitsocial-cli/commit/a19c8ac))
  * pkc-js [0.0.40](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.40) (2026-06-03)
    * fix(modqueue): include challenge-supplied commentUpdate.reason in pending-approval page ([#111](https://github.com/pkcprotocol/pkc-js/issues/111)) ([62d4a9a](https://github.com/pkcprotocol/pkc-js/commit/62d4a9aed0e6be057345bd058a6b6a547a830f7c)), closes [#110](https://github.com/pkcprotocol/pkc-js/issues/110) [#110](https://github.com/pkcprotocol/pkc-js/issues/110)
  * pkc-js [0.0.39](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.39) (2026-05-31)
    * feat(community): add features.noReplyLinks to block replies with links ([#105](https://github.com/pkcprotocol/pkc-js/issues/105)) ([3cea716](https://github.com/pkcprotocol/pkc-js/commit/3cea71643df479f26a095335641227283ecbc7db))
* fix(webui): strip 5chan root hash redirect ([82b53fc](https://github.com/bitsocialnet/bitsocial-cli/commit/82b53fc))
* test(daemon): move RPC ports out of Linux ephemeral range to fix CI flake ([470d317](https://github.com/bitsocialnet/bitsocial-cli/commit/470d317))

## <small>0.19.63 (2026-05-25)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.38 ([ee72947](https://github.com/bitsocialnet/bitsocial-cli/commit/ee72947))
  * pkc-js [0.0.38](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.38) (2026-05-25)
    * fix(challenges): persist aggregatedComment extras through DB roundtrip ([#104](https://github.com/pkcprotocol/pkc-js/issues/104)) ([a30a5c3](https://github.com/pkcprotocol/pkc-js/commit/a30a5c39f66179f7fc2df7d0d5461ef3510d3987)), closes [#103](https://github.com/pkcprotocol/pkc-js/issues/103) [#103](https://github.com/pkcprotocol/pkc-js/issues/103)

## <small>0.19.62 (2026-05-24)</small>

* test(daemon-server): bind blocker to 0.0.0.0 so EADDRINUSE fires on macOS/Windows ([0d90f0f](https://github.com/bitsocialnet/bitsocial-cli/commit/0d90f0f))
* test(daemon-server): blocker must use Node's default listen host to match the daemon ([333ece2](https://github.com/bitsocialnet/bitsocial-cli/commit/333ece2))
* docs: scope github issue guidance for live ops ([6531340](https://github.com/bitsocialnet/bitsocial-cli/commit/6531340))
* docs(readme): fix interoperable typo ([00c25ab](https://github.com/bitsocialnet/bitsocial-cli/commit/00c25ab))
* Update README.md ([8168f62](https://github.com/bitsocialnet/bitsocial-cli/commit/8168f62))
* fix(daemon-server): await express listen() so port is bound before startup completes ([6a2f9da](https://github.com/bitsocialnet/bitsocial-cli/commit/6a2f9da))

## <small>0.19.61 (2026-05-23)</small>

* chore(deps): upgrade @pkcprotocol/pkc-js to 0.0.37 ([b3aaa57](https://github.com/bitsocialnet/bitsocial-cli/commit/b3aaa57)), closes [#50](https://github.com/bitsocialnet/bitsocial-cli/issues/50)
  * pkc-js [0.0.37](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.37) (2026-05-23)
    * feat(challenges): {success, error, reason, comment?, commentUpdate?} result shape ([#88](https://github.com/pkcprotocol/pkc-js/issues/88)) ([#99](https://github.com/pkcprotocol/pkc-js/issues/99)) ([d1032be](https://github.com/pkcprotocol/pkc-js/commit/d1032befdceec8485837560177fc947369a6ad79))
  * pkc-js [0.0.36](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.36) (2026-05-22)
    * feat(test-runner): auto-log stdout/stderr/per-test to .tmp/ and print paths on exit ([#98](https://github.com/pkcprotocol/pkc-js/issues/98)) ([2d69125](https://github.com/pkcprotocol/pkc-js/commit/2d6912563e3d14bf483092a1a95c5f412348220d))

## <small>0.19.60 (2026-05-21)</small>

* fix(daemon): fail fast when PKC RPC port is already in use ([bfe3d5c](https://github.com/bitsocialnet/bitsocial-cli/commit/bfe3d5c)), closes [#46](https://github.com/bitsocialnet/bitsocial-cli/issues/46)
* fix(daemon): normalize wildcard hostname before RPC port check ([06693ba](https://github.com/bitsocialnet/bitsocial-cli/commit/06693ba))
* fix(daemon): throw instead of silent return when RPC port races ([5094658](https://github.com/bitsocialnet/bitsocial-cli/commit/5094658))
* fix(ipfs): listen on 'close' so stderr drains before _spawnAsync rejects ([f7c7d1d](https://github.com/bitsocialnet/bitsocial-cli/commit/f7c7d1d))

## <small>0.19.59 (2026-05-20)</small>

* test(kubo): pre-init repos with ephemeral swarm so parallel tests don't collide on 4001 ([4342f68](https://github.com/bitsocialnet/bitsocial-cli/commit/4342f68)), closes [#44](https://github.com/bitsocialnet/bitsocial-cli/issues/44)
* fix(ipfs): expose kubo swarm port so nodes are browser-dialable ([83d6c2d](https://github.com/bitsocialnet/bitsocial-cli/commit/83d6c2d)), closes [#44](https://github.com/bitsocialnet/bitsocial-cli/issues/44)

## <small>0.19.58 (2026-05-20)</small>

* fix(logs): drop stale-stat gate, read directly from position ([844eaac](https://github.com/bitsocialnet/bitsocial-cli/commit/844eaac)), closes [#41](https://github.com/bitsocialnet/bitsocial-cli/issues/41)
* fix(logs): use userspace polling for -f follow mode ([76213c3](https://github.com/bitsocialnet/bitsocial-cli/commit/76213c3)), closes [#40](https://github.com/bitsocialnet/bitsocial-cli/issues/40)
* chore(deps): upgrade pkc-js to 0.0.35 ([b01faab](https://github.com/bitsocialnet/bitsocial-cli/commit/b01faab))
  * pkc-js [0.0.35](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.35) (2026-05-20)
    * fix(libp2p): gate pubsub warmup on local-mesh GRAFT ([#92](https://github.com/pkcprotocol/pkc-js/issues/92)) ([713e657](https://github.com/pkcprotocol/pkc-js/commit/713e6575bf8097880af908f1b93b371c3914e3b5))
    * fix(libp2p): parallelize warmup dials and run them past subscription-change ([306c87b](https://github.com/pkcprotocol/pkc-js/commit/306c87bdc8c6f09712f929a3c6545ef07f15cb2e))
* chore(README.md): update link ([0d5daa4](https://github.com/bitsocialnet/bitsocial-cli/commit/0d5daa4))
* ci(docker): build from the release tag instead of the pre-release SHA ([a254167](https://github.com/bitsocialnet/bitsocial-cli/commit/a254167)), closes [#38](https://github.com/bitsocialnet/bitsocial-cli/issues/38)

## <small>0.19.57 (2026-05-17)</small>

* chore(daemon): label uncaughtException/unhandledRejection log output ([f984cdc](https://github.com/bitsocialnet/bitsocial-cli/commit/f984cdc))
* chore(deps): upgrade pkc-js to 0.0.34 ([b10881d](https://github.com/bitsocialnet/bitsocial-cli/commit/b10881d))
  * pkc-js [0.0.34](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.34) (2026-05-17)
    * fix(local-community): auto-nuke MFS subtree when sync hits kubo MFS hang ([8f80c25](https://github.com/pkcprotocol/pkc-js/commit/8f80c25e17bdb443c24da6da2b20c4f5a28eb8bf)), closes [ipfs/kubo#10842](https://github.com/ipfs/kubo/issues/10842)

## <small>0.19.56 (2026-05-17)</small>

* chore(deps): upgrade pkc-js to 0.0.33, 5chan to v0.8.5 ([9322247](https://github.com/bitsocialnet/bitsocial-cli/commit/9322247))
  * pkc-js [0.0.33](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.33) (2026-05-15)
    * fix(challenges): skip downstream getChallenge() when prereqs have final-failed ([a50f33c](https://github.com/pkcprotocol/pkc-js/commit/a50f33c8d9d862238c2ec259c09e5d5605bd747d)), closes [#81](https://github.com/pkcprotocol/pkc-js/issues/81)
    * fix(libp2p): disable connectionMonitor abort-on-ping-failure ([b29532b](https://github.com/pkcprotocol/pkc-js/commit/b29532b9df5f364839b696d8ea21c2f3076db120))
  * pkc-js [0.0.32](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.32) (2026-05-12)
    * fix(libp2p): drop webTransport from browser transports ([210f4bd](https://github.com/pkcprotocol/pkc-js/commit/210f4bdd367aa02d03fcb617e03919a1a01cd01d))
  * pkc-js [0.0.31](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.31) (2026-05-11)
    * fix(helia): hardening pass from setup review ([960573f](https://github.com/pkcprotocol/pkc-js/commit/960573ff110a4ba386bade0b09fda20dd8d7a912))
    * fix(test): deflake key-migration cleared-state assertion under RPC ([d487a54](https://github.com/pkcprotocol/pkc-js/commit/d487a54e94d40ea4441709015048acdbdceeffa7))

## <small>0.19.55 (2026-05-07)</small>

* chore(deps): upgrade pkc-js to 0.0.30 ([c8be9d1](https://github.com/bitsocialnet/bitsocial-cli/commit/c8be9d1))
  * pkc-js [0.0.30](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.30) (2026-05-07)
    * fix(helia): wait for gossipsub graft before returning from IPNS warmup ([44a932c](https://github.com/pkcprotocol/pkc-js/commit/44a932cabf89a63c339cfc4a0c0302061a15e4a6))
    * fix(test): re-dedup adjacent states after stripping fetching-community-ipns ([92620b4](https://github.com/pkcprotocol/pkc-js/commit/92620b4874289824f1b57e3ff1775af627389dd1))
    * fix(test): tolerate parallel community connect race in reply.updatingstate ([4202ee0](https://github.com/pkcprotocol/pkc-js/commit/4202ee09e277c67bca20e8151ceffc9ba9fc765c))
* ci: bump GitHub Actions to latest majors (Node 24 runtime) ([f67e84e](https://github.com/bitsocialnet/bitsocial-cli/commit/f67e84e))

## <small>0.19.54 (2026-05-07)</small>

* chore(deps): upgrade pkc-js to 0.0.29 ([85e19dc](https://github.com/bitsocialnet/bitsocial-cli/commit/85e19dc))
  * pkc-js [0.0.29](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.29) (2026-05-07)
    * feat(helia): add @libp2p/webtransport browser transport ([fa74478](https://github.com/pkcprotocol/pkc-js/commit/fa74478a532ba2204e288a1451c75ca166354326)), closes [#85](https://github.com/pkcprotocol/pkc-js/issues/85)
    * fix(community): flush each MFS write to avoid Kubo's global noFlushLimit ([fe5dbe2](https://github.com/pkcprotocol/pkc-js/commit/fe5dbe22b1786cc82b140599b90896d9099bc063)), closes [#86](https://github.com/pkcprotocol/pkc-js/issues/86)
    * fix(test): retry name.publish in publishToIpns to tolerate Kubo ETIMEDOUT ([3ad7bdc](https://github.com/pkcprotocol/pkc-js/commit/3ad7bdc387b45ed8169fc33e4126b219cb3093f0))
    * fix(test): use execFileSync for Kubo config to fix Windows CI ([62aea9b](https://github.com/pkcprotocol/pkc-js/commit/62aea9bec1c1c3dec494c3a0ebe46f3f4dfb56d5))

## <small>0.19.53 (2026-05-07)</small>

* chore(deps): upgrade pkc-js to 0.0.28 ([56f6f85](https://github.com/bitsocialnet/bitsocial-cli/commit/56f6f85))
  * pkc-js [0.0.28](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.28) (2026-05-07)
    * feat(challenges): dependency-ordered lazy getChallenge() evaluation ([6ea5d4f](https://github.com/pkcprotocol/pkc-js/commit/6ea5d4f44c86c419f2244214e37a6ad99bcb008c))
    * fix(community): use 'name' key for ERR_DOMAIN_TXT_RECORD_NOT_FOUND details ([d1f8e36](https://github.com/pkcprotocol/pkc-js/commit/d1f8e36edab395eb543d5801dd90510a3b30c4af))
    * fix(test): avoid race in rpc comment update test by waiting on raw fields ([8157294](https://github.com/pkcprotocol/pkc-js/commit/815729436565a15c8d89048a8b4e326b7ecbe587))
    * fix(test): use fileURLToPath for tracking-challenge path on Windows ([781ca38](https://github.com/pkcprotocol/pkc-js/commit/781ca38beb9c6cdae52c5dc1e292e34f8a82083c))
  * pkc-js [0.0.27](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.27) (2026-05-06)
    * feat(comment): connect to community in parallel when loading by CID ([3298f1a](https://github.com/pkcprotocol/pkc-js/commit/3298f1aed2e0e92a150dcd39b2145045b496039a))
    * feat(errors): enrich libp2p error details with peer dial and connection context ([072fc5c](https://github.com/pkcprotocol/pkc-js/commit/072fc5ca1b5e63afa27237e6ef6b33acae1726f0))
  * pkc-js [0.0.26](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.26) (2026-05-05)
    * feat(helia.ipns): enrich ERR_RESOLVED_IPNS_P2P_TO_UNDEFINED details ([6f591d8](https://github.com/pkcprotocol/pkc-js/commit/6f591d8c24729bd6280fdb68fe1b67ee1318e59d))
    * feat(name-resolution): expose cache.maxAge on pkc.resolveAuthorName ([646e191](https://github.com/pkcprotocol/pkc-js/commit/646e19173543964439346385a7dad0df6b880ac3))

## <small>0.19.52 (2026-05-05)</small>

* ci: pin npm to 11.13.0 in CI workflows and Dockerfile ([2772399](https://github.com/bitsocialnet/bitsocial-cli/commit/2772399))
* ci: use corepack to pin npm 11.13.0, avoid self-upgrade race ([eb2ddb2](https://github.com/bitsocialnet/bitsocial-cli/commit/eb2ddb2))
* chore(deps): upgrade pkc-js to 0.0.25, bso-resolver to 0.0.8, 5chan to v0.8.3 ([6ba84ac](https://github.com/bitsocialnet/bitsocial-cli/commit/6ba84ac))
  * pkc-js [0.0.25](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.25) (2026-05-05)
    * feat(name-resolution): own caching in pkc-js with per-call freshness control ([8bcec14](https://github.com/pkcprotocol/pkc-js/commit/8bcec140aca6afdd00ab207c1a450d2ff903e57a)), closes [#83](https://github.com/pkcprotocol/pkc-js/issues/83)
    * revert: Revert "test(name-resolution): stub LRU storage when stubStorage is set" ([d874123](https://github.com/pkcprotocol/pkc-js/commit/d874123db8fa369c8e65faaea593d2a93e08c0ec))
  * pkc-js [0.0.24](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.24) (2026-05-05)
    * build: bump @libp2p/gossipsub to 15.0.21 ([3e8e679](https://github.com/pkcprotocol/pkc-js/commit/3e8e679344f872a8e2ccd753cc1a814353687ae6))
  * pkc-js [0.0.23](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.23) (2026-04-29)
    * fix(helia): await pubsub peer warmup before IPNS resolve ([0f9cc1c](https://github.com/pkcprotocol/pkc-js/commit/0f9cc1ce597f34ddee20b6ad80ad58c0889e6109))
    * build: bump Node engines to >=22 and upgrade p-retry to 8 ([abe639a](https://github.com/pkcprotocol/pkc-js/commit/abe639a61349fc398b50716909a30db51e8c0b12))
    * build: upgrade helia/libp2p packages and drop custom IPNS fetch router ([a14fd22](https://github.com/pkcprotocol/pkc-js/commit/a14fd225de20176bb080acd9000a315114068d9a))
  * pkc-js [0.0.22](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.22) (2026-04-28)
    * feat: re-export NameResolverInterface and NameResolver from root entry ([a756a47](https://github.com/pkcprotocol/pkc-js/commit/a756a47f0aeaa6e030a0c4bbbffb3e59138faa88))
  * pkc-js [0.0.21](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.21) (2026-04-28)
    * fix: retry transient ETIMEDOUT in importSignerIntoKuboNode ([d50132d](https://github.com/pkcprotocol/pkc-js/commit/d50132d0e9c925352bb232b7c00347f06b4f63d2))
* fix(daemon): rotate log file at cap and recover from tcpPortUsed ETIMEDOUT ([bea711c](https://github.com/bitsocialnet/bitsocial-cli/commit/bea711c)), closes [#37](https://github.com/bitsocialnet/bitsocial-cli/issues/37)

## <small>0.19.51 (2026-04-26)</small>

* build(deps): upgrade 5chan ([7e14300](https://github.com/bitsocialnet/bitsocial-cli/commit/7e14300))

## <small>0.19.50 (2026-04-24)</small>

* chore(deps): upgrade pkc-js to 0.0.20 and kubo to 0.41.0 ([c5dd9d7](https://github.com/bitsocialnet/bitsocial-cli/commit/c5dd9d7))
  * pkc-js [0.0.20](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.20) (2026-04-24)
    * feat: add CID-ref posts storage format and DB query support ([6f5bc75](https://github.com/pkcprotocol/pkc-js/commit/6f5bc755daa021701c95df1392771aaaff951464))
    * feat: reduce commentUpdate DB storage by 100-500x with CID references ([#80](https://github.com/pkcprotocol/pkc-js/issues/80)) ([c1b2280](https://github.com/pkcprotocol/pkc-js/commit/c1b2280a6ffc5d050873a7beb7831af118e3e945))
    * feat: support abortSignal in getPage and cancel in-flight fetches on pkc.destroy() ([d341d41](https://github.com/pkcprotocol/pkc-js/commit/d341d417228c84303eb07c9bf1f84550acdf23af))
    * fix: handle disablePreload replies in resolveRepliesCidRefsForEntries ([3a1b1b5](https://github.com/pkcprotocol/pkc-js/commit/3a1b1b5fa835fa4c04862bc16af1c58965b7610d))
    * fix: include package-lock.json in release-it commit hook ([e6d6b15](https://github.com/pkcprotocol/pkc-js/commit/e6d6b15d5d41e40be497305d128aa843e2ee3f7c))
    * fix: preserve commentCids order in attachReplies to fix page signature verification ([9896368](https://github.com/pkcprotocol/pkc-js/commit/9896368080f5a37bc9cf462b113f1c621e1b4e6d))
    * fix: preserve preloaded posts pages when sharing community state between instances ([ac99d98](https://github.com/pkcprotocol/pkc-js/commit/ac99d980edae54fd93b465d35fcef45689aa4164))
    * fix: properly serialize per-provider errors and strip ciphertext from pubsub error details ([b144bf0](https://github.com/pkcprotocol/pkc-js/commit/b144bf03422ef1b6022c9c6be45b0510f0ccbcb0))
    * fix: reconstruct pageCids from allPageCids in queryPageCommentsWithResolvedReplies ([132a29a](https://github.com/pkcprotocol/pkc-js/commit/132a29aa4be54fa8da271c8721c94d47f448331e))
    * fix: retry transient P2P fetches to recover from undici socket hiccups ([cdfc9f3](https://github.com/pkcprotocol/pkc-js/commit/cdfc9f3ebadfe1ab3ceb876d71188e2d764b7650)), closes [BaseClientsManager#_retryTransientP2PFetch](https://github.com/pkcprotocol/BaseClientsManager/issues/_retryTransientP2PFetch)
    * fix: update tests and add recursive CTE filters after CID-references refactor ([5a5cad0](https://github.com/pkcprotocol/pkc-js/commit/5a5cad08093e8e587f4bf9427916bec28025b837))
    * build: upgrade kubo from 0.40.1 to 0.41.0 ([7479625](https://github.com/pkcprotocol/pkc-js/commit/74796252641dbeeb9598303e541e9a840d514468))
    * build: upgrade package-lock.json ([b162706](https://github.com/pkcprotocol/pkc-js/commit/b162706a7e97f0c5c3f9cfcbbc40699f24f12d9e))

## <small>0.19.49 (2026-04-20)</small>

* fix: suppress verbose npm output during update install ([173793a](https://github.com/bitsocialnet/bitsocial-cli/commit/173793a))

## <small>0.19.48 (2026-04-20)</small>

* refactor: remove community status polling from update install ([c63e29c](https://github.com/bitsocialnet/bitsocial-cli/commit/c63e29c))

## <small>0.19.47 (2026-04-20)</small>

* feat: add --concurrency flag to community start ([6886105](https://github.com/bitsocialnet/bitsocial-cli/commit/6886105))
* feat: fast update install when only dist/ changed ([56f6011](https://github.com/bitsocialnet/bitsocial-cli/commit/56f6011))
* feat: wait for all communities to start after update install ([805aee1](https://github.com/bitsocialnet/bitsocial-cli/commit/805aee1))
* chore: update @pkcprotocol/pkc-js from 0.0.17 to 0.0.19 ([918d720](https://github.com/bitsocialnet/bitsocial-cli/commit/918d720))
  * pkc-js [0.0.19](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.19) (2026-04-20)
    * feat(rpc): start communities in parallel during auto-start ([8a2812f](https://github.com/pkcprotocol/pkc-js/commit/8a2812f71486651684dad19bc870d704185f5021))
    * fix: derive communityPublicKey/communityName in page parser for old-format wire records ([99fbb11](https://github.com/pkcprotocol/pkc-js/commit/99fbb11e35f561d2a5a0a754c34e9319d142949e))
  * pkc-js [0.0.18](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.18) (2026-04-19)
    * fix(test): use direct vitest imports instead of unreliable globals ([fd82e48](https://github.com/pkcprotocol/pkc-js/commit/fd82e4830e690a02d700605f2fa5e833894f1d3b))
* fix: use name instead of address in community edit example and test ([4ea3aac](https://github.com/bitsocialnet/bitsocial-cli/commit/4ea3aac))
* docs: improve community edit help with merge behavior and web UI link ([54382f2](https://github.com/bitsocialnet/bitsocial-cli/commit/54382f2))

## <small>0.19.46 (2026-04-20)</small>

* fix: convert null to undefined in community edit before calling pkc-js ([71c4127](https://github.com/bitsocialnet/bitsocial-cli/commit/71c4127))
* fix: use RFC 7396 array replace semantics for JSON file edits in community edit ([0a37084](https://github.com/bitsocialnet/bitsocial-cli/commit/0a37084))
* fix: wait for non-empty communities before reporting status after daemon restart ([2e68bd5](https://github.com/bitsocialnet/bitsocial-cli/commit/2e68bd5))
* feat: add --stdout and --stderr flags to bitsocial logs command ([211e85e](https://github.com/bitsocialnet/bitsocial-cli/commit/211e85e)), closes [#29](https://github.com/bitsocialnet/bitsocial-cli/issues/29)
* feat: add JSONC support to community create and edit commands ([914e466](https://github.com/bitsocialnet/bitsocial-cli/commit/914e466))
* feat: follow mode switches to new log file after daemon restart ([94ccfa9](https://github.com/bitsocialnet/bitsocial-cli/commit/94ccfa9)), closes [#31](https://github.com/bitsocialnet/bitsocial-cli/issues/31)

## <small>0.19.45 (2026-04-19)</small>

* feat: add --jsonFile (-f) flag to community edit for JSON-based edits ([8f27a15](https://github.com/bitsocialnet/bitsocial-cli/commit/8f27a15))
* feat: report community status after daemon restart in update install ([6001517](https://github.com/bitsocialnet/bitsocial-cli/commit/6001517)), closes [#26](https://github.com/bitsocialnet/bitsocial-cli/issues/26)

## <small>0.19.44 (2026-04-19)</small>

* fix: skip lifecycle scripts during challenge install to avoid husky failures ([9a99238](https://github.com/bitsocialnet/bitsocial-cli/commit/9a99238))
* fix(ci): strip scripts from challenge package.json instead of --ignore-scripts ([f61c9ff](https://github.com/bitsocialnet/bitsocial-cli/commit/f61c9ff))
* feat: add update-webuis script and bump 5chan to v0.7.4 ([c822812](https://github.com/bitsocialnet/bitsocial-cli/commit/c822812)), closes [#24](https://github.com/bitsocialnet/bitsocial-cli/issues/24)
* chore: remove .bso name resolvers console.log from daemon startup ([9580c26](https://github.com/bitsocialnet/bitsocial-cli/commit/9580c26))
* chore: upgrade @bitsocial/bso-resolver from 0.0.5 to 0.0.6 and run audit fix ([0b83d8f](https://github.com/bitsocialnet/bitsocial-cli/commit/0b83d8f))

## <small>0.19.43 (2026-04-19)</small>

* chore: upgrade @bitsocial/bso-resolver from 0.0.4 to 0.0.5 ([0209126](https://github.com/bitsocialnet/bitsocial-cli/commit/0209126))
* chore: upgrade @pkcprotocol/pkc-js from 0.0.16 to 0.0.17 ([4189f0d](https://github.com/bitsocialnet/bitsocial-cli/commit/4189f0d))
  * pkc-js [0.0.17](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.17) (2026-04-18)
    * fix: add timeout to resolveAuthorNameIfNeeded to prevent hanging on unresolvable domains ([15adb88](https://github.com/pkcprotocol/pkc-js/commit/15adb8813b05b03feec93ef5f0def474c37bee7f))
    * fix: break circular dependency in schema imports ([717fe1a](https://github.com/pkcprotocol/pkc-js/commit/717fe1a91e3d2ef665dafe4234fa7ff8462f4e80))
    * fix: bypass Vite 8 JSON recursion limit on large test fixtures ([fef14c0](https://github.com/pkcprotocol/pkc-js/commit/fef14c0473e429d8b9e0a54de81559464bea1c52))
    * fix: don't throw retriable errors immediately in getCommunity ([944b7ad](https://github.com/pkcprotocol/pkc-js/commit/944b7adb8a142ab015d0e536f9f66652f0568d72))
    * fix: downgrade release-it to 19.2.4 to resolve peer dependency conflict ([f5f6a73](https://github.com/pkcprotocol/pkc-js/commit/f5f6a73f98129588ebe14d4837f1eedfa5362bf7))
    * fix: downgrade Vite 8 to 7.3.2 to fix JSON recursion limit on test fixtures ([f80d04b](https://github.com/pkcprotocol/pkc-js/commit/f80d04b312a234e87eff3571e11fc062a2b163ef))
    * fix: reduce npm audit vulnerabilities from 16 to 11 ([de9fdfd](https://github.com/pkcprotocol/pkc-js/commit/de9fdfd60d97e6df7d00aa09a6fc1095f24f0ac3)), closes [cz-cli#1011](https://github.com/pkcprotocol/cz-cli/issues/1011) [#1007](https://github.com/pkcprotocol/pkc-js/issues/1007) [#963](https://github.com/pkcprotocol/pkc-js/issues/963)
    * fix: resolve author names through community's client manager and update RPC test params ([aca0e21](https://github.com/pkcprotocol/pkc-js/commit/aca0e217b17669a1efcf69b973fc364e10c263c5))
    * fix: resolve RPC test failures from shared RPC types refactoring ([f1241eb](https://github.com/pkcprotocol/pkc-js/commit/f1241eb2988563f41b668dfa8033acb888524b34))
    * fix: resolve TypeScript errors in test files for tempy imports and NetworkError type ([3752139](https://github.com/pkcprotocol/pkc-js/commit/3752139813305f9f89391c88cee9ebe67c6b7eb9))
    * fix: route browser debug output through per-test stderr logs ([f5783fd](https://github.com/pkcprotocol/pkc-js/commit/f5783fd09a8cd8fbdb7ae390a7abdd70e8d7d085))
    * fix: skip ignoreChallenge tests until feature is implemented ([ac0a1c0](https://github.com/pkcprotocol/pkc-js/commit/ac0a1c07065e9c80d8a396afdb7217ab9a79eefe))
    * fix(test): stabilize flaky browser gateway tests ([bc317a3](https://github.com/pkcprotocol/pkc-js/commit/bc317a303990329098acc2080ccc9916ad934139))
    * fix: untrack updating community before async stop to prevent race condition ([5699f5c](https://github.com/pkcprotocol/pkc-js/commit/5699f5cfb68074fe95e64e95e449367cdea77d22))
* fix(ci): extract only tarball filename from npm pack output ([2ad0ca1](https://github.com/bitsocialnet/bitsocial-cli/commit/2ad0ca1))
* feat: add daemon state files and --restart-daemons flag to update install ([caea9ad](https://github.com/bitsocialnet/bitsocial-cli/commit/caea9ad)), closes [#21](https://github.com/bitsocialnet/bitsocial-cli/issues/21)
* feat: print PKC options and .bso name resolvers in daemon stdout ([8053c29](https://github.com/bitsocialnet/bitsocial-cli/commit/8053c29))
* feat: update default chain provider URLs to public RPC endpoints ([ed739f6](https://github.com/bitsocialnet/bitsocial-cli/commit/ed739f6))
* ci: add global install smoke test to verify npm pack works ([a88539f](https://github.com/bitsocialnet/bitsocial-cli/commit/a88539f))
* ci: use bitsocial-release-bot for CI releases and update README ([f308210](https://github.com/bitsocialnet/bitsocial-cli/commit/f308210))
* docs: recommend nvm instead of nodejs.org for installing Node.js ([b0422db](https://github.com/bitsocialnet/bitsocial-cli/commit/b0422db))

## <small>0.19.42 (2026-04-18)</small>

* feat: show ASCII logo + wordmark banner on bare CLI and daemon start ([5be9873](https://github.com/bitsocialnet/bitsocial-cli/commit/5be9873)), closes [#1a4fd0](https://github.com/bitsocialnet/bitsocial-cli/issues/1a4fd0) [#e5e7eb](https://github.com/bitsocialnet/bitsocial-cli/issues/e5e7eb) [#19](https://github.com/bitsocialnet/bitsocial-cli/issues/19)

## <small>0.19.41 (2026-04-18)</small>

* fix: delete postinstall script in Docker deps stage to prevent build failure ([0ea2eed](https://github.com/bitsocialnet/bitsocial-cli/commit/0ea2eed))
* fix: show clear error when daemon is offline instead of dumping websocket error object ([8a938bd](https://github.com/bitsocialnet/bitsocial-cli/commit/8a938bd)), closes [#17](https://github.com/bitsocialnet/bitsocial-cli/issues/17)
* fix: strip devDependencies before npm install to avoid ETARGET on unresolvable devDeps ([6957efc](https://github.com/bitsocialnet/bitsocial-cli/commit/6957efc)), closes [#14](https://github.com/bitsocialnet/bitsocial-cli/issues/14)
* fix(ci): gate npm publish on successful GitHub release and fix Docker build ([3c64747](https://github.com/bitsocialnet/bitsocial-cli/commit/3c64747))
* feat: add --name and --publicKey flags to community get command ([84e4dc0](https://github.com/bitsocialnet/bitsocial-cli/commit/84e4dc0))
* feat: add `bitsocial update` command and switch distribution to npm ([78ce677](https://github.com/bitsocialnet/bitsocial-cli/commit/78ce677))
* feat: log timing expectation at start of challenge install ([83fb082](https://github.com/bitsocialnet/bitsocial-cli/commit/83fb082))
* feat: switch to postinstall webui downloads and remove tarball infrastructure ([504ded0](https://github.com/bitsocialnet/bitsocial-cli/commit/504ded0))
* chore(release): 0.19.40 [skip ci] ([fb903b1](https://github.com/bitsocialnet/bitsocial-cli/commit/fb903b1))
* refactor: replace dynamic import of pkc-logger with static import ([250415b](https://github.com/bitsocialnet/bitsocial-cli/commit/250415b))
* docs: require user confirmation before closing GitHub issues ([6277e7b](https://github.com/bitsocialnet/bitsocial-cli/commit/6277e7b))
* test: add failing test for challenge install with unresolvable devDependencies ([5b69a75](https://github.com/bitsocialnet/bitsocial-cli/commit/5b69a75))

* fix: show clear error when daemon is offline instead of dumping websocket error object (8a938bd)
* fix: delete postinstall script in Docker deps stage to prevent build failure (0ea2eed)
* Merge branch 'master' of github.com:bitsocialnet/bitsocial-cli (6515c41)
* refactor: replace dynamic import of pkc-logger with static import (250415b)
* feat: switch to postinstall webui downloads and remove tarball infrastructure (504ded0)
* feat: add `bitsocial update` command and switch distribution to npm (78ce677)
* feat: log timing expectation at start of challenge install (83fb082)
* docs: require user confirmation before closing GitHub issues (6277e7b)
* fix: strip devDependencies before npm install to avoid ETARGET on unresolvable devDeps (6957efc)
* test: add failing test for challenge install with unresolvable devDependencies (5b69a75)

## <small>0.19.40 (2026-04-16)</small>

* fix: fall back to system npm when bundled Node lacks npm ([5761f43](https://github.com/bitsocialnet/bitsocial-cli/commit/5761f43))
* fix: handle transient port-in-use errors in keepKuboUp interval ([45cdfc2](https://github.com/bitsocialnet/bitsocial-cli/commit/45cdfc2))
* fix: handle transient port-in-use errors in onKuboExit and add fallback retry ([c941f7d](https://github.com/bitsocialnet/bitsocial-cli/commit/c941f7d))
* fix: update org name from bitsocialhq to bitsocialnet across all references ([7ae75ed](https://github.com/bitsocialnet/bitsocial-cli/commit/7ae75ed))
* fix(ci): add --loglevel verbose to npm install for diagnostics ([b46823b](https://github.com/bitsocialnet/bitsocial-cli/commit/b46823b))
* fix(ci): add Python and MSVC build tools for Windows native modules ([37b5c2a](https://github.com/bitsocialnet/bitsocial-cli/commit/37b5c2a))
* fix(ci): add verbose npm install diagnostics for Windows hang debugging ([441fb43](https://github.com/bitsocialnet/bitsocial-cli/commit/441fb43))
* fix(ci): increase Windows test timeouts for community delete and mintpass install ([1c35d44](https://github.com/bitsocialnet/bitsocial-cli/commit/1c35d44))
* fix(ci): normalize 0.0.0.0 to 127.0.0.1 for health checks on macOS ([4652547](https://github.com/bitsocialnet/bitsocial-cli/commit/4652547))
* fix(ci): pass GITHUB_TOKEN and fix cross-platform log path in tests ([ddf5c27](https://github.com/bitsocialnet/bitsocial-cli/commit/ddf5c27))
* fix(ci): pipe npm install output for diagnostics and fix Windows CRLF splits ([d46ecb4](https://github.com/bitsocialnet/bitsocial-cli/commit/d46ecb4))
* fix(ci): remove --install-strategy=nested and --loglevel verbose from npm install ([ae74165](https://github.com/bitsocialnet/bitsocial-cli/commit/ae74165))
* fix(ci): resolve Windows ESM import path and afterAll hook timeout ([1fdda91](https://github.com/bitsocialnet/bitsocial-cli/commit/1fdda91))
* fix(ci): resolve Windows npm path and skip unsupported daemon cleanup test ([2ed32c7](https://github.com/bitsocialnet/bitsocial-cli/commit/2ed32c7))
* fix(ci): skip mintpass-integration test on Windows and revert diagnostics ([e192b98](https://github.com/bitsocialnet/bitsocial-cli/commit/e192b98))
* fix(ci): skip peer deps in Windows installer to avoid path length limit ([e3b3bd4](https://github.com/bitsocialnet/bitsocial-cli/commit/e3b3bd4))
* fix(ci): skip Windows SIGTERM tests and add mintpass install diagnostics ([f1da6f1](https://github.com/bitsocialnet/bitsocial-cli/commit/f1da6f1))
* fix(ci): use --logPath flag in logs test for cross-platform compatibility ([976d3eb](https://github.com/bitsocialnet/bitsocial-cli/commit/976d3eb))
* fix(test): add RPC readiness check and diagnostic output for macOS CI ([44f5a00](https://github.com/bitsocialnet/bitsocial-cli/commit/44f5a00))
* fix(test): poll for kubo shutdown instead of asserting immediate rejection ([b2e3d3b](https://github.com/bitsocialnet/bitsocial-cli/commit/b2e3d3b))
* chore: upgrade @pkcprotocol/pkc-js to 0.0.16 ([6be87ef](https://github.com/bitsocialnet/bitsocial-cli/commit/6be87ef))
  * pkc-js [0.0.16](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.16) (2026-04-16)
    * feat(ci): enable per-test logs and upload all logs as artifacts on failure ([c7a23a1](https://github.com/pkcprotocol/pkc-js/commit/c7a23a1354f170d0199dfdcdb199ca2f05109891))
    * feat(test): add --per-test-logs flag for per-file stdout/stderr capture ([47a65d5](https://github.com/pkcprotocol/pkc-js/commit/47a65d596b7dd07204af628179f93e79b6cd5ae8))
    * fix: add missing ERR_ROLE_ADDRESS_NAME_COULD_NOT_BE_RESOLVED error code to fix build ([9ce78eb](https://github.com/pkcprotocol/pkc-js/commit/9ce78ebafa58f43195d084d3cb2132a593045983))
    * fix(ci): cap vitest forks to 3 on Windows to prevent Kubo overload ([b581c2f](https://github.com/pkcprotocol/pkc-js/commit/b581c2f53e7089db6463c5f1791b7f86f592ed64))
    * fix(ci): use GitHub App token for release push to bypass branch protection ([3c8e068](https://github.com/pkcprotocol/pkc-js/commit/3c8e068c1c95712ffe933afb43f738091089beb3))
    * fix(ci): use os.tmpdir() for test server log path to fix Windows CI ([142e26f](https://github.com/pkcprotocol/pkc-js/commit/142e26f5f1a66cbad9b0038f2db29224744a55f2))
    * fix(ci): use runner.temp for per-test-logs path to fix Windows artifact upload ([3f53a58](https://github.com/pkcprotocol/pkc-js/commit/3f53a58f26b6152cbd2d545aea43df160b03166f))
    * fix(comment): search all tracked communities when comment identity is unknown ([477e9c2](https://github.com/pkcprotocol/pkc-js/commit/477e9c2d284dfe18d817bb4675c991e7b492959a))
    * fix(community): handle error fired synchronously during community.update() ([9777abf](https://github.com/pkcprotocol/pkc-js/commit/9777abf22bc8b899ec41311514f93f3af1eafd6d))
    * fix(community): make ERR_COMMUNITY_SIGNATURE_IS_INVALID retriable for gateways ([d33f112](https://github.com/pkcprotocol/pkc-js/commit/d33f112cc58cb4efb5711d01bbfa59c46a7e7e88))
    * fix(community): prevent author name resolution from setting updatingState to resolving-name ([6e804b8](https://github.com/pkcprotocol/pkc-js/commit/6e804b88d6433a395256a2fbb953a01a89f7a2ed))
    * fix(community): set publicKey in setAddress() for non-domain addresses ([8b38f8c](https://github.com/pkcprotocol/pkc-js/commit/8b38f8c1c41145900e8889ee6beacf7fa95dc461))
    * fix: pass resolved community signature to usePageCidsOfParentToFetchCommentUpdateForReply ([b311da1](https://github.com/pkcprotocol/pkc-js/commit/b311da172e85307d50f04911726d269c17ad93f7))
    * fix(pkc): be stricter about no public key or name ([dd1805e](https://github.com/pkcprotocol/pkc-js/commit/dd1805e2b882c507f6f4b82ad4f28485e6e081a9))
    * fix(rpc): preserve plain Error messages in RPC server→client serialization ([8120f57](https://github.com/pkcprotocol/pkc-js/commit/8120f579567bb21c57a511ff1fedf2f41b628109))
    * fix(rpc): prevent circular error reference from crashing RPC server ([f4d880b](https://github.com/pkcprotocol/pkc-js/commit/f4d880b916dd112efa425a8910b21a8aa7b330ab))
    * fix(rpc): send communityPublicKey/communityName instead of communityAddress in page RPC params ([780214f](https://github.com/pkcprotocol/pkc-js/commit/780214f6eb2ff939ef3f88b2f858f45f809f3801))
    * fix(schema): preserve class-based name resolver instances through Zod parsing ([63ebcc0](https://github.com/pkcprotocol/pkc-js/commit/63ebcc08fece9d0bf448b97a74a348cab75986bc))
    * fix(test): add missing publicKey to delete() mock in garbage collection test ([2d037d3](https://github.com/pkcprotocol/pkc-js/commit/2d037d31d0bca25f03b3bb19406c6ec728e6635a))
    * fix(test): attach event listeners before update() to prevent RPC race condition ([7a25545](https://github.com/pkcprotocol/pkc-js/commit/7a25545bf58b3a5f2f345fbca4c3b67e1d37a77f))
    * fix(test): avoid concurrent test contention in updatingstate regression test ([337bc68](https://github.com/pkcprotocol/pkc-js/commit/337bc6806ea122e08d840fe05635798a313e2090))
    * fix(test): check RPC server is running before executing RPC tests ([6bff826](https://github.com/pkcprotocol/pkc-js/commit/6bff82666aac9b96affc203880855caf69f4e59b))
    * fix(test): log test server output to /tmp/test-server-{config}-{date}.log ([5c94dc2](https://github.com/pkcprotocol/pkc-js/commit/5c94dc2764cd912f0a04732ebc16d2f31ceade07))
    * fix(test): make tests using real Kubo port 15005 sequential ([7da2636](https://github.com/pkcprotocol/pkc-js/commit/7da26366161c229fd042b1febb9c2463cb284908))
    * fix(test): make vitest JSON report path unique per config and environment ([c0df47d](https://github.com/pkcprotocol/pkc-js/commit/c0df47d40fa2f437b85b47205d1c9e0e0549d2c2))
    * fix(test): retry IPNS name.resolve in publishToIpns to avoid transient CI failures ([2b95fa7](https://github.com/pkcprotocol/pkc-js/commit/2b95fa7d70ab8e9ef3197d2f515d5e5436adeb07))
    * fix(test): update tests for silent gateway signature error retry ([a02db14](https://github.com/pkcprotocol/pkc-js/commit/a02db14c793c60c50517256bcf1889787bce1e20))
    * fix(verify): restore community-belongs-to check and fix replies._community timing ([ac3fb67](https://github.com/pkcprotocol/pkc-js/commit/ac3fb677ea2185f3a6d19fa9c49dac5ff88dc617))
* docs: require GitHub issue tracking for feature implementations ([025f50e](https://github.com/bitsocialnet/bitsocial-cli/commit/025f50e))

## <small>0.19.39 (2026-04-12)</small>

* chore: upgrade @pkcprotocol/pkc-js to 0.0.15 ([02cdb46](https://github.com/bitsocialhq/bitsocial-cli/commit/02cdb46))
  * pkc-js [0.0.15](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.15) (2026-04-12)
    * feat(schema): make communityAddress optional in publication creation ([2ad308c](https://github.com/pkcprotocol/pkc-js/commit/2ad308c1ecd843dd05c4b0fb75b83147f745b111))
    * fix(purge): prevent comment edits from being purged during pre-rebranding DB migration ([f339690](https://github.com/pkcprotocol/pkc-js/commit/f339690e6cdf367f1c1ed635e80711f934f67e1b))
    * fix(rpc): send communityName/communityPublicKey instead of communityAddress ([8d03773](https://github.com/pkcprotocol/pkc-js/commit/8d03773fd6e7916b03c638c043f3173335698e34))
* fix(ci): patch oclif to surface makensis errors on Windows ([cf42b55](https://github.com/bitsocialhq/bitsocial-cli/commit/cf42b55))

## <small>0.19.38 (2026-04-11)</small>

* chore: upgrade @pkcprotocol/pkc-js to 0.0.14 ([52176bd](https://github.com/bitsocialhq/bitsocial-cli/commit/52176bd))
  * pkc-js [0.0.14](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.14) (2026-04-11)
    * feat(challenges): generate unique random default challenge answer per community ([f352de3](https://github.com/pkcprotocol/pkc-js/commit/f352de329643b699cc8b84baa2e99bc1adb4b842))
    * fix(challenges): preserve default challenge upgrade path when default structure changes ([e0b4f42](https://github.com/pkcprotocol/pkc-js/commit/e0b4f423ab6a2ac656dffe70c1e87f1d8226411d))
    * fix: prevent _purgeCommentsWithInvalidSchemaOrSignature from purging all comments ([3984f9f](https://github.com/pkcprotocol/pkc-js/commit/3984f9f2bec365df3e8d168db1837346a299682c))
* fix: increase npm network timeout for Docker arm64 builds ([c173a40](https://github.com/bitsocialhq/bitsocial-cli/commit/c173a40))
* fix(ci): restore shell: bash for Windows installer step ([817c76e](https://github.com/bitsocialhq/bitsocial-cli/commit/817c76e))

## <small>0.19.37 (2026-04-11)</small>

* chore: rename @pkc/pkc-logger to @pkcprotocol/pkc-logger ([418587c](https://github.com/bitsocialhq/bitsocial-cli/commit/418587c))
* chore: upgrade @pkcprotocol/pkc-js to 0.0.13 ([c669558](https://github.com/bitsocialhq/bitsocial-cli/commit/c669558))
  * pkc-js [0.0.13](https://github.com/pkcprotocol/pkc-js/releases/tag/v0.0.13) (2026-04-10)
    * fix: rename INTERNAL_SUBPLEBBIT keyv key for pre-rebranding community DBs ([5ee9d35](https://github.com/pkcprotocol/pkc-js/commit/5ee9d35553e974c0070e0eb8d0445c28d61c2ab0))
    * fix: skip write operations when opening db in readonly mode ([62b403f](https://github.com/pkcprotocol/pkc-js/commit/62b403f88c00df5b311342303bd6a7b2b8021488))
* chore: upgrade license to GPL-3.0-or-later ([ff01071](https://github.com/bitsocialhq/bitsocial-cli/commit/ff01071))

## <small>0.19.36 (2026-04-10)</small>

* chore: migrate @pkc/pkc-js to @pkcprotocol/pkc-js from npm registry ([1ccf31a](https://github.com/bitsocialhq/bitsocial-cli/commit/1ccf31a))
* chore: upgrade @plebbit/plebbit-js to @pkc/pkc-js 542952a1 ([e623e32](https://github.com/bitsocialhq/bitsocial-cli/commit/e623e32))
* chore(gitignore): ignore local agent and macOS files ([2b25ae3](https://github.com/bitsocialhq/bitsocial-cli/commit/2b25ae3))
* feat: integrate @bitsocial/bso-resolver for .bso/.eth name resolution ([1cc8685](https://github.com/bitsocialhq/bitsocial-cli/commit/1cc8685))
* fix: migrate mintpass challenge from @mintpass/challenge to @bitsocial/mintpass-challenge ([3db6243](https://github.com/bitsocialhq/bitsocial-cli/commit/3db6243))
* docs: restructure AGENTS.md with prioritized rules and task router ([b63203f](https://github.com/bitsocialhq/bitsocial-cli/commit/b63203f))
* docs(readme): add cli banner image asset ([6f46cb8](https://github.com/bitsocialhq/bitsocial-cli/commit/6f46cb8))
* docs(readme): fix headers ([818bc94](https://github.com/bitsocialhq/bitsocial-cli/commit/818bc94))
* Update README.md ([94b2dec](https://github.com/bitsocialhq/bitsocial-cli/commit/94b2dec))
* Update README.md ([2c9661f](https://github.com/bitsocialhq/bitsocial-cli/commit/2c9661f))

## <small>0.19.35 (2026-03-05)</small>

* chore: upgrade @plebbit/plebbit-js to 10ed04e3 and kubo to 0.40.1 ([afa5101](https://github.com/bitsocialhq/bitsocial-cli/commit/afa5101))

## <small>0.19.34 (2026-02-27)</small>

* chore: upgrade @plebbit/plebbit-js to ca9288c4 ([9be2269](https://github.com/bitsocialhq/bitsocial-cli/commit/9be2269))
* fix(ci): use GNU tar on Windows to fix oclif --force-local error ([e5fbaaa](https://github.com/bitsocialhq/bitsocial-cli/commit/e5fbaaa))

## <small>0.19.33 (2026-02-27)</small>

* fix(docker): use --ignore-scripts to fix arm64 build failure ([55ae002](https://github.com/bitsocialhq/bitsocial-cli/commit/55ae002))
* docs: document Docker log viewing options in README ([2147c45](https://github.com/bitsocialhq/bitsocial-cli/commit/2147c45))

## <small>0.19.32 (2026-02-27)</small>

* fix(ci): skip husky install in non-git contexts to fix tarball generation ([54be9fc](https://github.com/bitsocialhq/bitsocial-cli/commit/54be9fc))

## <small>0.19.31 (2026-02-27)</small>

* fix(ci): add retry logic to tarball generation for transient network failures ([f31cd0f](https://github.com/bitsocialhq/bitsocial-cli/commit/f31cd0f))
* build(deps): update package-lock.json ([9fb9818](https://github.com/bitsocialhq/bitsocial-cli/commit/9fb9818))

## <small>0.19.30 (2026-02-27)</small>

* fix(deps): override react-devtools-core to fix CI dependency conflict ([83f9d0c](https://github.com/bitsocialhq/bitsocial-cli/commit/83f9d0c))
* fix(deps): update plebbit-js and override node-datachannel to fix CI-release ([ec3837e](https://github.com/bitsocialhq/bitsocial-cli/commit/ec3837e))
* fix(docker): skip prepare in deps install and add CI smoke build ([b8ef303](https://github.com/bitsocialhq/bitsocial-cli/commit/b8ef303))

## <small>0.19.29 (2026-02-27)</small>

* chore: migrate repo and CI from yarn to npm ([0b9991c](https://github.com/bitsocialhq/bitsocial-cli/commit/0b9991c))
* chore: remove packageManager field from package.json ([ce21221](https://github.com/bitsocialhq/bitsocial-cli/commit/ce21221))
* fix(release): switch release hook from yarn to npm ([c18e98b](https://github.com/bitsocialhq/bitsocial-cli/commit/c18e98b))

## <small>0.19.28 (2026-02-26)</small>

* chore(deps): upgrade kubo from 0.39.0 to 0.40.0 ([7539af6](https://github.com/bitsocialhq/bitsocial-cli/commit/7539af6))
* test: add CLI command completion time integration tests ([85a6319](https://github.com/bitsocialhq/bitsocial-cli/commit/85a6319))
* fix: clear RPC connection timeout on success to prevent ~20s hang ([41938e7](https://github.com/bitsocialhq/bitsocial-cli/commit/41938e7))

## <small>0.19.27 (2026-02-25)</small>

* fix(ci): use standalone compose file instead of override to remove sysctls ([dd29c08](https://github.com/bitsocialhq/bitsocial-cli/commit/dd29c08))

## <small>0.19.26 (2026-02-25)</small>

* fix(ci): disable sysctls in Docker Publish workflow for GitHub Actions ([1d48ceb](https://github.com/bitsocialhq/bitsocial-cli/commit/1d48ceb))

## <small>0.19.25 (2026-02-25)</small>

* build(deps): upgrade plebbit-js ([2c91b4e](https://github.com/bitsocialhq/bitsocial-cli/commit/2c91b4e))
* fix(docker): increase UDP buffer limits to silence QUIC warning ([db58d53](https://github.com/bitsocialhq/bitsocial-cli/commit/db58d53))

## <small>0.19.24 (2026-02-25)</small>

* build(deps): upgrade plebbit-js ([8ea4797](https://github.com/bitsocialhq/bitsocial-cli/commit/8ea4797))
* fix: add 20s timeout to RPC connection to prevent CLI from hanging forever ([07afc13](https://github.com/bitsocialhq/bitsocial-cli/commit/07afc13))

## <small>0.19.23 (2026-02-23)</small>

* fix(deps): regenerate yarn.lock to resolve stale dependency resolutions ([14dd623](https://github.com/bitsocialhq/bitsocial-cli/commit/14dd623))

## <small>0.19.22 (2026-02-23)</small>

* fix(ci): serialize yarn installs to prevent viem extraction race condition ([2141602](https://github.com/bitsocialhq/bitsocial-cli/commit/2141602))

## <small>0.19.21 (2026-02-23)</small>

* fix(ci): clean yarn cache before install to prevent tar extraction corruption ([a845797](https://github.com/bitsocialhq/bitsocial-cli/commit/a845797))

## <small>0.19.20 (2026-02-23)</small>

* fix(ci): set HUSKY=0 in CI Release to prevent install failures on cache miss ([8317ba3](https://github.com/bitsocialhq/bitsocial-cli/commit/8317ba3))
* fix(docker): serialize yarn installs to prevent viem extraction race condition ([e959b1e](https://github.com/bitsocialhq/bitsocial-cli/commit/e959b1e))

## <small>0.19.19 (2026-02-23)</small>

* fix(docker): increase yarn network timeout to prevent viem extraction failures ([e48965d](https://github.com/bitsocialhq/bitsocial-cli/commit/e48965d))

## <small>0.19.18 (2026-02-23)</small>

* fix(docker): clean yarn cache in builder stage to prevent corrupt layers ([d044b92](https://github.com/bitsocialhq/bitsocial-cli/commit/d044b92))

## <small>0.19.17 (2026-02-23)</small>

* fix: correct BitSocial casing to Bitsocial in daemon output ([1e355bc](https://github.com/bitsocialhq/bitsocial-cli/commit/1e355bc))
* fix(ci): remove invalid github.head_ref from workflow_run checkouts ([09c1d13](https://github.com/bitsocialhq/bitsocial-cli/commit/09c1d13))
* fix(daemon): if daemon fails to start make sure to print an error with latest logs ([7315ad0](https://github.com/bitsocialhq/bitsocial-cli/commit/7315ad0))
* fix(daemon): redirect all debug output to log file, not terminal ([f710aaf](https://github.com/bitsocialhq/bitsocial-cli/commit/f710aaf))
* fix(edit): preserve string values that start with digits ([e33563a](https://github.com/bitsocialhq/bitsocial-cli/commit/e33563a))
* chore: upgrade plebbit-js to cfb998ee6334 ([8278892](https://github.com/bitsocialhq/bitsocial-cli/commit/8278892))
* docs: replace .eth with .bso as default naming system ([e2bc02a](https://github.com/bitsocialhq/bitsocial-cli/commit/e2bc02a))
* test: speed up test suite with file-level parallelism and polling ([e5747ec](https://github.com/bitsocialhq/bitsocial-cli/commit/e5747ec))
* test(challenge): add @mintpass/challenge integration tests ([208093c](https://github.com/bitsocialhq/bitsocial-cli/commit/208093c))
* test(challenge): add integration tests for full challenge lifecycle ([f6fc522](https://github.com/bitsocialhq/bitsocial-cli/commit/f6fc522))
* ci: test docker compose before pushing images ([2c3cc62](https://github.com/bitsocialhq/bitsocial-cli/commit/2c3cc62))
* feat: show debug logs on stderr for non-daemon commands ([8753bd3](https://github.com/bitsocialhq/bitsocial-cli/commit/8753bd3))
* feat(challenge): add challenge package management commands ([4580bf8](https://github.com/bitsocialhq/bitsocial-cli/commit/4580bf8))
* feat(challenge): support all npm specifiers in challenge install ([a1e0cb9](https://github.com/bitsocialhq/bitsocial-cli/commit/a1e0cb9))
* refactor(daemon): type Logger param and use debug logger in _setupLogger ([0e85716](https://github.com/bitsocialhq/bitsocial-cli/commit/0e85716))

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
