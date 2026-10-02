# Design brief

How Fiberscope's UI is designed in [Claude Design](https://claude.com/product/design), and the brief to paste into it.

## 1. Approach

| Version | Setup                                                                                                                                                                            | Result                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1      | Fibrous design system generated from `fibrous-interface`                                                                                                                         | Assembled from the Fibrous app's own components. The team found its navbar, footer, logo and charts weak; the review found solver colours that were hard to tell apart and light-theme text below WCAG AA. |
| v2      | No design system; a long brief that prescribed the visuals (glow, background pattern, frosted surfaces, gradient fills, value chips, eight sparkline KPI cards, bubble chart, …) | Claude Design applied them literally and the result looked generic: a 4,065px page with 18 cards and 9-colour stacked charts.                                                                              |
| v3      | No design system; a short brief with the product context, the readers, the Fibrous brand basics and real data                                                                    | Chosen: a single editorial page with solvers in greyscale and teal only for the interface. It uses Geist and Geist Mono instead of Urbanist and Rubik (pending kermo's decision).                          |

## 2. Start the project

Start a new project; the v2 project's chat carries the old brief.

| Control             | Setting                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template            | **Blank**                                                                                                                                                                                               |
| Design system       | **None**                                                                                                                                                                                                |
| `+` (attach)        | `Urbanist-Variable.ttf`, `Rubik-Variable.ttf` and the Fibrous mark (`public/favicon.svg` in `fibrous-interface`). They come from the private `fibrous-interface` repository and are not committed here. |
| `</>` (attach code) | Empty                                                                                                                                                                                                   |
| Model               | Default                                                                                                                                                                                                 |

Paste the brief from section 6 and send.

## 3. Result

One page, in this order: a headline generated from the data with a waffle chart (one square per batch), headline figures, **Who is winning** (sortable table; clicking a row opens the solver's details), **Is it changing** (top-8 small multiples), **Who enters, who wins** (participation and win rate, latest-auctions strip), **How efficiently** (gas per trade against the network average) and **Methodology** (definitions and a disclosure that Fibrous also runs a solver).

The table, the expanded row and the Methodology section replace the separate ranking, solver and methodology pages planned earlier.

In the prototype, only the 24 hours to 2026-10-02 10:35 UTC are real. Older history, rank changes, previous-period deltas and the auction strip are synthetic.

## 4. Remaining work

Scope at launch: English only, with the code set up so translations can be added later; the network menu keeps Base and the three upcoming networks the design lists (Ethereum, Arbitrum, Gnosis), and more are added as they launch.

Not in the design yet:

1. Verifiability: solver addresses (prod and barn) with copy and Basescan links, each solver's latest settlements with CoW Explorer and Basescan links, and auctions in the strip linking to their settlement.
2. Loading, empty, error and stale-data states.
3. Code-only: a 404 page, a link preview image, keyboard-operable table rows, Methodology text aligned with section 7, and names for the unnamed solvers.

Items 1 and 2 are designed in the v3 project with this message:

```text
Keep everything that exists exactly as it is. Add only:
1. In the expanded solver row: prod and barn addresses with copy and
   Basescan links, and the solver's latest settlements (time, trades, pair,
   volume, gas, links to CoW Explorer and Basescan). Each auction in the
   latest-auctions strip links to its settlement on CoW Explorer.
2. Loading, empty, error and stale-data states, switchable in Tweaks.
```

Both are done: the second design round (handoff 2.0.0) added them together with a 404 page, a link preview image, keyboard focus styles, the "not affiliated with CoW DAO" line and the final Methodology copy, and `apps/web` implements all of it.

## 5. Review, share, hand off

For review, use **Export → Export as standalone HTML**. Share links only open for members of your Claude organization; send the HTML file, or a Vercel preview from the Export menu, to anyone else, and say it is a prototype with sample data.

Once approved: **Export → Handoff to Claude Code**, and paste the prompt it gives into a coding-agent session in this repository. The export runs on Claude Design's own runtime, so the handoff is a reimplementation in Next.js rather than a copy.

## 6. Brief

```text
Fiberscope: a public, open-source analytics site for CoW Protocol solvers,
starting with Base (more CoW networks later).

On CoW Protocol, solvers compete in batch auctions to settle users' trades.
CoW's own "Solver Info" dashboard lives on Dune, and since Dune's free tier
became view-only most visitors can no longer refresh it. Fiberscope keeps
that view up to date, adds what Dune never showed (which solvers enter each
auction and how often they win), and will be proposed to the CoW DAO Grants
Program as a public good.

Readers are solver teams, the CoW DAO grants committee and researchers. At a
glance they should see who is winning on Base, by how much, whether that is
changing, and how efficiently each solver settles. It should feel credible:
clear labels, defined metrics, visible data freshness.

Fiberscope is built by Fibrous, which is itself one of the solvers, so every
solver is treated the same; Fibrous appears only as a small "Built by
Fibrous" credit (mark attached). The interface carries the Fibrous brand:
teal #11B2BA, dark navy #1B1F2C (light theme #F7F8F8), Urbanist for text and
Rubik for numbers (fonts attached). Light and dark themes; works on mobile.
Everything else is your call.

Start with the main page, in two clearly different directions we can choose
between.

Real data: Base, the 24 hours to 2026-10-02 10:35 UTC. Invent plausible
history for longer periods. Participation and win rate come from CoW's
auction data (about 9 competing solutions per auction).
Solver | Batches | Trades | Volume $ | Gas/trade | Participation | Win rate
0x588e…5e30 (unnamed) | 1,711 | 1,808 | 444,238 | 468K | 87% | 58%
Helixbox | 474 | 525 | 285,674 | 884K | 61% | 10%
Rizzolver | 317 | 317 | 1,572,725 | 302K | 26% | 33%
Fibrous | 232 | 232 | 165,217 | 774K | 54% | 22%
0x5c35…fce1 (unnamed) | 210 | 229 | 953,776 | 999K | 63% | 11%
Arc | 169 | 169 | 52,998 | 1.37M | 46% | 14%
Wraxyn | 131 | 131 | 374,989 | 766K | 45% | 6%
BRRRolver | 126 | 132 | 322,659 | 805K | 57% | 4%
Kipseli | 120 | 129 | 476,706 | 873K | 45% | 13%
Kaisersolver | 65 | 65 | 2,357 | 383K | 54% | 1%
Horadrim | 31 | 41 | 24,564 | 503K | 37% | 1%
Baseline | 21 | 26 | 53 | 196K | 15% | 7%
Rosato | 14 | 14 | 3,559 | 1.52M | 28% | 17%
BitgetWallet | 12 | 12 | 52,994 | 2.15M | 57% | 0%
Dsolver | 10 | 10 | 1,475 | 477K | 53% | 1%
Tsolver | 4 | 4 | 137,586 | 2.04M | 38% | 0%
Elfomo | 2 | 2 | 1,520 | 842K | — | —
Gnosis_BalancerSOR | 2 | 2 | 13 | 449K | 3% | 0%
OKX | 1 | 1 | 56 | 885K | 31% | 0%
Totals: 3,652 batches, 3,849 trades, $4.87M volume, 19 solvers.
```

## 7. Metric definitions

The definitions the implementation follows; the page's Methodology section says the same in plain words.

```text
- Batch: one settlement transaction with at least one trade (zero-trade
  buffer/withdrawal settlements are excluded).
- Trade: one filled order (Trade event) inside a settlement.
- Volume (USD): per trade, the lower of the sell-side and buy-side value,
  priced with the auction's native prices × Chainlink ETH/USD at the
  settlement block (guards against mispriced tokens). With one side priced,
  that side; with neither, the trade has no volume (none so far).
- Gas per trade: settlement gas used / trades in it; the network average is
  weighted by trades.
- Entered (participation): share of the window's auctions in which the
  solver submitted at least one solution. Auctions are found through their
  settlements, so only auctions that ended in a settlement count.
- Win rate: auctions won / auctions entered (an auction can have several
  winners).
- Solver attribution: a settlement is credited to the Settlement event's
  solver. Settlements executed through CoW's flash-loan router (0x9da8…2c69)
  go to the solver behind them: the transaction's recipient when it is a
  registered or allow-listed solver contract (Rizzolver, BRRRolver and
  Kipseli send through per-transaction helper addresses to their contract),
  else its sender when registered or allow-listed, else the auction's winner
  for that transaction from CoW's API.
- Solver names: CoW's public solver registry (cms.cow.fi, which feeds
  cow.fi and CoW Explorer), checked against the on-chain allow-list, plus a
  small overrides file for addresses the registry lacks; unknown addresses
  are shown shortened.
- Windows: rolling day buckets ending at the last indexed block. A window
  with less history than its length says so on the page.
- Sources: GPv2Settlement events and receipts on Base (0x9008…ab41), CoW's
  solver-competition API, Chainlink ETH/USD on Base.
```

## 8. Solver addresses

Prod / barn addresses on Base for the validation window, checked against Dune's Solver Info, the Spellbook solver list and on-chain settlements. Names now come from CoW's registry at run time (the two unnamed solvers are Nexroute and Sector Finance; BitgetWallet is BitGet, Gnosis_BalancerSOR is Balancer API); Rizzolver's current prod address is not in the registry and lives in `apps/indexer/src/overrides.ts`.

```text
Nexroute: 0x588ef3de14875ff9c4fc74c9e2c308767d665e30
Helixbox: 0xffd98b05962fca73cdfd22ed73198dfb2e5241eb / 0x2ee19d575d58ddfde8086078323e50f34f0d7a70
Rizzolver: 0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7 / 0x707dfa95835542a6528fd077c351446f497276cf
Fibrous: 0xa95157266e0f53d2762fd8a885d4cdb2409eb29e / 0x3ace981a4bef82fd123257bf9b3fc304191a6fd8
Sector Finance: 0x5c3593481cba011737e36ded62f1797c9f6afce1
Arc: 0x4566961fa9a5f38a7ef18ca2bd6459869305f010 / 0xfff69057784015fb6bd36767ae632c435e0346d1
Wraxyn: 0xa2e28dedaab59d732ae375832fb855510aa7fe57 / 0x0c4aef2fc24529b08dad1bcabf4537cb1e0b5157
BRRRolver: 0xb222da0155640eb2f604164d4a3684139dcc1f95 / 0xb222da076c21b7784a975dd54fd09c0f7c21262f
Kipseli: 0xbee162fa5ae892be74f3f3e01c23da89adbccccc / 0x9775be2bb0b72d4ea98bfd38024ef733dc048a30
Kaisersolver: 0x4c7bdd2d75050c4fdb84ad47dd328dc5c07d7743 / 0x68ebc0d91c951ec9471b7ece57558315fced84f6
Horadrim: 0xea270e6cad15c5bafa35b9019bec7087ff82d8e8
Baseline: 0x69d7f96dfd091652f317d0734a5f2b492accbe07 / 0x8d98057b8c3d6c7cb02f1c1be7e37d416f2d3e96
Rosato: 0x70f5474ea078a63f874695ea2ed99aebc4ad4393 / 0x728a498a1ff4c7d64f48b5b7fefd72fdde010613
BitGet: 0x48573687867c72957926c4eb1a6e95e7ce6cf2fb / 0xa1789d24ede2d75b737cc180df762e31dfaf64ed
DSolver: 0x0195214d609edc3032366eb5c977d26d46d0a661 / 0x7627043a5ccd976bad8d6ab8a7003c7bd5703b86
Tsolver: 0x3980daa7eaad0b7e0c53cfc5c2760037270da54d / 0xac73db8296f6be1836288da8a57c0f29379741e2
Elfomo: 0x2c975c34d54ad06607f8ea14519c36f91275349d / 0x07cad32e40a92a86e7f2e7b373baaf4704d92c5b
Balancer API: 0x983ac485620e265730e367b2c7bcbf6eb9d62a21 / 0x9451d27c993f7a61096bfc33e0241644a7566f66
OKX: 0xd875cd50b179a046512c80edf6cb2c1fc3f3072d / 0x4ead087d78c21fd95d30411928a2ade7456f56f4
```
