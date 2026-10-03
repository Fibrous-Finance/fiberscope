# Fiberscope

Open-source analytics for [CoW Protocol](https://cow.fi) solvers, starting with Base.

Live for Base at [fiberscope.kermo.workers.dev](https://fiberscope.kermo.workers.dev).

CoW Protocol settles user orders through batch auctions in which solvers compete to find the best
settlement. Fiberscope shows who wins those auctions, by how much, whether that is changing, and
how efficiently each solver settles: batches, trades, volume, gas, and the auction-level
competition (who enters and who wins).

## Why

CoW's [Solver Info](https://dune.com/cowprotocol/solver-info) dashboard lives on Dune. Since
10 September 2026, Dune's legacy free accounts are view-only, so most viewers can no longer refresh
it or change its parameters. Fiberscope rebuilds that view from public data, free to view and
updated every few minutes, and adds what the Dune dashboard never showed: which solvers enter each
auction and how often they win.

## What the page shows

- **Who is winning:** share of batches, trades or volume per solver over 24 hours, 7, 30 or 90 days,
  with rank changes, entry and win rates, and each solver's addresses and latest settlements.
- **Is it changing:** the daily share of the leading solvers.
- **Who enters, who wins:** participation and win rate from CoW's solver-competition data, and a
  tape of the latest auctions.
- **How efficiently:** gas per trade against the network average.
- **Methodology:** every definition, on the page itself.

## How it works

```text
Base RPC (settlement events, receipts, Chainlink ETH/USD) ─┐
CoW API (solver competition, native prices)               ─┼─> apps/indexer ─> snapshot.json ─> apps/web
CoW solver registry + on-chain allow-list                 ─┘      (SQLite)
```

| Package         | What it is                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/indexer`  | Node 24, no dependencies (`node:sqlite`). Each run catches up with the chain head, writes the snapshot, then backfills history within a time budget, so the site stays fresh during long backfills. |
| `packages/core` | The snapshot contract, the view model (windows, shares, ranks, competition), number and date formatting, and the chart geometry. Tested with `node:test`.                                           |
| `apps/web`      | Next.js 16 (App Router, React Compiler), Tailwind CSS 4 and next-intl. English only for now; every string goes through next-intl. Runs on Cloudflare Workers through OpenNext.                      |

### Data sources

| Source                                                                                                     | Provides                                                               |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GPv2Settlement` (`0x9008D19f58AAbD9eD0D60971565AA8510560ab41`): `Settlement` and `Trade` events, receipts | Batches, trades, gas, and the transaction's sender and recipient       |
| CoW API `GET /api/v2/solver_competition/by_tx_hash/{tx}`                                                   | Every solution in the auction (solver, ranking, winner), native prices |
| [CoW's solver registry](https://cms.cow.fi/api/solver-networks) and `GPv2AllowListAuthentication`          | Solver names and their prod and barn addresses                         |
| Chainlink ETH/USD on Base                                                                                  | The dollar rate at each settlement                                     |

### Methodology in brief

- **Batch:** a settlement transaction that filled at least one order. Zero-trade settlements
  (buffer movements) are not counted.
- **Volume:** each trade counts at the lower of its sell and buy value, priced with the token
  prices CoW used in that auction and Chainlink's ETH/USD rate at settlement.
- **Attribution:** settlements sent through CoW's flash-loan router are credited to the solver
  behind them: the transaction's recipient when it is a solver contract, otherwise its sender, and
  as a last resort the auction's winner from CoW's API.
- **Entered / win rate:** the share of auctions (that ended in a settlement) in which a solver
  submitted a solution, and the share of those it won, alone or with other winners.
- **Windows:** rolling, ending at the last indexed block. When the history behind a window is
  shorter than the window, the page says so instead of extrapolating.

The full definitions are in the page's Methodology section
(`apps/web/messages/en/methodology.json`).

## Running it locally

Requires Node 24 and pnpm 10.

```sh
pnpm install

# Index Base from the public RPC. The first run backfills; later runs catch up in seconds.
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
REFRESH_MINUTES=10 sh apps/indexer/loop.sh --budget-minutes 10 --snapshot ../web/data/snapshot.json
```

The indexer's `sync` and `snapshot` scripts, and each `sync` that `loop.sh` starts, read
`apps/indexer/.env` when it exists.

`node src/cli.ts seed --url <url>` downloads the database from a URL, e.g. a presigned R2 link,
when there is none yet, so a new host does not index again. It never overwrites a database and
checks the download's integrity before using it. `loop.sh` runs it first when `SEED_DB_URL` is set
and `DB_PATH` does not exist; both must be set in the environment, not in `.env`.

| Variable                                                            | Used by | Purpose                                                                                                       |
| ------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `BASE_RPC_URL`                                                      | indexer | Base RPC endpoint (default `https://mainnet.base.org`)                                                        |
| `DB_PATH`                                                           | indexer | The SQLite database (default `apps/indexer/.data/base.db`); `--db` overrides it                               |
| `BASE_RPC_RPS`, `COW_API_RPS`                                       | indexer | Request rates for the RPC and CoW's API                                                                       |
| `REFRESH_MINUTES`                                                   | indexer | The schedule the page expects, and `loop.sh`'s interval; data older than three runs shows as delayed          |
| `SEED_DB_URL`                                                       | indexer | With `loop.sh`, download the database from this URL when `DB_PATH` does not exist                             |
| `SNAPSHOT_R2_BUCKET`                                                | indexer | Also upload every snapshot to this R2 bucket, through R2's S3 API; needs the variables below                  |
| `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | indexer | The account, and the S3 credentials of an R2 API token with Object Read & Write on that bucket only           |
| `SNAPSHOT_R2_KEY`                                                   | both    | The snapshot's object key (default `base/snapshot.json`); the Worker reads it through its `SNAPSHOTS` binding |
| `SNAPSHOT_PATH`                                                     | web     | The local snapshot file when `SNAPSHOT_R2_KEY` is unset (default `data/snapshot.json`)                        |
| `SITE_URL`                                                          | web     | The site's origin, for absolute link-preview URLs                                                             |
| `ALLOW_INDEXING`                                                    | web     | `true` lets search engines index the site; otherwise every page is `noindex`                                  |

## Checks

```sh
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

The same run on every pull request (`.github/workflows/ci.yml`).

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

The database (`DB_PATH=/data/base.db`) and the local snapshot live on the volume at `/data`. Until
its permanent server is decided, the indexer runs from this image on
[Railway](https://railway.com), with a volume at `/data`. `SEED_DB_URL` moves it to a new host
with the existing database.

## Status

- [x] Data feasibility check against Base mainnet
- [x] Design ([docs/design-brief.md](docs/design-brief.md))
- [x] Indexer for Base, validated against an independent 24-hour measurement
- [x] Web app
- [x] Site on Cloudflare Workers, data in R2
- [ ] Always-on hosting for the indexer
- [ ] Public launch and CoW Grants application
- [ ] More CoW Protocol networks: Ethereum, Arbitrum One, Gnosis Chain, and others

## License

[MIT](LICENSE)
