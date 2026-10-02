# Design brief

How Fiberscope's UI is designed in [Claude Design](https://claude.com/product/design), and the brief to paste into it.

## 1. Design system: "Fibrous"

Fiberscope uses the Fibrous visual language with neutral content (see the neutrality rules in the brief).

Use **Create here**, not **Create using Claude Code**:

- *Create using Claude Code* runs `/design-sync`, which compiles a React component library (a package with a built `dist/`, or a Storybook) and uploads it. `fibrous-interface` is a Next.js app with neither, and its components depend on app-level providers (stores, i18n, wallet). A first sync on a large repository can also take hours.
- Fiberscope needs the Fibrous look (colors, type, surfaces), not its swap components. *Create here* extracts that from code and screenshots.

Fill in the **Set up your design system** form:

| Field | What goes in |
|---|---|
| Company name and blurb | The blurb below |
| Link code from GitHub | Empty |
| Link code from your computer | A folder with only the design-relevant parts of `fibrous-interface` (the form recommends a frontend-focused subfolder for large codebases): `styles/globals.css`, `tailwind.config.js`, `hero.ts`, `config/fonts.ts`, and general components (navbar, footer, network and locale switches, cards, tables, chips, tooltips, modals, skeletons, leaderboard, icons). It is private `fibrous-interface` code, so it is not committed here. |
| Upload a .fig file | Empty |
| Add fonts, logos and assets | Fibrous mark (`public/favicon.svg`), `public/og-image.png`, Urbanist and Rubik font files, and screenshots of the app.fibrous.finance swap and leaderboard pages in light and dark mode |
| Any other notes | The notes below |

Company name and blurb:

```text
Fibrous — multi-chain DEX aggregator (app.fibrous.finance) on Starknet, Base,
HyperEVM and Monad, and a CoW Protocol solver on Base. Web app with swap and
route visualization, Predict, a points leaderboard and settings, in light and
dark themes. This design system will also be used for Fiberscope, a public
analytics dashboard for CoW Protocol solvers.
```

Any other notes:

```text
Source of truth for color: the CSS variables in styles/globals.css (light and
dark sets). Accent teal #11B2BA (hover #0FA0A7, muted #1C6F7C).
Light: page #F7F8F8, cards #FFFFFF. Dark: page #1B1F2C, cards #272D3E.
Status: success #3BC171, warning #FFB800, error #FF647C.
Fonts: Urbanist for UI text, Rubik for numbers.
Look: calm and technical; rounded cards (~16px) on a subtle line-pattern
background; darker inset wells for inputs; small pill badges; soft icon
buttons. Teal is reserved for primary actions, active states and key figures.
Built with HeroUI + Tailwind CSS v4.
Extract the visual language and general components: navbar, cards, KPI stat
cards, tables with rank badges and identicon avatars, search inputs,
chips/segmented controls, dropdowns, switches, tooltips, modals, skeletons,
empty states. Ignore wallet and swap business logic.
For dashboards: a categorical chart palette that does not reuse the accent
teal, and tabular figures for all numbers.
```

Then **Continue to generation**. Compare the result with the table below, fix differences in the chat, and publish it.

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

## 2. Start the project

On the Claude Design home screen:

| Control | Setting |
|---|---|
| Template | **Blank** |
| Design system | **Fibrous Design System** |
| `+` (attach) | Screenshots of Dune's [Solver Info](https://dune.com/cowprotocol/solver-info?aggregate_by_ec268c=Day&blockchain_edb9f7=base) dashboard for Base: the top section (active solvers, rewards), the ranked solver table and the daily solver charts. They show the content Fiberscope replaces, not a visual style. Dune's UI is third-party, so they are not committed here. |
| `</>` (attach code) | Empty. The design system already carries the Fibrous look, and this repository has no UI code yet. |
| Model | Default |

Paste the brief from section 7 and send. Generation can take several minutes: Claude plans, builds, then checks its own output.

## 3. Review the first version

- Header: Fiberscope wordmark, network selector (Base active, the rest "soon"), period selector, last-updated time, theme toggle, language switcher.
- Neutrality: no solver drawn in the accent teal; Fibrous neither highlighted nor pinned; "Built by Fibrous" only in the footer.
- Numbers in Rubik with tabular figures (Rubik has `tnum`, Urbanist does not), right-aligned in tables.
- Charts stay readable: top 8 solvers plus "Other", and each solver has the same color everywhere.
- Light and dark themes both work.

