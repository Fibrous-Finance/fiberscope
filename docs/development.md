# Development

How to run Fiberscope locally, how the indexer works, and how the site and the indexer are
deployed.

## Requirements

Node 24 and pnpm 10 (`.nvmrc` and the `packageManager` field in `package.json` pin them).

```sh
pnpm install
```

## Run the site

The site reads a snapshot: one JSON file, written by the indexer, that holds every figure the page
shows. Index a day of Base to get one:

```sh
cd apps/indexer
node src/cli.ts sync --chain-days 1 --auction-days 1 --snapshot ../web/data/snapshot.json
cd ../..
pnpm dev   # http://localhost:3000
```

From an empty database, that `sync` takes about 20 minutes at the default request rates, most of
it spent looking up the day's auctions in CoW's API. More history takes longer: 30 days of
settlements and 7 days of auctions take hours. A run can be stopped and started again; it resumes
where it stopped, and later runs fetch only what is new.

`pnpm dev` reads `apps/web/data/snapshot.json`. To use a snapshot file from elsewhere, give its
absolute path:

```sh
SNAPSHOT_PATH=/path/to/snapshot.json pnpm dev
```

Without a snapshot the page shows its error state. The page's view is in its query string:
`?period=7d&measure=volume&solver=<id>` opens a solver's detail for 7 days of volume.

`pnpm build` builds the site for production, and `pnpm --filter @fiberscope/web start` serves that
build.

## The indexer

`apps/indexer` reads data from Base and CoW's API into a SQLite database
(`apps/indexer/.data/base.db`) and writes the snapshot from it. Node 24 runs the indexer's
TypeScript directly. The indexer has no build step or third-party dependencies; it uses
`node:sqlite` for SQLite.

### Commands

Run them from `apps/indexer`. Every command takes `--db <path>`; `node src/cli.ts --help` prints
the same summary.

| Command                                                                                             | What it does                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node src/cli.ts sync [--chain-days N] [--auction-days M] [--budget-minutes B] [--snapshot <path>]` | Catches up with the chain head, then backfills at least N days of settlements and M days of auctions. With `--snapshot`, writes the snapshot once the head is caught up, and again if the backfill added history. With `--budget-minutes`, the backfill stops B minutes after the start, and the next run resumes it. |
| `node src/cli.ts snapshot [--out <path>]`                                                           | Writes the snapshot from the database (default `apps/web/data/snapshot.json`).                                                                                                                                                                                                                                        |
| `node src/cli.ts window --from <block> --to <block>`                                                | Prints totals and the per-solver table for a block range, from the database.                                                                                                                                                                                                                                          |
| `node src/cli.ts seed --url <url>`                                                                  | Downloads a database from `<url>` when there is none yet, so a new host does not index again. It never overwrites a database and runs SQLite's integrity check on the download before using it.                                                                                                                       |

The package's `sync` and `snapshot` scripts (`pnpm --filter @fiberscope/indexer snapshot`, with the
same options) also read `apps/indexer/.env` when it exists.

### What a sync does

1. Refreshes CoW's solver registry; if the registry is unavailable, it uses the last copy.
2. Catches up: settlements, receipts and calldata up to 20 blocks below the chain head, then the
   auctions behind the new settlements.
3. Marks the data current and, with `--snapshot`, writes the snapshot.
4. Backfills, newest first, until it reaches the requested depth or exhausts the time budget:
   settlements, followed by their auction lookups. Settlement history is kept at least as deep as
   auction history.
5. Writes the snapshot again if the history grew.

On an empty database there is nothing to catch up: the backfill starts at the chain head and the
snapshot is written once it ends. Every step commits as it goes, so an interrupted run loses
nothing. Requests are paced: by default at most 15 RPC calls per second (`eth_call` at a thirtieth
of that, the public RPC's tightest limit) and 3 CoW API requests per second, slowing down when a
server answers that the rate is too high.

### Keep it running

`apps/indexer/loop.sh` runs `sync` with its arguments every `REFRESH_MINUTES` (whole minutes,
default 10), counted from the start of each run; a failed run is logged and the next one runs on
schedule. Set `--budget-minutes` to the interval: the backfill stops when the next run is due, so
fresh data never waits for a long backfill, and while history is being filled no time between runs
is idle.

```sh
REFRESH_MINUTES=10 sh apps/indexer/loop.sh --chain-days 30 --auction-days 7 --budget-minutes 10 \
  --snapshot ../web/data/snapshot.json
