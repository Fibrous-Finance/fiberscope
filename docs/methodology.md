# Methodology

How Fiberscope counts every figure on the page. The page's own Methodology section states the same
definitions in brief. In the code, the counting rules are in `apps/indexer/src/rules.ts` and the
windows, shares, ranks and averages in `packages/core/src/view`.

## Data sources

Every figure comes from public data on Base and from CoW Protocol's public services.

| Source                                                                                                                              | Provides                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GPv2Settlement` (`0x9008d19f58aabd9ed0d60971565aa8510560ab41`): `Settlement`, `Trade` and `Interaction` events, receipts, calldata | Batches, trades, DEX swaps, gas, transaction cost, each transaction's sender and recipient, and each trade's signed order terms                                   |
| CoW API `GET /api/v2/solver_competition/by_tx_hash/{tx}`                                                                            | Every solution in the auction behind a settlement (solver, ranking, winner, score, whether the fairness filter removed it), and the auction's native token prices |
| CoW API `POST /api/v1/orders/by_uids`                                                                                               | Each traded order's quote (the solver that gave it, whether CoW verified it) and the partner fees its app data asks for                                           |
| CoW API `GET /api/v2/trades?orderUid={uid}`                                                                                         | The protocol fees charged on each trade, one per fee policy, in the order CoW applied them                                                                        |
| [CoW's solver registry](https://cms.cow.fi/api/solver-networks), plus overrides in `apps/indexer/src/overrides.ts`                  | Solver names and their prod and barn submission addresses; an address the registry marks inactive is retired                                                      |
| `GPv2AllowListAuthentication` (`0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe`) `isSolver`                                             | Whether a relay settlement's sender or recipient is a solver, for attribution                                                                                     |
| Chainlink ETH/USD on Base (`0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70`)                                                            | The dollar rate at each settlement: the latest answer at or before its block                                                                                      |
| ERC-20 `symbol()`                                                                                                                   | Token symbols for the latest settlements' pairs                                                                                                                   |

Only the production settlement contract is read. CoW's barn (staging) environment settles through
a separate contract, `0xf553d092b50bdcbdded1a99af2ca29fbe5e2cb13`, so barn's settlements are not
counted.

## Days, windows and coverage

- **Rolling days.** Time is cut into 24-hour days that end at the newest block in the data, not at
  midnight: the first day is the 24 hours up to that block, the next the 24 hours before it, and
  so on. Base produces a block every 2 seconds, so a day is 43,200 blocks.
- **Windows.** The periods (24 hours, 7, 30, 90 and 180 days) add up whole days and end at the
  newest block. Rates such as Entered and Win rate are taken over all the window's auctions
  together, not averaged over days.
- **Newest block.** The data stops at Base's safe block: the newest block whose transactions Base
  has posted to Ethereum, usually a minute or two behind the chain head. Such a block changes only
  if Ethereum reorganizes the blocks that hold its data.
- **Coverage.** Only complete days count. Settlement history (batches, trades, gas, transaction
  cost, DEX swaps) reaches furthest back. Volume, Entered and Win rate also need auction data, and
  surplus also needs the terms each order was signed with. Auction details (scores, filtered-out
  solutions, quotes and fees) are looked up in CoW's API after the auction data, so they never
  reach further back. In a window longer than the history behind a figure, the figure covers only
  the days that have it, and a note says so instead of extrapolating.
- **Earlier window.** Rank changes (▲, ▼, NEW) and share changes compare the window with the window
  of the same length just before it, once the history covers both.
- **Freshness.** New data arrives every 10 minutes, and an open page fetches it within about a
  minute of its arrival, or as soon as the page is back in view. The page shows **Delayed** once
  the newest block in its data is more than 30 minutes old, and then checks for new data every
  minute.

## Measures

### Batches

A settlement: one `Settlement` event, one call to `settle`, that filled at least one order. A
transaction can hold more than one, and one auction can settle as several batches. Settlements
without a trade (buffer movements) are not counted.

### Trades

Orders filled inside those batches, one per `Trade` event. An order filled in parts counts once per
fill.

### Volume

The USD value of filled orders. Each trade counts at the lower of its sell and buy value, priced
with the native token prices CoW used in that auction and Chainlink's ETH/USD rate at settlement.
A trade priced on one side only counts at that side; a trade priced on neither adds nothing. Native
ETH is priced as WETH.

### Share and rank

A solver's share is its portion of all batches, trades or volume in the window. The table ranks
every solver with a batch in the window by the selected measure. A solver with no trade on the
window's days with auction data has no volume figure rather than $0, and no rank by volume. The
overview's **Lead over #2** is the leader's share divided by the runner-up's.

### Gas per trade

Gas units used by a solver's batches divided by the trades they filled: units of gas, not cost. A
transaction that holds several batches splits its gas evenly between them.

The overview's **Lowest gas per trade** considers only solvers with at least 100 batches per day of
settlement data in the window, or every solver when none has that many.

### Transaction cost

What a settlement transaction paid on Base: gas used × effective gas price, plus the L1 data fee,
in USD at Chainlink's ETH/USD rate in its block. A transaction that holds several batches splits
its cost evenly, as it splits gas. Per trade: a solver's cost divided by the trades it filled.

### DEX swaps

Interactions in a settlement other than token approvals (ERC-20 `approve`) and WETH unwraps
(`withdraw`). Per trade: a solver's swaps divided by the trades it filled.

### Batch value

Volume divided by batches. Trades per batch is trades divided by batches, and volume per trade is
volume divided by trades. Ratios with volume use only the days with auction data.

### Surplus

The USD value of a trade's improvement over its user's signed limit price:

```text
surplus = value × (bought × limitSell − sold × limitBuy) ÷ (bought × limitSell)
```

- `bought` and `sold` are the executed amounts, `sold` without the fee.
- `limitSell` and `limitBuy` are the amounts the user signed, read from the `settle()` calldata: the
  transaction's own input, or the call the flash-loan router, an Atomic Bundle (see
  [Attribution](#attribution)) or a solver contract passes on. A decoded call is used only when it
  reproduces the settlement's `Trade` events exactly.
- `value` is the trade's USD value, as in Volume.

The expression is the same for sell and buy orders, and for whole and partial fills. The page
compares surplus in basis points (hundredths of a percent) of the volume of the same trades.

This is Dune's definition (`surplus_usd` in Spellbook's `cow_protocol_base.trades`) with one
difference: trades are valued at the lower of their two sides, as in Volume, where Dune takes the
higher. Buy-order surplus follows Dune's formula, which comes out slightly below CoW Explorer's
figure.

### Unusual surplus

Surplus above a tenth of the trade's value, CoW's own cutoff (its Dune query
[1368423](https://dune.com/queries/1368423)). It comes from limits set far from the market, such
as very wide slippage or stale orders, so it says more about the order than about how it was
settled. **Typical surplus** excludes these trades; the unusual share is their portion of a solver's
surplus. The split is decided exactly on the amounts:
`10 × (bought × limitSell − sold × limitBuy) > bought × limitSell`.

### Quotes

The quote each order was placed with, as CoW's order book records it: the best of the solvers'
quotes when the trader asked for a price, with the solver that gave it. Counted by trade, on the
day the trade settled. A solver's share is the trades placed with its quote divided by all trades
placed with a solver's quote; a quote that names no solver (the zero address) counts for no one.
**Verified**: CoW checked the quote by simulating it. **Settled itself**: the solver that gave the
quote also settled the trade, as attributed below. These figures say whose price traders signed
against, not who earned quote rewards, which CoW pays by a different rule.

### Fees

The protocol fees CoW's trades API lists for each trade, one per fee policy, in the order CoW
applied them. CoW's own fees come first; an order's partner fees, which its app data asks for on
behalf of the app or wallet that placed it, are applied last, so the last fees, one per partner fee
in the app data, are the partner fees. When a trade's fees do not line up with the app data, the
split is left open and none of its fees count in either total. Each fee is in one of the trade's
two tokens and is valued at the trade's own exchange rate, its share of the trade's amount in that
token times the trade's value (as in Volume), since a single token's native price can be far off.
Fees count for the solver that settled the trade; solvers do not set them, so the page shows them
per settlement and for the network, and per solver only in the exports. A settlement shows its
fees only when the fees of all its trades are known. In basis points, fees are divided by the
volume for the same days.

### Network average

Gas, transaction cost and DEX swaps per trade across all solvers, weighted by trades: all solvers'
totals divided by all their trades. Typical surplus across all solvers, weighted by volume. Batch
value across all solvers: all volume divided by all batches, over the days with auction data.

### Entered

The share of the window's auctions in which the solver submitted at least one solution, counting
solutions CoW filtered out. Only auctions that ended in a settlement count, and an auction counts
on the day it started. **Average solver** is the mean Entered share among the table's solvers that
entered at least one auction. A solver with batches but no recorded entry shows no Entered or Win
rate rather than 0%: its auction data is missing.

### Win rate

The share of the auctions a solver entered that it won, alone or with other winners. A solver's
detail also gives its wins as a share of all the window's auctions.

### Score

The value CoW's protocol computes from each solution's executed amounts to choose winners
(CIP-20): roughly the surplus the solution generates for traders. CoW's API gives it in ETH; the
page converts it to USD at Chainlink's ETH/USD rate at the auction's start block, to 6 significant
figures. **Below winner** is (winning score − score) ÷ winning score. It is given only for auctions
with a single winning solution. Only a filtered-out solution can score above that winner, since one
that passed the filter with a higher score would have won; the page then shows how much higher:
(score − winning score) ÷ winning score. With several winning solutions, a losing solution competed
only with the winning solution whose orders it would also have settled; the scores do not identify
that solution. Each solver's row shows its best solution, its first in CoW's ranking: the winners,
then the other solutions by score, then the filtered-out ones. With several winning solutions,
winning solvers come first and the others after them, each group sorted by the score its rows
show. A winner's row also shows the highest score among its other solutions, filtered out or not,
when that score is higher than the one the row shows.

### Filtered out

Removed by the fairness filter of CoW's combinatorial auction (CIP-67). For each token pair traded
in one direction, CoW takes the best solution with only that pair's orders as a reference; a
solution that batches several pairs is filtered out when it scores less on any of them than that
reference. A filtered-out solution cannot win. A solver's share is its filtered-out solutions
divided by all its solutions, in the auctions that started in the window.

### Lost by 1% or less

Of the auctions with a single winning solution that a solver entered and lost with at least one
solution that passed the filter, the share in which its best such solution scored at least 99% of
the winning score, using the exact scores. Auctions with several winners count in neither part.

### Leading since

The first day of the current unbroken run in which the same solver alone ranked #1 by daily share
of the selected measure. A day on which two solvers tie for the most has no leader. When the run
reaches back to the start of the data, the page says "N+ days in a row".

### Latest auctions and settlements

The tape shows the latest 48 auctions and, for each solver, whether it won, entered or stayed out
of each; selecting an auction shows all its solutions and their scores. Latest settlements lists
the 50 most recent batches across all solvers, with their protocol and partner fees and the solver
whose quote the first trade's order was placed with; each solver's detail view lists its latest 6,
with the quote but not the fees. A settlement's pair shows the tokens in its first trade.

## Attribution

A settlement is credited to the solver that submitted it: the address that called `settle`. A
relay calls `settle` on a solver's behalf, so the `Settlement` event names the relay instead. The
relays are CoW's flash-loan router (`0x9da8b48441583a2b93e2ef8213aad0ec0b392c69`), which settles
on the auction winner's behalf, and the network's
[Atomic Bundles](https://docs.cow.fi/cow-protocol/concepts/order-types/wrappers): contracts CoW
DAO allow-lists that a solver calls instead of the settlement contract. On BNB Chain these are
Euler's, to open, close and collateral-swap positions (`0x64c26b3a182826fe2ab8c04c8caf40b0c4bf9a66`,
`0x4f4ce927188637b4a1d91350c3114f4bd301dd02` and `0xcc054cd4b814a2caeb63c6f6a446435480a383f3`);
Base has none. A relay's settlements are credited to the solver behind them, in this order:

1. the transaction's recipient, when it is a registered or allow-listed solver other than a relay
   (the relays are allow-listed themselves);
2. otherwise its sender, when that is one;
3. otherwise the winner of that settlement in CoW's competition data;
4. as a last resort, the sender.

Allow-listed means `isSolver` on `GPv2AllowListAuthentication` returns true. Each address is
checked once, at the block of the first relay settlement seen with it; the settlements of a relay
added to the indexer later get their checks on its next run.

## Registry and names

Names, statuses and submission addresses come from CoW's solver registry for the network,
refreshed on every indexer run; the last copy is kept for when the registry is unavailable. A
solver groups its prod and barn addresses. An override adds an address the registry does not list
as active for the network that settles there and is on the settlement contract's on-chain
allow-list; it is shown as active. On Base there is one, Rizzolver's
`0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7`. On BNB Chain there are two, both of which the
registry lists for Ethereum only: Rizzolver's same address and Fractal's
`0x95480d3f27658e73b2785d30beb0c847d78294c7`.

A retired address is one the registry marks inactive. A solver without a public name is shown by
its address. The solver registry under the table lists every solver in CoW's registry for Base,
including inactive solvers and solvers without settlements.

## Validation

**Against CoW's Dune dashboard.** CoW's [Solver Info](https://dune.com/cowprotocol/solver-info)
dashboard, as run on 23 Sep 2026 for 30 days on Base, covers blocks 50,413,327–51,705,186 (25 Aug
2026 at 00:00 UTC to 23 Sep at 21:42 UTC): its window starts at midnight UTC. Its table
[V2: Ranked Active Solvers](https://dune.com/queries/1756858) also counts the settlements of CoW's
staging settlement contract, which Fiberscope does not read (see [Data sources](#data-sources)):
69 in these blocks, from the barn addresses of six solvers. Set those aside and every figure
matches Fiberscope's for the same blocks exactly, for each of the 22 solvers and in total:

| Measure   | Dune           | Staging contract | Dune, production contract | Fiberscope     |
| --------- | -------------- | ---------------- | ------------------------- | -------------- |
| Batches   | 76,873         | 69               | 76,804                    | 76,804         |
| Trades    | 80,808         | 69               | 80,739                    | 80,739         |
| DEX swaps | 116,034        | 86               | 115,948                   | 115,948        |
| Gas       | 59,036,427,079 | 29,912,162       | 59,006,514,917            | 59,006,514,917 |

A recount from the Base RPC of the production contract's `Settlement` events in these blocks
matched the database exactly: 77,289, of which 485 hold no trades and are not batches. An earlier
version of this comparison started at block 50,409,187 (24 Aug at 21:42 UTC), 2 hours and 18
minutes before the dashboard's window, and reported differences of about 0.1%.

**Attribution against CoW's competition data.** For blocks 51,811,228–52,115,823 (26 Sep 2026 at
08:36 UTC to 3 Oct 2026 at 09:49 UTC), all 24,534 batches had a winning solution for their
transaction in CoW's competition data, and every batch was credited to that solution's solver
address: 24,534 of 24,534. Of these, 1,230 went through the flash-loan router: 397 were credited
to the transaction's recipient and 833 to its sender, and all 1,230 match the winner. None of them
fell back to CoW's winner, so this check does not depend on the competition data it is compared
with. `node src/cli.ts attribution --from 51811228 --to 52115823` reruns this attribution check
using the database.

**Order terms against the trades and CoW's order book.** Surplus is calculated from the limits
decoded from `settle()` calldata. A sample of 407 trades covered every way that calldata reaches the
settlement contract: a direct call, the flash-loan router, and solver contracts that pass the call
on. Every decoded trade reproduced its `Trade` event exactly, and the limits, order kinds and fees
of 80 of 80 orders checked agree with CoW's order API (`api.cow.fi/base/api/v1/orders/{uid}`).
`node src/cli.ts terms --from <block> --to <block>` repeats this check for any block range. It
counts trades with decoded order terms by route, then rereads a sample from the RPC and checks each
trade against its `Trade` event and CoW's order book. For one day of blocks (52,506,074–52,549,273,
12–13 Oct 2026), order terms were read for all 2,519 trades. For all 90 sampled trades (30 per
route), the executed fee matched the fee in the `Trade` event, and the signed-order fields matched
CoW's order book.

To check a block range yourself, `node src/cli.ts window --from <block> --to <block>` in
`apps/indexer` prints its totals and per-solver table from the database (see
[Development](development.md#the-indexer)). The commands are described under
[Commands](development.md#commands).