Fix single elements with inline comments and keep the chat for structural changes; a full re-prompt regenerates parts that were already right. Every variant draws on the same usage limits, so ask for alternatives only where the direction is unclear:

```text
Show two alternative Overview layouts side by side: one chart-first, one
table-first. Keep the header, footer and solver colors identical.
```

## 4. Follow-up prompts

Send them in order, each once the previous result looks right.

1. ```text
   Build page 2, Ranking, as described in the brief. Reuse the header, footer,
   components and solver colors from the Overview.
   ```
2. ```text
   Build page 3, Solver detail, for Helixbox. Clicking a solver name, table row
   or chart legend entry anywhere opens that solver's page.
   ```
3. ```text
   Build page 4, Settlements, as described in the brief.
   ```
4. ```text
   Build page 5, Methodology, from the metric definitions in the brief, and make
   the metric labels on the other pages link to their definitions.
   ```
5. ```text
   Add a small review-only state switcher in the bottom-right corner that
   toggles Loaded, Loading, Empty and Error on every page.
   ```
6. ```text
   Make the language switcher swap the visible UI strings to German and
   Japanese (sample translations) so we can check long strings and CJK layout.
   ```
7. ```text
   Check every page at 390px width and in both themes and fix what breaks.
   Then audit the prototype for the neutrality rules and accessibility
   (contrast, focus states, keyboard navigation): list the issues, then fix them.
   ```

## 5. Share for review

Share links only open for members of your Claude organization. For reviewers outside it, use **Export → Export as standalone HTML** and send the file, or send it to Vercel from the Export menu for a link. Say it is a prototype with sample data every time you share it.

## 6. Handoff

After approval: **Export → Handoff to Claude Code**. It bundles the design files, the chat and a README, and gives a prompt with the bundle URL; paste that prompt into a coding-agent session in this repository.

The chat travels with the bundle, so state design decisions there, and make sure loading, empty and error states exist (follow-up prompt 5) before handing off.

## 7. Brief

```text
Design a public analytics dashboard: "Fiberscope" —
CoW Protocol solver analytics for Base.
Logo: simple "Fiberscope" wordmark with a minimal lens/aperture icon drawn from
thin fiber lines, in the accent color. Tagline: "CoW Protocol solver analytics".

Context
- CoW Protocol settles user orders via batch auctions; "solvers" compete to
  win each auction and settle it on-chain.
- Replaces the Dune dashboard "CoW Protocol Solver Info", which can no longer
  be refreshed on Dune's free plan. Screenshots attached for content
  reference only; do not copy Dune's visual style.
- Audience: solver teams, CoW DAO grants committee, researchers.
  Data-dense but scannable. Desktop-first, usable on mobile.
- Primary job: within ten seconds a visitor sees who is winning Base auctions
  in the selected period, by how much, and whether that is changing. It must
  stay trustworthy: every metric links to its definition on the Methodology
  page, and the last-updated time is always visible.

Output
- An interactive, responsive web prototype. It will be handed off to Claude
  Code and built in Next.js with next-intl, so name components clearly
  (KpiCard, SolverBadge, PeriodSelector, RankingTable, ...) and reuse them
  across pages.
- Header navigation switches pages (pages not built yet can be placeholders),
  the theme toggle works, and clicking a solver opens its detail page.

Visual language: Fibrous Design System (selected for this project)
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
- Charts show the top 8 solvers of the selected period and group the rest as
  "Other" in gray; a solver's color belongs to the solver, not its rank.
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
Participation and win rate come from a 183-auction sample in the last
82 minutes of that window.
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
Kaisersolver | 52 | 1.4% | 52 | 2,057 | 271k | 54% | 1%
Horadrim | 31 | 0.8% | 41 | 24,706 | 503k | 37% | 1%
Baseline | 20 | 0.5% | 25 | 60 | 186k | 15% | 7%
Rosato | 14 | 0.4% | 14 | 3,582 | 1.52M | 28% | 17%
BitgetWallet | 11 | 0.3% | 11 | 53,632 | 2.29M | 57% | 0%
Dsolver | 10 | 0.3% | 10 | 1,494 | 477k | 53% | 1%
Tsolver | 4 | 0.1% | 4 | 138,508 | 2.04M | 38% | 0%
Elfomo | 2 | 0.1% | 2 | 1,529 | 842k | — | —
Gnosis_BalancerSOR | 2 | 0.1% | 2 | 13 | 449k | 3% | 0%
OKX | 1 | <0.1% | 1 | 56 | 885k | 31% | 0%

Start with the Overview page only.
```
