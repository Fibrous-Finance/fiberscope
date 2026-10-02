# Design brief

How Fiberscope's UI is designed in [Claude Design](https://claude.com/product/design), and the brief to paste into it.

## 1. Design system: "Fibrous"

Fiberscope uses the Fibrous visual language with neutral content (see the neutrality rules in the brief).

Use **Create here**, not **Create using Claude Code**:

- *Create using Claude Code* runs `/design-sync`, which compiles a React component library (a package with a built `dist/`, or a Storybook) and uploads it. `fibrous-interface` is a Next.js app with neither, and its components depend on app-level providers (stores, i18n, wallet). A first sync on a large repository can also take hours.
- Fiberscope needs the Fibrous look (colors, type, surfaces), not its swap components. *Create here* extracts that from code and screenshots.

Steps:

1. Claude Design → **Set up your design system** → **Create here**.
2. **Connect GitHub** → `Fibrous-Finance/fibrous-interface`. The relevant sources are `styles/globals.css` (light and dark tokens), `tailwind.config.js`, `hero.ts` (HeroUI theme) and `config/fonts.ts`.
   If the Claude GitHub app cannot access the organization, skip this step and paste the token table below into the chat instead.
3. Upload screenshots of [app.fibrous.finance](https://app.fibrous.finance) in light and dark mode.
4. Name it **Fibrous**, compare the generated palette and type with the table below, fix differences in the chat, then publish it.

| Token | Light | Dark |
|---|---|---|
| Page (`bg-primary`) | `#F7F8F8` | `#1B1F2C` |
| Card (`bg-secondary`) | `#FFFFFF` | `#272D3E` |
| `bg-tertiary` | `#EDEEF1` | `#151924` |
| `bg-quaternary` | `#E2E3E5` | `#0D1016` |
| Text primary | `#272D3E` | `#FFFFFF` |
| Text secondary | `#8E95A2` | `#B6BAC3` |
| Text muted | `#7D7F82` | `#7D7F82` |
| Border | `#EDEEF1` | `#445371` |
| Accent | `#11B2BA`, hover `#0FA0A7`, muted `#1C6F7C` | same |
| Success / warning / error | `#3BC171` / `#FFB800` / `#FF647C` | same |
| Fonts | Urbanist (UI), Rubik (numbers) | same |

## 2. Fiberscope project

1. New project → select the **Fibrous** design system.
2. Attach a screenshot of Dune's [Solver Info](https://dune.com/cowprotocol/solver-info) dashboard as the reference Fiberscope replaces.
3. Paste the brief from section 4. Build the Overview page first, then the remaining pages.
4. Iterate: chat for structure, inline comments for single components, "show 2–3 variants" when unsure.
5. Share for review. Share links are scoped to your Claude organization; reviewers outside it need a standalone HTML or PDF export, or a preview deployment via **Export → Vercel**.

## 3. Handoff

When the design is approved: **Export → Handoff to Claude Code → Send to local coding agent**, run from this repository. Alternatively download the `.zip` into `design/` and implement from there.

## 4. Brief

```text
Design a public analytics dashboard: "Fiberscope" —
CoW Protocol solver analytics for Base.
Logo: simple "Fiberscope" wordmark with a minimal lens/aperture icon drawn from
thin fiber lines, in the accent color. Tagline: "CoW Protocol solver analytics".

Context
- CoW Protocol settles user orders via batch auctions; "solvers" compete to
  win each auction and settle it on-chain.
- Replaces the Dune dashboard "CoW Protocol Solver Info" (screenshot attached),
  which can no longer be refreshed on Dune's free plan.
- Audience: solver teams, CoW DAO grants committee, researchers.
  Data-dense but scannable. Desktop-first, usable on mobile.

Visual language: Fibrous (use the attached Fibrous design system)
- Accent #11B2BA (hover #0FA0A7).
  Light: page #F7F8F8, card #FFFFFF, subtle #EDEEF1, text #272D3E / #8E95A2.
  Dark: page #1B1F2C, card #272D3E, deep #151924, text #FFFFFF / #B6BAC3,
  border #445371.
  Status: success #3BC171, warning #FFB800, error #FF647C.
- Fonts: Urbanist for UI, Rubik for numbers (tabular figures).
- Rounded cards (~16px radius). Light + dark theme, following system setting.

Neutrality rules (important)
- The product has its own name; no Fibrous logo in the header.
  Footer only: "Built by Fibrous" + GitHub + Methodology.
- Fibrous is just one solver in the data: never highlighted, pinned or given
  a special color. The accent color is for UI controls only, never for a
  solver. Solvers use a neutral categorical palette; each solver keeps the
  same color across all charts.
- No promotional CTAs.

Internationalization
- Default English; language switcher in the header
  (en, tr, de, es, fr, ja, pl, ru, uk, vi, zh).
- Layout must handle longer strings (de, ru) and CJK. Solver names,
  addresses and token symbols are never translated; numbers and dates use
  locale formatting.

Global
- Header: product name; network selector (Base active; Ethereum, Gnosis,
  Arbitrum, Polygon, Avalanche, BNB, Linea, Plasma, Ink marked "soon");
  period selector 24h / 7d / 30d / All; "Updated 2 min ago"; theme toggle;
  language switcher.
- Addresses shortened (0x588e…5e30) with copy button + Basescan link.
- Loading skeletons, empty and error states.

Pages
1. Overview: KPI cards (Batches, Trades, Volume USD, Active solvers,
   Avg gas per trade); stacked bars "Batches per day by solver"; stacked area
   "Volume per day by solver"; batch share chart; top-10 ranking preview.
2. Ranking: sortable table — Rank, Solver, Batches, Share %, Trades,
   Volume $, Avg trade $, Gas/trade, DEX swaps/trade, Participation %,
   Win rate %, Last settlement. Search + period filter.
3. Solver detail (example: Helixbox): name, prod/barn addresses, KPI cards,
   time series (batches, volume, win rate, gas/trade), competition panel
   (participation, win rate, avg rank, solutions per auction, filtered-out),
   recent settlements.
4. Settlements: paginated table — time, solver, trades, token pair, volume $,
   gas used, tx cost $ (L2+L1), links to CoW Explorer + Basescan;
   filter by solver.
5. Methodology: text page using the definitions below.

Metric definitions (Methodology page)
- Batch: one settlement transaction with at least one trade
  (zero-trade buffer/withdrawal settlements are excluded).
- Trade: one filled order (Trade event) inside a settlement.
- Volume (USD): per trade, the lower of sell-side and buy-side value, priced
  with the auction's native prices x ETH/USD (guards against mispriced tokens).
- Gas per trade: settlement gas used / trades in it.
- Tx cost: L2 execution fee + L1 data fee, in USD.
- DEX swaps per trade: settlement interactions excluding token approvals and
  WETH unwraps, / trades.
- Participation: share of auctions where the solver submitted >=1 solution.
- Win rate: auctions won / auctions entered (an auction can have several
  winners).
- Solver names: on-chain allow-list + open name registry; unknown addresses
  shown shortened.
- Sources: GPv2Settlement events on Base (0x9008…ab41) + CoW Orderbook API.

Sample data (real, Base, 24h ending 2026-10-02 10:35 UTC).
Totals: 3,652 batches, 3,849 trades, $4.93M volume, 20 solvers.
Generate plausible 30-day series around these daily values (±20%).
Solver | Batches | Share | Trades | Volume $ | Gas/trade | Particip. | Win rate
0x588e…5e30 (unnamed) | 1652 | 45.2% | 1745 | 446,811 | 458k | 87% | 58%
Helixbox | 402 | 11.0% | 450 | 258,376 | 847k | 61% | 10%
Rizzolver | 301 | 8.2% | 301 | 1,488,889 | 264k | 26% | 33%
Fibrous | 232 | 6.4% | 232 | 166,074 | 774k | 54% | 22%
0x5c35…fce1 (unnamed) | 209 | 5.7% | 228 | 972,275 | 996k | 63% | 11%
0x9da8…b484 (unnamed) | 195 | 5.3% | 203 | 183,784 | 1.03M | — | —
Arc | 168 | 4.6% | 168 | 43,443 | 1.36M | 46% | 14%
Wraxyn | 131 | 3.6% | 131 | 378,603 | 766k | 45% | 6%
BRRRolver | 109 | 3.0% | 114 | 313,598 | 723k | 57% | 4%
Kipseli | 106 | 2.9% | 115 | 449,689 | 786k | 45% | 13%

Start with the Overview page only.
```
