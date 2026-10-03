# Contributing

Bug reports, corrections to a figure or a definition, and pull requests are welcome. For a
vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Setup

Node 24 and pnpm 10:

```sh
pnpm install
```

The site needs data to show: [docs/development.md](docs/development.md#run-the-site) indexes a day
of Base in one command and starts the site.

## Checks

Run these before you push; CI runs the same checks on every pull request.

```sh
pnpm format && pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Code style

- TypeScript, strict. Node 24 runs the indexer and `packages/core` without a build step, so the
  code uses only syntax that types can be stripped from: no enums, namespaces or parameter
  properties.
- `apps/indexer` and `packages/core` have no third-party dependencies; they use Node's built-ins
  (`node:sqlite`, `fetch`, `node:test`).
- Prettier formats everything: tabs (width 4), lines up to 100 characters, double quotes, trailing
  commas where ES5 allows them, and sorted imports. `pnpm format` applies it.
- A rule that decides a figure is a pure function with tests next to it (`*.test.ts`). When a
  definition changes, change its test, the site's Methodology text and
  [docs/methodology.md](docs/methodology.md) in the same pull request.

## Copy

- English, with US spelling. Dates are day-first: "3 Oct 2026".
- Every reader-facing string lives in `apps/web/messages/en/*.json` and goes through next-intl,
  with plurals ("1 batch", "2 batches").
- A no-break space joins a number and its unit ("24 hours", "133 bps"), comes before "UTC", and
  sits inside dates.
- No internal terms in reader-facing text: the page never says "indexer", "snapshot" or
  "backfill".
- Every sentence must stay true on real data and at the edges: ties, no data, a window longer than
  the history.

## Neutrality

- Every solver is measured, ranked and shown the same way, in code, copy and design.
- Fibrous builds Fiberscope and also runs a solver. On the site it appears as the builder only in
  the footer's credit, which says so: "Built by Fibrous, which also runs a solver".
- Copy and docs never use a real solver as a generic example.
- The site states "Independent project, not affiliated with CoW DAO."

## Pull requests

1. Branch from `main` and keep each pull request to one change.
2. Open the pull request. CI runs the checks. A pull request from a branch of this repository also
   gets a preview of the site at `https://pr-<number>-fiberscope.kermo.workers.dev`, linked in a
   comment; pull requests from forks run the checks without a preview.
3. Pull requests are squash-merged into `main`, which deploys the site.

## Commits

A type and an optional scope, then a subject in the imperative; the body says why the change is
needed and what it does, in plain sentences wrapped at 100 characters:

```text
fix(indexer): give sync the env file only when .env exists

The container has no .env, so node's --env-file-if-exists logged ".env not found. Continuing
without it." on every run. loop.sh now passes --env-file=.env only when apps/indexer/.env exists;
each run still reads it when it does.
```

Types: `feat`, `fix`, `perf`, `docs`, `ci`, `chore`. Scopes: `web`, `indexer`, `core`.

## License

Contributions are licensed under the [MIT License](LICENSE), like the rest of the project.