```

`loop.sh` runs from `apps/indexer`, so relative paths start there. It reads `REFRESH_MINUTES`,
`SEED_DB_URL` and `DB_PATH` from its own environment; each `sync` it starts reads
`apps/indexer/.env` when it exists. With `SEED_DB_URL` set and no database at `DB_PATH`, it first
downloads the database with `seed`.

## Configuration

| Variable                                                            | Used by | Purpose                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_RPC_URL`                                                      | indexer | Base RPC endpoint (default `https://mainnet.base.org`)                                                                                                                                                                      |
| `DB_PATH`                                                           | indexer | The SQLite database (default `apps/indexer/.data/base.db`); `--db` overrides it                                                                                                                                             |
| `BASE_RPC_RPS`, `COW_API_RPS`                                       | indexer | Request rates per second for the RPC and CoW's API (defaults 15 and 3)                                                                                                                                                      |
| `REFRESH_MINUTES`                                                   | indexer | `loop.sh`'s interval (default 10). Through the snapshot, an open page also learns when the next run is due and fetches a minute after it. At any interval, the page shows Delayed once its data is more than 30 minutes old |
| `SEED_DB_URL`                                                       | indexer | With `loop.sh`, download the database from this URL when `DB_PATH` does not exist                                                                                                                                           |
| `SNAPSHOT_R2_BUCKET`                                                | indexer | Also upload every snapshot to this R2 bucket, through R2's S3 API; needs the variables below                                                                                                                                |
| `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | indexer | The account, and the S3 credentials of an R2 API token with Object Read & Write on that bucket only                                                                                                                         |
| `SNAPSHOT_R2_KEY`                                                   | both    | The snapshot's object key: where the indexer uploads it (default `base/snapshot.json`) and what the site reads through its `SNAPSHOTS` binding. If `SNAPSHOT_R2_KEY` is unset, the site reads the local file                |
| `SNAPSHOT_PATH`                                                     | web     | The local snapshot file when `SNAPSHOT_R2_KEY` is unset (default `apps/web/data/snapshot.json`)                                                                                                                             |
| `SITE_URL`                                                          | web     | The site's origin (default `http://localhost:3000`): absolute link-preview URLs, the canonical link, the sitemap, and the one host search engines may index                                                                 |
| `ALLOW_INDEXING`                                                    | web     | `true` lets search engines index requests to `SITE_URL`'s host; other hosts, pull-request previews included, stay `noindex`. Without it, every page is `noindex`                                                            |

On Cloudflare, the site's variables come from `vars` in `apps/web/wrangler.jsonc`.

## The snapshot

`packages/core/src/snapshot.ts` defines the snapshot, the contract between the indexer and the
site; the indexer writes it and the site derives every view from it with the view model in
`packages/core/src/view`.

- Time is cut into rolling days that end at the newest block (`end`). Daily series are newest first
  and zero-filled, so index `d` is always the day `d` days back.
- `coverage` says how many days hold complete data: `chainDays` for batches, trades, DEX swaps,
  gas and transaction cost; `auctionDays` for volume, entries and wins; `surplusDays` for surplus.
- `solvers` holds each solver's identity, addresses and daily series, and its latest settlements;
  `auctions`, `latestAuctions`, `latestSettlements` and `registry` hold the rest of the page.
- `schema` is `1`. Additive changes keep it; a breaking change bumps it, and the site refuses a
  snapshot whose schema it does not know.

The live snapshot is about 255 KB.

## Checks

```sh
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`pnpm format` fixes formatting. Tests use `node:test` and sit next to the code they test
(`*.test.ts` in `packages/core` and `apps/indexer`). CI runs the same checks on every pull request
and every push to `main` (`.github/workflows/ci.yml`).

## Deployment

### The site

The site runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare).
`apps/web/wrangler.jsonc` binds the R2 bucket `fiberscope-data` as `SNAPSHOTS` and sets the
Worker's variables. From the repository root:

```sh
pnpm --filter @fiberscope/web run deploy    # build and deploy
pnpm --filter @fiberscope/web run upload    # build and upload a version without deploying it
pnpm --filter @fiberscope/web run preview   # build and serve the Worker locally
```

`preview` takes overrides for the Worker's variables from `apps/web/.dev.vars`. To run your own
copy, create an R2 bucket and set `bucket_name` and `SITE_URL` in `wrangler.jsonc`.
`apps/web/public/_headers` sets the cache policy of static files: one year, immutable, for the
fingerprinted files under `/_next/static/`, and one day for the icons and the social image
(`favicon.svg`, `apple-touch-icon.png` and `og-image.png`), which keep their names when they change.

### Search engines

The site keeps search engines out until the deployment sets `ALLOW_INDEXING` to `"true"`, and then
lets them in only on `SITE_URL`'s host:

- Pages on any other host, such as pull-request previews or the `workers.dev` address once a custom
  domain serves the site, are `noindex`.
- `/robots.txt` allows everything and names the sitemap on the indexed host; everywhere else it
  answers `Disallow: /`.
- `/sitemap.xml` lists one URL, the site's root.
- Every page has a canonical link to the site's root: query strings such as `?period=7d` are views
  of the same page.

At launch, set `SITE_URL` to the final origin and `ALLOW_INDEXING` to `"true"` in
`wrangler.jsonc`, then deploy.

### Previews

`.github/workflows/deploy.yml` deploys `main` on every push. For every pull request from a branch
of this repository it uploads a preview version, which leaves production untouched, at
`https://pr-<number>-fiberscope.<subdomain>.workers.dev`, and links it in a comment on the pull
request. It needs the `CLOUDFLARE_API_TOKEN` (an "Edit Cloudflare Workers" token) and
`CLOUDFLARE_ACCOUNT_ID` secrets, and the comment needs the `CLOUDFLARE_WORKERS_SUBDOMAIN` variable.
Without the token the job skips itself, so pull requests from forks, which get no secrets, have CI
but no preview.

