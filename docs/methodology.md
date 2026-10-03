# Methodology

How Fiberscope counts every figure on the page. The page's own Methodology section states the same
definitions in brief. In the code, the counting rules are in `apps/indexer/src/rules.ts` and the
windows, shares, ranks and averages in `packages/core/src/view`.

## Data sources

Every figure comes from public data on Base and from CoW Protocol's public services.

| Source                                                                                                                              | Provides                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GPv2Settlement` (`0x9008d19f58aabd9ed0d60971565aa8510560ab41`): `Settlement`, `Trade` and `Interaction` events, receipts, calldata | Batches, trades, DEX swaps, gas, transaction cost, each transaction's sender and recipient, and each trade's signed order terms |
| CoW API `GET /api/v2/solver_competition/by_tx_hash/{tx}`                                                                            | Every solution in the auction behind a settlement (solver, ranking, winner), and the auction's native token prices              |
| [CoW's solver registry](https://cms.cow.fi/api/solver-networks), plus overrides in `apps/indexer/src/overrides.ts`                  | Solver names and their prod and barn submission addresses; an address the registry marks inactive is retired                    |
| `GPv2AllowListAuthentication` (`0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe`) `isSolver`                                             | Whether a flash-loan router settlement's sender or recipient is a solver, for attribution                                       |
| Chainlink ETH/USD on Base (`0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70`)                                                            | The dollar rate at each settlement: the latest answer at or before its block                                                    |
| ERC-20 `symbol()`                                                                                                                   | Token symbols for the latest settlements' pairs                                                                                 |

## Days, windows and coverage

- **Rolling days.** Time is cut into 24-hour days that end at the newest block in the data, not at
  midnight: the first day is the 24 hours up to that block, the next the 24 hours before it, and
  so on. Base produces a block every 2 seconds, so a day is 43,200 blocks.
- **Windows.** The periods (24 hours, 7, 30, 90 and 180 days) add up whole days and end at the
  newest block. Rates such as Entered and Win rate are taken over all the window's auctions
  together, not averaged over days.
- **Newest block.** The data stops 20 blocks (40 seconds) short of the chain head, as a margin
  against reorganizations.
- **Coverage.** Only complete days count. Settlement history (batches, trades, gas, transaction
  cost, DEX swaps) reaches furthest back. Volume, Entered and Win rate also need auction data, and
  surplus also needs the terms each order was signed with. In a window longer than the history
  behind a figure, the figure covers only the days that have it, and a note says so instead of
  extrapolating.
- **Earlier window.** Rank changes (▲, ▼, NEW) and share changes compare the window with the window
  of the same length just before it, once the history covers both.
- **Freshness.** New data arrives every 10 minutes, and an open page fetches it on the same
  interval. The page shows **Delayed** once the newest block in its data is more than 30 minutes
  old, and then checks for new data every minute.

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
every solver with a batch in the window by the selected measure. The overview's **Lead over #2**
is the leader's share divided by the runner-up's.

### Gas/trade

Gas units used by a solver's batches divided by the trades they filled: units of gas, not cost. A
transaction that holds several batches splits its gas evenly between them.

The overview's **Lowest gas/trade** considers only solvers with at least 100 batches per day of
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
  transaction's own input, or the call the flash-loan router or a solver contract passes on. A
  decoded call is used only when it reproduces the settlement's `Trade` events exactly.
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

### Leading since

The first day of the current unbroken run in which the same solver alone ranked #1 by daily share
of the selected measure. A day on which two solvers tie for the most has no leader. When the run
reaches back to the start of the data, the page says "N+ days in a row".

### Latest auctions and settlements

The tape shows the latest 48 auctions and, for each solver, whether it won, entered or stayed out
of each. Latest settlements lists the 50 most recent batches across all solvers; each solver's
detail lists its 6 most recent. A settlement's pair shows the tokens in its first trade.

## Attribution

A settlement is credited to the solver that submitted it: the address that called `settle`.
Settlements sent through CoW's flash-loan router (`0x9da8b48441583a2b93e2ef8213aad0ec0b392c69`),
which settles on the auction winner's behalf, are credited to the solver behind them, in this
order:

1. the transaction's recipient, when it is a registered or allow-listed solver other than the
   router itself;
2. otherwise its sender, when that is one;
3. otherwise the winner of that settlement in CoW's competition data;
4. as a last resort, the sender.

Allow-listed means `isSolver` on `GPv2AllowListAuthentication` returns true. Each address is
checked once, at the block of the first router settlement seen with it.

## Registry and names

Names, statuses and submission addresses come from CoW's solver registry for Base, refreshed on
every indexer run; the last copy is kept for when the registry is unavailable. A solver groups its
prod and barn addresses. An override adds an address the registry does not list as active that
settles on Base and is on the settlement contract's on-chain allow-list; it is shown as active.
Today there is one: Rizzolver's `0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7`.

A retired address is one the registry marks inactive. A solver without a public name is shown by
its address. The solver registry under the table lists every solver in CoW's registry for Base,
including inactive solvers and solvers without settlements.

## Validation

**Against CoW's Dune dashboard.** For blocks 50,409,187–51,705,186 (the 30 days to 23 Sep 2026 at
21:42 UTC), the Base figures read from CoW's [Solver Info](https://dune.com/cowprotocol/solver-info)
dashboard for that window and Fiberscope's figures for the same blocks differ by about 0.1%:

| Measure   | Dune    | Fiberscope | Difference |
| --------- | ------- | ---------- | ---------- |
| Batches   | 76,873  | 76,954     | +0.11%     |
| Trades    | 80,808  | 80,892     | +0.10%     |
| DEX swaps | 116,034 | 116,166    | +0.11%     |
| Gas/trade | 730.6K  | 730.7K     | +0.01%     |

A recount from the Base RPC for five solvers matched the database exactly.

**Attribution against CoW's competition data.** For blocks 51,811,228–52,115,823 (26 Sep 2026 at
08:36 UTC to 3 Oct 2026 at 09:49 UTC), all 24,534 batches had a winning solution for their
transaction in CoW's competition data, and every batch was credited to that solution's solver
address: 24,534 of 24,534. Of these, 1,230 went through the flash-loan router: 397 were credited
to the transaction's recipient and 833 to its sender, and all 1,230 match the winner. None of them
fell back to CoW's winner, so this check does not depend on the competition data it is compared
with.

**Order terms against the trades and CoW's order book.** Surplus is calculated from the limits
decoded from `settle()` calldata. A sample of 407 trades covered every way that calldata reaches the
settlement contract: a direct call, the flash-loan router, and solver contracts that pass the call
on. Every decoded trade reproduced its `Trade` event exactly, and the limits, order kinds and fees
of 80 of 80 orders checked agree with CoW's order API (`api.cow.fi/base/api/v1/orders/{uid}`).

To check a block range yourself, `node src/cli.ts window --from <block> --to <block>` in
`apps/indexer` prints its totals and per-solver table from the database (see
[Development](development.md#the-indexer)).
