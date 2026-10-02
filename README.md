# Fiberscope

Open-source analytics for [CoW Protocol](https://cow.fi) solvers, starting with Base.

CoW Protocol settles user orders through batch auctions in which solvers compete to find the best settlement. Fiberscope shows who competes, who wins, and how efficiently each solver settles: batches, trades, volume, gas, and auction-level competition metrics.

## Why

CoW's [Solver Info](https://dune.com/cowprotocol/solver-info) dashboard lives on Dune. Since 10 September 2026, Dune's legacy free accounts are view-only, so most viewers can no longer refresh the dashboard or change its parameters. Fiberscope rebuilds that view on public data sources, free to view and continuously updated, and adds competition metrics the Dune dashboard does not have: participation, win rate, ranking and filtered-out solutions.

## Scope

- **Now:** Base.
- **Next:** the other CoW Protocol networks: Ethereum, Gnosis, Arbitrum, Polygon, Avalanche, BNB, Linea, Plasma and Ink. The protocol contracts share the same addresses on every network and the Orderbook API has the same shape, so each network is mostly configuration.

## Data sources

| Source | Provides |
|---|---|
| `GPv2Settlement` (`0x9008D19f58AAbD9eD0D60971565AA8510560ab41`) events `Settlement`, `Trade`, `Interaction`, plus transaction receipts | Batches, trades, DEX interactions, gas, L2 and L1 fees |
| `GPv2AllowListAuthentication` (`0x2c4c28DDBdAc9C5E7055b4C863b72eA0149D8aFE`) events `SolverAdded`, `SolverRemoved` | Which addresses are solvers |
| CoW Orderbook API `GET /api/v2/solver_competition/by_tx_hash/{tx}` | Every solution submitted to the auction (solver, score, ranking, winner, filtered-out) and native token prices |

Page specs and metric definitions: [docs/design-brief.md](docs/design-brief.md).

## Planned layout

```text
apps/web        Next.js dashboard (next-intl, Fibrous visual language)
apps/indexer    Base indexer: settlement events, receipts, auction data
packages/core   Network config, solver registry, metric logic
packages/db     Postgres schema and migrations
```

## Status

- [x] Data feasibility check against Base mainnet (public RPC and CoW Orderbook API)
- [ ] Design in Claude Design ([docs/design-brief.md](docs/design-brief.md))
- [ ] Indexer and API for Base
- [ ] Web app
- [ ] Public launch and CoW Grants application

## License

[MIT](LICENSE)