### The indexer

The indexer runs anywhere Node 24 runs. It needs a persistent disk for its database, at least 4 GB
of memory (see [Running costs](#running-costs)), and `SNAPSHOT_R2_BUCKET`, so every snapshot
reaches the site. Its key is an R2 API token limited to Object Read & Write on that one bucket (R2 →
Manage API tokens); the indexer signs S3 requests with the token's S3 credentials, so it can write
nowhere else in the account.

`apps/indexer/Dockerfile` builds an image that runs `loop.sh` with 180 days of settlements, 90 days
of auctions and a 10-minute budget. Build it from the repository root:

```sh
docker build -f apps/indexer/Dockerfile -t fiberscope-indexer .
docker run -v fiberscope-data:/data --env-file apps/indexer/.env fiberscope-indexer
```

The database (`DB_PATH=/data/base.db`) and the local snapshot live on the volume at `/data`. The
live indexer runs from this image on [Railway](https://railway.com), with a volume at `/data`.
`SEED_DB_URL`, for example a presigned R2 link to a copy of the database, moves it to a new host
without indexing again.

## Running costs

Measured on the live deployment on 3–4 Oct 2026.

- **Site.** The Worker is 5.47 MB, 1.14 MB gzipped, within the Workers Free plan's
  [size limit](https://developers.cloudflare.com/workers/platform/limits/#worker-size). Requests and
  CPU time per request depend on the plan: see
  [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers).
- **Snapshot.** One R2 object of about 280 KB, rewritten on every indexer run, every 10 minutes,
  and read once per page view and once per update of an open page. That is well within
  [R2's free tier](https://developers.cloudflare.com/r2/pricing/#free-tier): 10 GB-month of
  storage, 1 million writes and 10 million reads a month.
- **Indexer.** The database takes 0.89 GB of the Railway volume at 180 days of settlements and 90
  days of auctions. Nothing in it is pruned, so it keeps growing by roughly 7–10 MB a day. While
  history is being filled, each run lasts its whole 10-minute budget and memory peaks at about
  2.8 GB. Once caught up, a run takes well under a minute every 10 minutes; memory averages about
  0.7 GB and peaks at about 1.8 GB. Give any host at least 4 GB of RAM. Railway meters actual use:
  $10 per GB of memory and $20 per vCPU per month, and $0.15 per GB of volume per month
  ([pricing](https://docs.railway.com/pricing/plans#resource-usage-pricing)). Caught up, that
  comes to about $8 a month.
- **Data.** The indexer reads public endpoints without API keys: Base's RPC, CoW's API and CoW's
  solver registry.

## Repository layout

| Path                            | What it holds                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `apps/indexer/src/cli.ts`       | The commands                                                                   |
| `apps/indexer/src/sync.ts`      | The order of a sync: catch-up, snapshot, backfill                              |
| `apps/indexer/src/rules.ts`     | The counting rules as pure functions: days, attribution, volume, surplus, cost |
| `apps/indexer/src/snapshot.ts`  | Builds the snapshot from the database                                          |
| `packages/core/src/snapshot.ts` | The snapshot contract                                                          |
| `packages/core/src/view`        | The view model: windows, shares, ranks, averages and the charts' scales        |
| `apps/web/components`           | The page's sections                                                            |
| `apps/web/messages/en`          | Every reader-facing string, through next-intl                                  |
