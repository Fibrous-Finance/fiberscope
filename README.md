# Fiberscope

Open-source analytics for [CoW Protocol](https://cow.fi) solvers, starting with Base.

Live for Base at [fiberscope.kermo.workers.dev](https://fiberscope.kermo.workers.dev).

CoW Protocol settles user orders through batch auctions in which solvers compete to find the best
settlement. Fiberscope shows who wins those auctions, by how much, whether that is changing, and
how efficiently each solver settles: batches, trades, volume, gas, and the auction-level
competition (who enters and who wins).

## Why

CoW's [Solver Info](https://dune.com/cowprotocol/solver-info) dashboard lives on Dune. Since
September 10, 2026, Dune's free plan is view-only for accounts created before July 21, 2026
([Dune's announcement](https://x.com/Dune/status/2092614403342352418)): they can browse dashboards
but not run queries, so they can no longer refresh this one or change its parameters. Fiberscope
rebuilds that view from public data, free to view and updated every 10 minutes, and adds the
auction-level view: which solvers enter each auction and how often they win.

## What the page shows

- **Who is winning:** share of batches, trades or volume per solver over 24 hours, 7, 30, 90 or
  180 days, with rank changes, entry and win rates, and each solver's addresses and latest
  settlements.
- **Is it changing:** the daily share of the leading solvers, and the daily total across all
  solvers.
- **Who enters, who wins:** participation and win rate from CoW's solver-competition data, and a
  tape of the latest auctions.
- **How efficiently:** gas per trade and DEX swaps per trade, against the network average.
- **Methodology:** every definition, on the page itself.

## How it works

```text
Base RPC (settlement events, receipts, Chainlink ETH/USD) ─┐
CoW API (solver competition, native prices)               ─┼─> apps/indexer ─> snapshot.json ─> apps/web
CoW solver registry + on-chain allow-list                 ─┘      (SQLite)
```

| Package         | What it is                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/indexer`  | Node 24 and no third-party dependencies (`node:sqlite`). Each run catches up with the chain head, writes the snapshot, then backfills history within a time budget, so the site stays fresh during long backfills. |
| `packages/core` | The snapshot contract, the view model (windows, shares, ranks, competition), number and date formatting, and the chart geometry. Tested with `node:test`.                                                          |
| `apps/web`      | Next.js 16 (App Router, React Compiler), Tailwind CSS 4 and next-intl. English only for now; the page's copy goes through next-intl. Runs on Cloudflare Workers through OpenNext.                                  |

### Data sources

| Source                                                                                                                    | Provides                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GPv2Settlement` (`0x9008D19f58AAbD9eD0D60971565AA8510560ab41`): `Settlement`, `Trade` and `Interaction` events, receipts | Batches, trades, DEX swaps, gas, and the transaction's sender and recipient                                                                                                                |
| CoW API `GET /api/v2/solver_competition/by_tx_hash/{tx}`                                                                  | Every solution in the auction (solver, ranking, winner), native prices                                                                                                                     |
| [CoW's solver registry](https://cms.cow.fi/api/solver-networks), plus overrides in `apps/indexer/src/overrides.ts`        | Solver names and their prod and barn addresses; an address the registry marks inactive is retired. An override adds an address that is allow-listed on-chain but missing from the registry |
| `GPv2AllowListAuthentication` `isSolver`                                                                                  | Whether a flash-loan router settlement's sender or recipient is a solver, for attribution                                                                                                  |
| Chainlink ETH/USD on Base                                                                                                 | The dollar rate at each settlement: the latest answer at or before its block                                                                                                               |
| ERC-20 `symbol()`                                                                                                         | Token symbols for the latest settlements' pairs                                                                                                                                            |

### Methodology in brief

- **Batch:** one settlement (a `Settlement` event, one call to `settle`) that filled at least one
  order; a transaction can carry more than one, and its gas is split evenly between them.
  Zero-trade settlements (buffer movements) are not counted.
- **Volume:** each trade counts at the lower of its sell and buy value, priced with the token
  prices CoW used in that auction and Chainlink's ETH/USD rate at settlement. A trade priced on one
  side only counts at that side; a trade priced on neither adds nothing.
- **Attribution:** a settlement is credited to the solver that submitted it. Settlements sent
  through CoW's flash-loan router are credited to the solver behind them: the transaction's
  recipient when it is a registered or allow-listed solver, otherwise its sender when that is one,
  otherwise the winner of that settlement in CoW's competition data, and as a last resort the
  sender.
- **Entered / win rate:** the share of auctions (that ended in a settlement) in which a solver
  submitted a solution, and the share of those it won, alone or with other winners.
- **Windows:** rolling, ending at the last indexed block. When the history behind a window is
  shorter than the window, the page says so instead of extrapolating.

The full definitions are in the page's Methodology section
(`apps/web/messages/en/methodology.json`).

## Validation

**Against CoW's Dune dashboard.** For blocks 50,409,187–51,705,186 (the 30 days to September 23,
2026, 21:42 UTC), the Base figures read from CoW's
[Solver Info](https://dune.com/cowprotocol/solver-info) dashboard on that window and Fiberscope's
figures for the same blocks differ by about 0.1%:

| Measure       | Dune    | Fiberscope | Difference |
| ------------- | ------- | ---------- | ---------- |
| Batches       | 76,873  | 76,954     | +0.11%     |
| Trades        | 80,808  | 80,892     | +0.10%     |
| DEX swaps     | 116,034 | 116,166    | +0.11%     |
| Gas per trade | 730.6K  | 730.7K     | +0.01%     |

A recount from the Base RPC for five solvers matched the database exactly.

**Attribution against CoW's competition data.** For blocks 51,811,228–52,115,823 (September 26,
2026, 08:36 UTC to October 3, 2026, 09:49 UTC), all 24,534 batches had a winning solution for
their transaction in CoW's competition data, and every batch was credited to that solution's
solver address: 24,534 of 24,534. Of these, 1,230 went through the flash-loan router: 397 were
credited to the transaction's recipient and 833 to its sender, and all 1,230 match the winner.
None of them fell back to CoW's winner, so this check does not depend on the competition data
it is compared with.

## Running it locally

Requires Node 24 and pnpm 10.

```sh
pnpm install

# Index Base from the public RPC. The first run backfills, which can take hours at the default
# request rates; later runs fetch only what is new.
cd apps/indexer
node src/cli.ts sync --chain-days 30 --auction-days 7 --snapshot ../web/data/snapshot.json
cd ../..

# The web app reads apps/web/data/snapshot.json.
pnpm dev   # http://localhost:3000
```

To keep the data live, rerun `sync` on a schedule with `--budget-minutes` set to the interval: the
backfill stops when the next run is due, so long backfills never hold up fresh data and no time
between runs is idle. `apps/indexer/loop.sh` does this: it runs `sync` with its arguments every
`REFRESH_MINUTES` (whole minutes, default 10, counted from the start of each run).

```sh
REFRESH_MINUTES=10 sh apps/indexer/loop.sh --chain-days 30 --auction-days 7 --budget-minutes 10 \
  --snapshot ../web/data/snapshot.json
```

The indexer's `sync` and `snapshot` scripts, and each `sync` that `loop.sh` starts, read
`apps/indexer/.env` when it exists. `loop.sh` itself reads `REFRESH_MINUTES`, `SEED_DB_URL` and
`DB_PATH` from its environment, not from `.env`.

`node src/cli.ts seed --url <url>` downloads the database from a URL, e.g. a presigned R2 link,
when there is none yet, so a new host does not index again. It never overwrites a database and
checks the download's integrity before using it. `loop.sh` runs it first when `SEED_DB_URL` is set
and `DB_PATH` does not exist.

| Variable                                                            | Used by | Purpose                                                                                                                                                         |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_RPC_URL`                                                      | indexer | Base RPC endpoint (default `https://mainnet.base.org`)                                                                                                          |
| `DB_PATH`                                                           | indexer | The SQLite database (default `apps/indexer/.data/base.db`); `--db` overrides it                                                                                 |
| `BASE_RPC_RPS`, `COW_API_RPS`                                       | indexer | Request rates per second for the RPC and CoW's API (defaults 15 and 3)                                                                                          |
| `REFRESH_MINUTES`                                                   | indexer | `loop.sh`'s interval and, through the snapshot, the live page's refetch interval (default 10). The page shows Delayed once the data is more than 30 minutes old |
| `SEED_DB_URL`                                                       | indexer | With `loop.sh`, download the database from this URL when `DB_PATH` does not exist                                                                               |
| `SNAPSHOT_R2_BUCKET`                                                | indexer | Also upload every snapshot to this R2 bucket, through R2's S3 API; needs the variables below                                                                    |
| `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | indexer | The account, and the S3 credentials of an R2 API token with Object Read & Write on that bucket only                                                             |
| `SNAPSHOT_R2_KEY`                                                   | both    | The snapshot's object key (default `base/snapshot.json`); the Worker reads it through its `SNAPSHOTS` binding                                                   |
| `SNAPSHOT_PATH`                                                     | web     | The local snapshot file when `SNAPSHOT_R2_KEY` is unset (default `apps/web/data/snapshot.json`)                                                                 |
| `SITE_URL`                                                          | web     | The site's origin, for absolute link-preview URLs (default `http://localhost:3000`)                                                                             |
| `ALLOW_INDEXING`                                                    | web     | `true` lets search engines index the site; otherwise every page is `noindex`                                                                                    |

## Checks

```sh
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

CI runs the same checks on every pull request and every push to `main` (`.github/workflows/ci.yml`).

## Deploying

The web app runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare).
`apps/web/wrangler.jsonc` binds the R2 bucket `fiberscope-data` as `SNAPSHOTS` and sets the
Worker's variables. `pnpm --filter @fiberscope/web run deploy` builds and deploys; `run preview`
serves the Workers build locally, with `apps/web/.dev.vars` overriding variables.

`.github/workflows/deploy.yml` deploys `main` and uploads a preview version for each pull request
(`https://pr-<number>-fiberscope.<subdomain>.workers.dev`) once the `CLOUDFLARE_API_TOKEN` (an
"Edit Cloudflare Workers" token) and `CLOUDFLARE_ACCOUNT_ID` secrets and the
`CLOUDFLARE_WORKERS_SUBDOMAIN` variable are set.

The indexer runs anywhere Node 24 runs. It needs a persistent disk for its database and
`SNAPSHOT_R2_BUCKET`, so every snapshot reaches the site. Its key is an R2 API token limited to
Object Read & Write on that one bucket (R2 → Manage API tokens); the indexer signs S3 requests
with the token's S3 credentials, so it can write nowhere else in the account.
`apps/indexer/Dockerfile` builds an image that runs `loop.sh`, from the repository root:

```sh
docker build -f apps/indexer/Dockerfile -t fiberscope-indexer .
docker run -v fiberscope-data:/data --env-file apps/indexer/.env fiberscope-indexer
```

The database (`DB_PATH=/data/base.db`) and the local snapshot live on the volume at `/data`. The
live indexer runs from this image on [Railway](https://railway.com), with a volume at `/data`.
`SEED_DB_URL` moves it to a new host with the existing database.

## Status

- [x] Data feasibility check against Base mainnet
- [x] Design
- [x] Indexer for Base, cross-checked against Dune (see [Validation](#validation))
- [x] Web app
- [x] Site on Cloudflare Workers, data in R2
- [ ] Always-on hosting for the indexer
- [ ] Public launch and CoW Grants application
- [ ] More CoW Protocol networks: Ethereum, Arbitrum One, Gnosis Chain, and others

## License

[MIT](LICENSE)
