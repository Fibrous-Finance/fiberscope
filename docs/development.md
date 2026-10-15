# Development

How to run Fiberscope locally, how the indexer works, and how the site and the indexer are
deployed.

## Requirements

Node 24 and pnpm 10 (`.nvmrc` and the `packageManager` field in `package.json` pin them).

```sh
pnpm install
```

## Run the site

The site shows each network on a page of its own, Base at `/` and BNB Chain at `/bnb`, from that
network's snapshot: one JSON file, written by the indexer, that holds every figure the page shows.
Index a day of Base to get Base's:

```sh
cd apps/indexer
node src/cli.ts sync --chain-days 1 --auction-days 1 --snapshot ../web/data/base/snapshot.json
cd ../..
pnpm dev   # http://localhost:3000
```

From an empty database, that `sync` takes about 20 minutes at the default request rates, most of
it spent looking up the day's auctions in CoW's API. More history takes longer: 30 days of
settlements and 7 days of auctions take hours. A run can be stopped and started again; it resumes
where it stopped, and later runs fetch only what is new.

`pnpm dev` reads each network's snapshot from `apps/web/data/<network>/snapshot.json`:
`base/snapshot.json` for `/` and `bnb/snapshot.json` for `/bnb` (see
[Choosing the network](#choosing-the-network) to index BNB Chain). To read them from another
directory laid out the same way, give its absolute path:

```sh
SNAPSHOT_DIR=/path/to/snapshots pnpm dev   # /path/to/snapshots/base/snapshot.json, …
```

A page without its network's snapshot shows its error state, as it does when the file holds
another network's data. The page's view is in its query string:
`?period=7d&measure=volume&solver=<id>` opens a solver's detail for 7 days of volume.

`pnpm build` builds the site for production, and `pnpm --filter @fiberscope/web start` serves that
build.

## The indexer

`apps/indexer` reads data from Base or BNB Chain (see [Choosing the network](#choosing-the-network))
and from CoW's API into a SQLite database (`apps/indexer/.data/base.db` for Base) and writes the
snapshot from it. Node 24 runs the indexer's TypeScript directly. The indexer has no build step or
third-party dependencies; it uses `node:sqlite` for SQLite. Settlements and trades are stored by
block, addresses by id, and hashes and order uids as bytes (`apps/indexer/src/store.ts`). The
database records its schema version and its network's chain id. The indexer upgrades version 2
and 3 databases in place. These databases were written for Base. The next syncs fill in what
version 3 adds, and version 4 adds the clock's anchors (see [Block times](#block-times)). It
refuses a database from another network; use a separate database for each network. It also
refuses a database written by an unsupported older version: delete it to index again, or `seed` a
current copy. The snapshot is built while the rows are read, one at a time, so the indexer's
memory does not grow with the depth of the history.

Besides each settlement's auction, the indexer keeps from CoW's API:

- each solution's score, reference score and whether CIP-67's filter removed it
  (`GET /api/v2/solver_competition/{auction_id}`, for auctions stored before the schema held them);
- each traded order's quote (the solver that gave it, whether CoW verified it, and its amounts),
  its app data's order class and the policies of its partner fees (`POST /api/v1/orders/by_uids`,
  128 orders a request);
- each trade's protocol fees, one per fee policy in the order CoW applied them
  (`GET /api/v2/trades?orderUid=`). CoW applies an order's partner fees after its own fees, one
  per partner fee in the app data, so the last ones are marked as partner fees; when they do not
  match the app data's policies, the split is left open.

These details cover the detail range, which lies within the auction range.

### Choosing the network

One indexer process covers one network, which `NETWORK` names: `base` (the default) or `bnb` for
BNB Chain. The network sets CoW's API root, the contracts, the native token and its Chainlink
feed, and the defaults that are named after it: the RPC variables (`BASE_RPC_URL` and
`BASE_RPC_RPS`, or `BNB_RPC_URL` and `BNB_RPC_RPS`), the database
(`apps/indexer/.data/<network>.db`), the `snapshot` command's output
(`apps/web/data/<network>/snapshot.json`, where the site reads it) and the R2 key
(`<network>/snapshot.json`). Base's RPC defaults to its public endpoint. BNB Chain's public
endpoints refuse old logs and archive calls, or rate-limit them far below a backfill's pace, so
`BNB_RPC_URL` has no default: it must name an archive node that takes `eth_getLogs` ranges of
5,000 blocks.

```sh
cd apps/indexer
export BNB_RPC_URL=https://…   # an archive node
NETWORK=bnb node src/cli.ts sync --chain-days 1 --auction-days 1 --snapshot ../web/data/bnb/snapshot.json
```

A database holds one network: it records the network's chain id, and the indexer refuses to open
another network's database. To run a second network beside Base, run a second indexer with its
own `NETWORK`, RPC variables, database and snapshot path: another `loop.sh`, or another container
from the same image with its own volume (see [The indexer](#the-indexer-1)). The default R2 keys
already differ. Each indexer paces its own requests, so on one host their CoW API request rates
add up. The site shows each network on its own page: Base at `/`, BNB Chain at `/bnb`.

### Block times

Every figure is counted in rolling days of 24 hours, and the page shows when each settlement and
auction happened, but the chain data gives block numbers. Base makes a block every 2 seconds
exactly, so a formula would turn its block numbers into times. BNB Chain's block interval is about
0.45 seconds but varies, with several blocks in the same second. Its pace has changed several
times (3 seconds a block, then 1.5, 0.75 and, from January 2026, 0.45), so a formula based on a
fixed block interval would be hours off for blocks 180 days back.

The indexer therefore keeps a clock (`apps/indexer/src/clock.ts`) based on anchors: blocks whose
timestamps it has read and stored in the `anchors` table. When the node provides log timestamps
(`blockTimestamp`), each block range the indexer ingests adds the block of every log with its
timestamp, so every settlement's block is an anchor. If a range has no logs or the node does not
provide timestamps, the indexer adds the range's first and last blocks with their header
timestamps instead. At an anchor, a block's time is its recorded timestamp; between anchors, it is
interpolated to the second. Beyond the anchors, it is extrapolated using the network's average
block time. Day d holds the blocks whose time lies in (end − (d + 1) days, end − d days], end
being the newest block's time, so a day holds as many blocks as the chain made in it: 43,200 on
Base, as before. When a backfill must reach further back than the anchors, its depth is estimated
using the average block time, then increased by 1%. The extra blocks are harmless, since the
snapshot counts only whole days, and their anchors place the next run's window exactly.

A version 3 database was written for Base: its upgrade anchors both ends of its chain range with
Base's 2-second times, so it needs no RPC and Base's times stay exact. Pruning keeps the last
anchor before the chain data, so its first block keeps its time.

### Commands

Run them from `apps/indexer`. Every command takes `--db <path>`; `node src/cli.ts --help` prints
the same summary.

| Command                                                                                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node src/cli.ts sync [--chain-days N] [--auction-days M] [--budget-minutes B] [--prune] [--snapshot <path>]` | Catches up with the network's safe block, then backfills at least N days of settlements and M days of auctions. With `--snapshot`, writes the snapshot once caught up, and again if the backfill added history. With `--budget-minutes`, the backfill stops B minutes after the start, and the next run resumes it. With `--prune`, deletes the data older than those depths once caught up (see below); with both at 0 it deletes nothing.                                                              |
| `node src/cli.ts snapshot [--out <path>]`                                                                     | Writes the snapshot from the database (default `apps/web/data/<network>/snapshot.json`).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `node src/cli.ts window --from <block> --to <block>`                                                          | Prints totals (batches, trades, DEX swaps, volume, surplus, gas and cost; scores and filtered-out solutions; quotes; protocol and partner fees) and the per-solver table for a block range, from the database.                                                                                                                                                                                                                                                                                           |
| `node src/cli.ts attribution --from <block> --to <block>`                                                     | Uses the database to compare each batch's credited solver address in a block range with the solver address of the winning solution for its transaction in CoW's competition data. Breaks down flash-loan router batches by how the credited address was chosen. See [Validation](methodology.md#validation).                                                                                                                                                                                             |
| `node src/cli.ts terms --from <block> --to <block> [--sample N]`                                              | Counts trades with order terms decoded from `settle()` calldata, grouped by how the calldata reached the settlement contract. It then samples trades across the block range and routes, targeting N trades (default: 90). For each sampled trade, it rereads and decodes the transaction from the RPC, compares the executed fee with the fee in its `Trade` event, and compares the signed-order fields with the corresponding fields in CoW's order book. See [Validation](methodology.md#validation). |
| `node src/cli.ts seed --url <url>`                                                                            | Downloads a database from `<url>` when there is none yet, so a new host does not index again. It never overwrites a database and runs SQLite's integrity check on the download before using it.                                                                                                                                                                                                                                                                                                          |

The package's `sync` and `snapshot` scripts (`pnpm --filter @fiberscope/indexer snapshot`, with the
same options) also read `apps/indexer/.env` when it exists.

### What a sync does

1. Refreshes CoW's solver registry; if the registry is unavailable, it uses the last copy.
2. Catches up: settlements, receipts and calldata up to the network's safe block, then the
   auctions behind the new settlements. On Base, the safe block is the newest block whose
   transactions Base has posted to Ethereum. On BNB Chain, it is the newest justified block; in
   BNB Chain's fast finality, justification is the stage before finalization.
3. With `--prune`, deletes settlements older than N days (at least M, as for the backfill) with
   their auction data, and the auction data, orders and fees of settlements older than M days. A
   flash-loan router settlement keeps its auction while it is in the chain data, since its
   attribution may need the auction's winner.
4. Fetches details for the new blocks: the orders traded and their trades' protocol fees,
   rechecking the last 10 minutes of trades whose fees the API did not list yet. If one of these
   lookups fails, or they take more than 2 minutes, the snapshot is written without the
   auction-detail figures, and the rest is caught up after it.
5. Marks the data current and, with `--snapshot`, writes the snapshot.
6. Backfills, newest first, until it reaches the requested depth or exhausts the time budget:
   settlements, followed by their auction lookups, followed by their details. Settlement history
   is kept at least as deep as auction history. Trades stored before the schema held order uids
   get theirs from their `Trade` events.
7. Writes the snapshot again if the history grew.

On an empty database there is nothing to catch up: the backfill starts at the safe block and the
snapshot is written once it ends. Every step commits as it goes, so an interrupted run loses
nothing. Requests are paced: by default at most 15 RPC calls per second (`eth_call` at a thirtieth
of that, the public Base RPC's tightest limit) and 3 CoW API requests per second, slowing down
when a server answers that the rate is too high. At 5 CoW API requests per second, filling in the
details of a version 2 database with 90 days of auctions on Base takes about a day: about 200,000
auctions to score again and 240,000 orders whose trades are looked up one order at a time.

### Keep it running

`apps/indexer/loop.sh` runs `sync` with its arguments every `REFRESH_MINUTES` (whole minutes,
default 10), counted from the start of each run; a failed run is logged and the next one runs on
schedule. Set `--budget-minutes` to the interval: the backfill stops when the next run is due, so
fresh data never waits for a long backfill, and while history is being filled no time between runs
is idle.

```sh
REFRESH_MINUTES=10 sh apps/indexer/loop.sh --chain-days 30 --auction-days 7 --budget-minutes 10 \
  --snapshot ../web/data/base/snapshot.json
```

`loop.sh` runs from `apps/indexer`, so relative paths start there. It reads `REFRESH_MINUTES`,
`SEED_DB_URL`, `DB_PATH` and `NETWORK` from its own environment; each `sync` it starts reads
`apps/indexer/.env` when it exists. With `SEED_DB_URL` set and no database yet (at `DB_PATH`, else
at the network's default), it first downloads the database with `seed`.

## Configuration

| Variable                                                            | Used by | Purpose                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK`                                                           | indexer | The network to index: `base` (default) or `bnb` for BNB Chain; see [Choosing the network](#choosing-the-network)                                                                                                            |
| `BASE_RPC_URL`, `BNB_RPC_URL`                                       | indexer | The network's RPC endpoint: Base's defaults to `https://mainnet.base.org`; BNB Chain's has no default and must be an archive node                                                                                           |
| `DB_PATH`                                                           | indexer | The SQLite database (default `apps/indexer/.data/<network>.db`); `--db` overrides it                                                                                                                                        |
| `BASE_RPC_RPS` or `BNB_RPC_RPS`, `COW_API_RPS`                      | indexer | Request rates per second for the network's RPC and CoW's API (defaults 15 and 3)                                                                                                                                            |
| `REFRESH_MINUTES`                                                   | indexer | `loop.sh`'s interval (default 10). Through the snapshot, an open page also learns when the next run is due and fetches a minute after it. At any interval, the page shows Delayed once its data is more than 30 minutes old |
| `SEED_DB_URL`                                                       | indexer | With `loop.sh`, download the database from this URL when there is none yet                                                                                                                                                  |
| `SNAPSHOT_R2_BUCKET`                                                | indexer | Also upload every snapshot to this R2 bucket, through R2's S3 API; needs the variables below                                                                                                                                |
| `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | indexer | The account, and the S3 credentials of an R2 API token with Object Read & Write on that bucket only                                                                                                                         |
| `GIT_COMMIT`                                                        | indexer | The full commit hash for the indexer's code, recorded in every snapshot. The page's footer links to it when `SITE_COMMIT` is also set. The Docker image sets this variable from its `GIT_COMMIT` build argument             |
| `SNAPSHOT_R2_KEY`                                                   | indexer | The object key every snapshot is uploaded to (default `<network>/snapshot.json`, so `base/snapshot.json` for Base), which is the key the site reads                                                                         |
| `SNAPSHOT_SOURCE`                                                   | web     | `r2` (as in `wrangler.jsonc`): each network's page reads `<network>/snapshot.json` through the `SNAPSHOTS` binding. Any other value, or none, reads local files from `SNAPSHOT_DIR`                                         |
| `SNAPSHOT_DIR`                                                      | web     | The directory of the local snapshots, one `<network>/snapshot.json` each (default `apps/web/data`)                                                                                                                          |
| `SITE_URL`                                                          | web     | The site's origin (default `http://localhost:3000`): absolute link-preview URLs, the canonical link, the sitemap, and the one host search engines may index                                                                 |
| `ALLOW_INDEXING`                                                    | web     | `true` lets search engines index requests to `SITE_URL`'s host; other hosts, pull-request previews included, stay `noindex`. Without it, every page is `noindex`                                                            |
| `SITE_COMMIT`                                                       | web     | The site's commit hash, supplied at build time and linked in the footer. `deploy.yml` sets it to the commit being deployed. If unset, the footer shows no commit links                                                      |

On Cloudflare, the site's variables come from `vars` in `apps/web/wrangler.jsonc`.

## The snapshot

`packages/core/src/snapshot.ts` defines the snapshot, the contract between the indexer and the
site; the indexer writes it and the site derives every view from it with the view model in
`packages/core/src/view`.

- Time is divided into rolling days of 24 hours based on block time (see
  [Block times](#block-times)), working backward from the newest block (`end`). Daily series are
  newest first and zero-filled, so index `d` is always the day `d` days back. `network` names the
  network the snapshot covers; the site refuses a snapshot of another network than the page's.
- `coverage` says how many days hold complete data: `chainDays` for batches, trades, DEX swaps,
  gas and transaction cost; `auctionDays` for volume, entries and wins; `surplusDays` for surplus;
  `detailDays` for solutions, filtered-out solutions, losses, quotes and protocol fees.
- `solvers` holds each solver's identity, addresses and daily series, and its latest settlements;
  `auctions`, `latestAuctions`, `latestSettlements` and `registry` hold the rest of the page.
- When `GIT_COMMIT` is set, `commit` records the commit hash for the indexer's code. The page's
  footer links to it alongside the site's own commit when `SITE_COMMIT` is also set.
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
`apps/web/wrangler.jsonc` binds the R2 bucket `fiberscope-data` as `SNAPSHOTS`, from which each
network's page reads its snapshot, and sets the Worker's variables. From the repository root:

```sh
pnpm --filter @fiberscope/web run deploy    # build and deploy
pnpm --filter @fiberscope/web run upload    # build and upload a version without deploying it
pnpm --filter @fiberscope/web run preview   # build and serve the Worker locally
```

Production answers at `https://fiberscope.org`, a custom domain attached to the Worker in
Cloudflare's dashboard (the `fiberscope.org` zone is on the same account), and `www.fiberscope.org`
redirects there through a Redirect Rule. `wrangler.jsonc` lists no routes, so a deploy leaves the
custom domain in place. The Worker's own address, `fiberscope.kermo.workers.dev`, was the public
link before the domain; its pages answer with a permanent redirect to `https://fiberscope.org`
(`redirects` in `apps/web/next.config.ts`), while its static files, served before the Worker runs,
still answer there, with `X-Robots-Tag: noindex`. The pull-request previews are version URLs,
which `preview_urls: true` keeps on independently of that address.

`preview` takes overrides for the Worker's variables from `apps/web/.dev.vars`. To run your own
copy, create an R2 bucket and set `bucket_name` and `SITE_URL` in `wrangler.jsonc`, and set
`ALLOW_INDEXING` to `"false"` unless the copy should appear in search results.
`apps/web/public/_headers` sets the cache policy of static files: one year, immutable, for the
fingerprinted files under `/_next/static/`, and one day for the icons and the social image
(`favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and `og-image.png`), which keep their names
when they change. `favicon.ico` is there for clients that ask for it by name; without the file,
each such request would render the not-found page.

### Search engines

`ALLOW_INDEXING` is `"true"` in `wrangler.jsonc`: search engines may index `SITE_URL`'s host, and
only that host. Any other value makes every page `noindex`, which is how to take the site out of
search results.

- Pages on any other host, such as pull-request previews, are `noindex`, and static files on
  `workers.dev` hosts carry `X-Robots-Tag: noindex` (`apps/web/public/_headers`).
- `/robots.txt` lets every crawler in on every host, so crawlers can read those `noindex` tags: a
  page that robots.txt blocks keeps its `noindex` unread and can still be listed. It names the
  sitemap only on the indexed host.
- `/sitemap.xml` lists each network's page, `/` and `/bnb`, last modified at the newest block of its
  snapshot. It is rendered per request, because `SITE_URL` is a Worker variable that `next build`
  does not see.
- Each network's page has a canonical link to itself, `/` or `/bnb`: query strings such as
  `?period=7d` are views of the same page.
- The home page carries WebSite structured data (JSON-LD), which gives search results the site's
  name.

Indexing also depends on settings outside the repository. Check them at launch and whenever the
zone's settings change:

- Cloudflare's AI bot policies for the `fiberscope.org` zone (Security, Settings) allow Search and
  Training. Cloudflare counts crawlers that serve both search and AI training under Training, so
  blocking Training can block search crawlers too. Agent is allowed as well, so AI assistants can
  fetch the page for their users.
- Always Use HTTPS is on, and the `www` Redirect Rule answers 301 and keeps the path and query
  string.
- Google Search Console has a Domain property for `fiberscope.org`, verified by a TXT record on the
  zone (keep the record), with `/sitemap.xml` submitted. Bing Webmaster Tools imports the site from
  Search Console.

### Previews

On each push to `main`, `.github/workflows/deploy.yml` builds and deploys the site with
`SITE_COMMIT` set to that commit. The page's footer links to that commit. For every pull request
from a branch of this repository it uploads a preview version, which leaves production untouched, at
`https://pr-<number>-fiberscope.<subdomain>.workers.dev`, and links it in a comment on the pull
request. It needs the `CLOUDFLARE_API_TOKEN` (an "Edit Cloudflare Workers" token) and
`CLOUDFLARE_ACCOUNT_ID` secrets, and the comment needs the `CLOUDFLARE_WORKERS_SUBDOMAIN` variable.
Without the token the job skips itself, so pull requests from forks, which get no secrets, have CI
but no preview.

### The indexer

The indexer runs anywhere Node 24 runs. It needs a persistent disk for its database, 1 GB of
memory (see [Running costs](#running-costs)), and `SNAPSHOT_R2_BUCKET`, so every snapshot
reaches the site. Its key is an R2 API token limited to Object Read & Write on that one bucket (R2 →
Manage API tokens); the indexer signs S3 requests with the token's S3 credentials, so it can write
nowhere else in the account.

`apps/indexer/Dockerfile` builds an image that runs `loop.sh` with 180 days of settlements, 90 days
of auctions, a 10-minute budget and `--prune`. Build the image from the repository root, using a
clean checkout of the commit you want to run. Pass that commit as the `GIT_COMMIT` build argument
so every snapshot records it and the page's footer can link to it.

```sh
docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) -f apps/indexer/Dockerfile -t fiberscope-indexer .
docker run -v fiberscope-data:/data --env-file apps/indexer/.env fiberscope-indexer
```

The database and the local snapshot live on the volume at `/data`: the image links
`apps/indexer/.data` there, so the database is `/data/base.db`, or `/data/bnb.db` with
`NETWORK=bnb`. A second network runs from the same image in a container of its own, with its own
volume, since the local snapshot's path is the same:

```sh
docker run -v fiberscope-bnb:/data --env-file apps/indexer/.env.bnb -e NETWORK=bnb fiberscope-indexer
```

The live indexer runs from this image on an AWS EC2 instance: systemd starts the container, its
variables come from SSM Parameter Store, and its output goes to CloudWatch Logs. `SEED_DB_URL`, for
example a presigned R2 link to a copy of the database, moves it to a new host without indexing
again.

## Running costs

Measured on the live deployment on 3–5 Oct 2026.

- **Site.** The Worker is 5.47 MB, 1.14 MB gzipped, within the Workers Free plan's
  [size limit](https://developers.cloudflare.com/workers/platform/limits/#worker-size). Requests and
  CPU time per request depend on the plan: see
  [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers).
- **Snapshot.** One R2 object of about 280 KB, rewritten on every indexer run, every 10 minutes,
  and read once per page view and once per update of an open page. That is well within
  [R2's free tier](https://developers.cloudflare.com/r2/pricing/#free-tier): 10 GB-month of
  storage, 1 million writes and 10 million reads a month.
- **Indexer.** The database takes about 175 MB at 180 days of settlements and 90 days of auctions,
  and `--prune` keeps it there. The live indexer runs on an AWS EC2 t4g.small in Frankfurt (2
  Graviton vCPUs, 2 GB of memory) with a 16 GB gp3 disk. Caught up, a run takes about 20 seconds
  every 10 minutes, most of it building the snapshot. The container holds about 0.16 GB between
  runs, the database file in the page cache, and peaks at about 0.49 GB during a run, so any host
  with 1 GB of RAM will do. On demand, the instance costs $0.0192 an hour, the disk $0.0952 per
  GB-month and its public IPv4 address $0.005 an hour
  ([EC2](https://aws.amazon.com/ec2/pricing/on-demand/),
  [VPC](https://aws.amazon.com/vpc/pricing/)): about $19 a month.
- **Data.** The indexer reads public endpoints without API keys for Base: its RPC, CoW's API and
  CoW's solver registry. BNB Chain requires you to supply an archive RPC endpoint (`BNB_RPC_URL`).

## Repository layout

| Path                            | What it holds                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `apps/indexer/src/cli.ts`       | The commands                                                                   |
| `apps/indexer/src/sync.ts`      | The order of a sync: catch-up, snapshot, backfill                              |
| `apps/indexer/src/details.ts`   | Scores, orders' quotes and trades' protocol fees from CoW's API                |
| `apps/indexer/src/clock.ts`     | Block times from the anchors the indexer has read                              |
| `apps/indexer/src/rules.ts`     | The counting rules as pure functions: days, attribution, volume, surplus, cost |
| `apps/indexer/src/snapshot.ts`  | Builds the snapshot from the database                                          |
| `packages/core/src/snapshot.ts` | The snapshot contract                                                          |
| `packages/core/src/view`        | The view model: windows, shares, ranks, averages and the charts' scales        |
| `apps/web/components`           | The page's sections                                                            |
| `apps/web/messages/en`          | Every reader-facing string, through next-intl                                  |
