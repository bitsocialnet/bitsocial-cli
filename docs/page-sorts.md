# Page sort packages

A page sort package is an npm package whose default export is a pkc-js page sort factory. Installing one registers it into `PKC.pageSorts` under its **package name**, so a community can name it in `settings.pages.posts[i].name` or `settings.pages.replies[i].name`, the same way it names a pkc-js built-in sort such as `hot`.

Install, storage, loading and hot reload work exactly as for challenge packages ([challenges.md](challenges.md)); this doc repeats the essentials and covers what is specific to page sorts: `sortName` and the in-use check on remove.

## Commands

```bash
bitsocial page-sort install <package>   # aliases: i, add
bitsocial page-sort list                # alias: ls; -q prints names only
bitsocial page-sort remove <name>       # aliases: uninstall, rm, un; --force skips the in-use check
```

```bash
bitsocial page-sort install @pkcprotocol/active-page-sort
bitsocial page-sort install @pkcprotocol/active-page-sort@1.0.0
bitsocial page-sort install ./my-local-page-sort
```

`install` accepts anything `npm pack` accepts (name, name@version, git URL, tarball URL, local path). All commands take `--pkcOptions.dataPath`; `install` and `remove` take `--pkcRpcUrl` (default `ws://localhost:9138`).

## Where packages live

```
<dataPath>/page-sorts/<name>/
<dataPath>/page-sorts/@scope/<name>/
```

## Package name vs `sortName`

Two names matter:

- **Package name** (`@pkcprotocol/active-page-sort`): the key in `PKC.pageSorts`, and what `settings.pages.posts[i].name` refers to.
- **`sortName`** (e.g. `active`): declared by the package itself. It is the key the community publishes pages under in `pageCids`, so it is what clients and frontends ask for.

They need not match. `list` shows both:

```
/home/me/.local/share/bitsocial/page-sorts
└── @pkcprotocol/active-page-sort@1.0.0 (sortName: active)
```

A package that fails to import shows `(failed to load: <error>)` in place of its `sortName`. The rest of the listing still prints.

### Upgrades that change `sortName`

`install` reads the `sortName` of the version being replaced before swapping in the new one. If it differs, the install still goes through, and it warns:

```
Warning: @scope/my-sort changed its sortName from "active" to "activity". Communities using it now publish
these pages under "activity", and clients asking for "active" will not find them.
```

pkc-js accepts the new name, but every community using the package switches the `pageCids` key on its next update, so frontends hard-coded to the old key stop finding the pages. Pin the previous version (`install <name>@<old version>`) if that is not intended. A previous install that no longer loads is not compared and does not block the upgrade.

## What install validates

The new package is imported and checked with pkc-js `validatePageSortFileFactory` **before** it replaces anything. A challenge package, or anything else that is not a page sort factory, is refused and leaves the existing install untouched. Steps otherwise match [challenges.md › What install does](challenges.md#what-install-does).

## How the daemon loads them

Same mechanism as challenges ([details](challenges.md#how-the-daemon-loads-them)):

- At start, `bitsocial daemon` logs `Loaded page sort packages: name@version, ...`.
- After `install`/`remove`, the CLI POSTs `/api/page-sorts/reload` (local) or `/<authKey>/api/page-sorts/reload` (remote). It is best-effort: with no daemon running the change applies at the next start. `install` prints `reloaded <name>@<version>` only when the daemon reports that version loaded, and warns otherwise; `remove` warns when the daemon still lists the package or failed to reload.
- Running communities pick up the new registry on their next cycle; nothing is restarted.

### Shadowing a built-in

pkc-js built-in sorts: `hot`, `new`, `old`, `best`, `top`, `topHour`, `topDay`, `topWeek`, `topMonth`, `topYear`, `topAll`, `active`, `controversial`, `newFlat`, `oldFlat`. A package with the same name as a built-in replaces it for this daemon. `remove` puts the built-in back on the next reload.

## Using a page sort in a community

`settings.pages` lists which sorts to generate per scope (`posts`, `replies`). Leaving it unset generates the pkc-js default sorts. Any change regenerates every CommentUpdate.

```bash
bitsocial community edit mycommunity.bso \
  '--settings.pages.posts[0].name' @pkcprotocol/active-page-sort \
  '--settings.pages.posts[0].options.noBumpKeywords' sage \
  '--settings.pages.posts[0].preloaded' true
```

Fields of each entry:

| Field | Meaning |
| --- | --- |
| `name` | Key in `PKC.pageSorts`: a built-in or an installed package name |
| `path` | Alternative to `name`: path to a page sort JS file |
| `options` | Passed to the sort. `maxAge` (`"7d"`, `"2w"`), `pinnedFirst` and the `exclude*` flags are reserved options every sort accepts |
| `preloaded` | Embed the first page in the record. The first preloaded entry is the client's default sort |
| `privateOptions` | Option names withheld from the public `community.pageSorts`. Reserved options cannot be private |

Quote the flags in the shell: the `[0]` brackets are glob characters, and zsh refuses to run the command when they match no file.

## Removing

```bash
bitsocial page-sort remove @pkcprotocol/active-page-sort
```

`remove` first checks that the package is installed, without contacting the daemon. Then it connects to the daemon at `--pkcRpcUrl` and checks every community's `settings.pages`. If any entry names the package, it refuses and lists them (oclif prefixes each output line with ` ›   `):

```
Error: Page sort "@pkcprotocol/active-page-sort" is still used by:
  - mycommunity.bso settings.pages.posts[0]
Change or remove those entries first, e.g. bitsocial community edit <address> --jsonFile <file with the new settings.pages>,
or pass --force to remove it anyway (the communities keep publishing without this sort).
```

The reason: a community whose `settings.pages` names a missing sort keeps publishing but skips that entry and logs an error on every start, so the board silently loses the sort.

- **The daemon must be running** for the check. If it cannot be reached, `remove` refuses and says so.
- **`--force`** skips the check and doesn't contact the daemon for it. After removing, it prints a warning that any community still naming the package keeps publishing without this sort.

## Troubleshooting

- **`list` shows `failed to load`:** the package's entry point throws on import, or its export fails `validatePageSortFileFactory`. Reinstall a working version.
- **Daemon log `Failed to load page sort "<name>"`:** same cause, seen at start or reload. A previously loaded version keeps serving.
- **Pages missing under the expected key:** compare the `sortName` in `page-sort list` with what the client requests. See [Upgrades that change sortName](#upgrades-that-change-sortname).
- **`remove` says it cannot check usage:** start the daemon (or point `--pkcRpcUrl` at it), or pass `--force`.

## Writing a page sort package

The factory contract (`sortName`, `score`, options, the client-side re-sort with `publicOptions`) is defined by pkc-js; see [page-sorts.md in pkc-js](https://github.com/pkcprotocol/pkc-js/blob/master/docs/protocol/page-sorts.md). The package's `main` (default `index.js`) must default-export the factory. Test it locally with `bitsocial page-sort install ./path/to/package` and check the `sortName` in `bitsocial page-sort list`.
