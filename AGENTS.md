# AGENTS.md

## Purpose

This file provides curated, minimal guidance for AI agents working in this repo.
Rules are prioritized (MUST > SHOULD) so agents know what to enforce vs. what to prefer.
Detailed workflows live in playbooks loaded on demand — not inlined here.

## Surprise Handling

If something behaves unexpectedly (a test fails for unclear reasons, a build breaks in a surprising way, a dependency does something unusual):

1. **Stop** — do not retry in a loop or force your way through.
2. **Investigate** — read error output, check recent commits, look at related code.
3. **Document** — if you discover a non-obvious gotcha, tell the user so it can be captured.

## Project Overview

**bitsocial-cli** is an oclif-based CLI + daemon for the BitSocial protocol (built on top of plebbit-js). It manages communities, challenges, IPFS nodes, and web UIs from the command line.

## Instruction Priority

| Level  | Meaning                                           |
| ------ | ------------------------------------------------- |
| **MUST**   | Non-negotiable. Breaking these causes failures or bad releases. |
| **SHOULD** | Strong default. Override only with good reason.   |

## Task Router

Quick lookup — find your situation, follow the required actions:

| Situation                  | Do this                                                       |
| -------------------------- | ------------------------------------------------------------- |
| First time / fresh clone   | `nvm use` → `npm ci` → `npm run build`                       |
| Changed any `.ts` file     | `npm run build && npm run build:test`                         |
| Running tests              | `npm run test:cli`                                            |
| Added feature or fixed bug | Write a test → build → run tests                             |
| Installing a dependency    | `nvm use` first, then `npm install ...`                       |
| Before committing          | Build passes, all tests pass                                  |

## Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Runtime     | Node 22 (`nvm use` reads `.nvmrc`)  |
| Language    | TypeScript (ESM, `"type": "module"`)  |
| CLI framework | oclif                             |
| Test runner | Vitest                              |
| Package mgr | **npm** (not yarn, not pnpm)        |
| Build       | `tsc` with configs in `config/`     |

## Project Structure

```
src/
├── cli/
│   ├── commands/        # oclif command implementations
│   │   ├── challenge/   # challenge-related subcommands
│   │   └── community/   # community-related subcommands
│   └── hooks/           # oclif lifecycle hooks (init, prerun)
├── challenge-packages/  # challenge package logic
├── common-utils/        # shared utilities
├── ipfs/                # IPFS/Kubo node management
├── webui/               # web UI download & serving
├── util.ts              # top-level utility helpers
└── index.ts             # package entry point
```

## Core MUST Rules

### Environment Setup

- **MUST** run `nvm use` before any npm command (`npm ci`, `npm install`, `npm run`, etc.).
- **MUST** use **npm**, never yarn or pnpm.

### Build & Test

- **MUST** verify build passes after any code change: `npm run build && npm run build:test`.
- **MUST** run tests with `npm run test:cli` (not `vitest` directly — the script downloads web UIs first).
- **MUST** ensure all tests pass before committing.

### Code Organization

- **MUST** add a test when you add a feature or fix a bug.

## Core SHOULD Rules

- **SHOULD** keep changes focused — avoid unrelated refactors in the same commit.
- **SHOULD** prefer editing existing files over creating new ones.
- **SHOULD** check `config/` for tsconfig and vitest settings before assuming defaults.

## Common Commands

```bash
nvm use                              # switch to project's Node version
npm ci                               # clean install dependencies
npm run build                        # compile TypeScript → dist/
npm run build:test                   # compile test TypeScript
npm run build && npm run build:test  # full build check
npm run test:cli                     # run all tests (downloads web UIs first)
npm run build:watch                  # watch mode for main build
npm run build:test:watch             # watch mode for test build
```

## Playbooks (Load On Demand)

_No playbooks yet. As recurring workflows emerge (e.g., release process, adding a new command, upgrading plebbit-js), create them as separate files and reference them here._

<!-- Example future entry:
- [Adding a new CLI command](playbooks/new-command.md)
- [Upgrading plebbit-js](playbooks/upgrade-plebbit-js.md)
-->
