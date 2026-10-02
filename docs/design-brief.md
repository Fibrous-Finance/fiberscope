# Design brief

How Fiberscope's UI is designed in [Claude Design](https://claude.com/product/design).

## 1. What we learned

| Attempt | Setup | Result |
|---|---|---|
| v1 | Fibrous Design System attached | Sound structure, but assembled from the Fibrous app's own components (navbar, charts, tables), which do not suit a data product. Solver colours were hard to tell apart and light-theme text failed WCAG AA. |
| v2 | No design system; a 270-line specification | Generic "AI slop". The brief asked for decorative effects (teal glow, background pattern, frosted tooltips, gradient fills, a pulsing dot, an accent "used with confidence"), eight Overview sections, three logos and palette options at once, with all data pasted inline. |

The look is now set by reference screenshots rather than described effects, and settled on a small slice before any page is built. Prompts stay short and take one step at a time; detail fixes go through inline comments. A weak result is replaced, not repaired by further prompts, which keep its base.

## 2. Style tiles

Start a new project: **Blank** template, no design system, nothing in `</>`. Attach the Urbanist and Rubik font files and the three reference screenshots below. They are screenshots of third-party products, so they are not committed here.

| File | Direction | Source |
|---|---|---|
| `ref-a-plausible.png` | A · Quiet | [Plausible live demo](https://plausible.io/plausible.io), dark |
| `ref-b-cloudflare-radar.png` | B · Dense | [Cloudflare Radar](https://radar.cloudflare.com/), dark, promo banner cropped |
| `ref-c-tremor.png` | C · Product | [Tremor dashboard demo](https://dashboard.tremor.so/), dark |

```text
Fiberscope: a style exploration, not a page yet.

Fiberscope is a public dashboard that shows which solvers win CoW Protocol
batch auctions on Base. Its readers (solver teams, the CoW DAO grants
committee) come to compare solvers by their numbers, so the numbers and the
ranking are the product and everything else steps back. An earlier attempt
looked like generic AI output; restraint matters more than effects.

On one canvas, show the same small slice in three directions side by side,
labelled A, B and C, dark theme only, about 720px wide each:
- top bar: "Fiberscope" as plain text (no logo yet), Overview, Ranking,
  Settlements, Methodology, the network "Base", and the period control
  24h / 7d / 30d / All;
- the four headline numbers below;
- one chart that shows who settled the most batches over the last 24 hours
  and whether that changed (the five solvers below plus Other); each
  direction picks its own chart form;
- the five ranking rows below.

Directions (the attached screenshots set the quality bar; do not copy their
layouts, colours or branding):
A) Quiet, like ref-a-plausible.png: near-monochrome, solvers in grays with
   only the leader in one calm colour, large numbers, generous space.
B) Dense, like ref-b-cloudflare-radar.png: compact rows and small type, many
   numbers visible at once, minimal chrome.
C) Product, like ref-c-tremor.png: borderless sections separated by
   hairlines, five distinct colour-blind-safe solver colours.

All directions:
- Fonts (attached): Urbanist for text; Rubik with tabular figures for every
  number; numbers right-aligned in tables.
- Page #1B1F2C. Teal #11B2BA only for the active nav item, the selected
  period, links and focus; never a solver colour.
- No gradients, glows, blur or glass, background patterns, heavy shadows,
  animated or pulsing elements, emoji, illustrations or decorative icons.
- No Fibrous branding.

Data: Base, last 24 hours
Batches 3,652 · Trades 3,849 · Volume $4.87M · Active solvers 19
Rank | Solver | Batches | Share | Volume | Gas/trade | Win rate
1 | 0x588e…5e30 | 1,711 | 46.9% | $444K | 468K | 58%
2 | Helixbox | 474 | 13.0% | $286K | 884K | 10%
3 | Rizzolver | 317 | 8.7% | $1.57M | 302K | 33%
4 | Fibrous | 232 | 6.4% | $165K | 774K | 22%
5 | 0x5c35…fce1 | 210 | 5.8% | $954K | 999K | 11%
Other (14 solvers): 708 batches, 19.4%, $1.45M
Make up a plausible hourly split. Static is fine: no interactivity, light
theme or other pages yet.
```

Pick one direction, or a named mix such as "B's density with A's use of colour". Refine it with inline comments until it feels right; it then sets the look of every page.

## 3. After a direction is chosen

1. Overview: built in the chosen direction from the content reference (section 6), with the sample data attached as a file instead of pasted. Its prompt is written once the direction is known.
2. Logo: a separate, small exploration once the Overview exists.
3. Ranking, Solver detail, Settlements and Methodology: one prompt each, reusing the Overview's components.
4. Checks: German, Russian and Japanese strings; 390px width; light theme; neutrality and accessibility.

If the style tiles miss as well, the fallback is to design directly in code in this repository, reviewed through screenshots and a preview deployment.

## 4. Share for review

Review at two checkpoints: once the Overview is settled, so the visual direction is confirmed before the other pages copy it; and once every page exists, before the handoff. For each one, export the prototype as standalone HTML and check it at desktop and 390px widths, in both themes.

Share links only open for members of your Claude organization. For reviewers outside it, use **Export → Export as standalone HTML** and send the file, or send it to Vercel from the Export menu for a link. Say it is a prototype with sample data every time you share it.

## 5. Handoff

After approval: **Export → Handoff to Claude Code**. It bundles the design files, the chat and a README, and gives a prompt with the bundle URL; paste that prompt into a coding-agent session in this repository. The implementation uses Fiberscope's own Tailwind tokens and chart components.

The chat travels with the bundle, so state design decisions there before handing off.

## 6. Content reference

Pages, behaviour, metric definitions and verified sample data for the steps in section 3. It is not a prompt to paste whole: the look comes from the chosen style tile.

```text
Fiberscope — CoW Protocol solver analytics, starting with Base.

Context
- CoW Protocol settles user orders via batch auctions; "solvers" compete to
  win each auction and settle it on-chain.
- Replaces the Dune dashboard "CoW Protocol Solver Info", which can no longer
  be refreshed on Dune's free plan. The Dune screenshots are attached for
  content only: match or exceed their information density, not their look.
- Audience: solver teams, CoW DAO grants committee, researchers.
  Data-dense but scannable. Desktop-first, fully usable at 390px.
- Primary job: within ten seconds a visitor sees who is winning Base auctions
  in the selected period, by how much, and whether that is changing. It must
  stay trustworthy: every metric links to its definition on the Methodology
  page, and the last-updated time is always visible.

Output
- An interactive, responsive web prototype. It will be handed off to Claude
  Code and built in Next.js with next-intl, so name components clearly
  (AppHeader, KpiCard, SolverBadge, PeriodSelector, StackedBarChart,
  RankingTable, ...) and reuse them across pages.
- Header navigation switches pages (pages not built yet can be placeholders),
  the theme toggle works, and clicking a solver anywhere opens its page.
- Tweaks: dataState (live / loading / empty / error), minutesSinceUpdate,
  and 2–3 solver palette options to compare.

Identity
- Fonts: Urbanist for UI; Rubik for every number, with tabular figures.
- Accent teal #11B2BA (hover #0FA0A7), used sparingly: the active nav item,
  selected controls, focus rings, links and primary buttons. Text on teal is
  #1B1F2C (white on teal is only 2.6:1).
- Dark theme: page #1B1F2C, cards #272D3E, deep #151924, border #445371,
  text #FFFFFF / #B6BAC3.
- Light theme: page #F7F8F8, cards #FFFFFF, subtle #EDEEF1, text #272D3E,
  secondary text #646B78.
- Status: success #3BC171, warning #FFB800, error #FF647C. As text on tinted
  backgrounds: red #C42B48 and green #157A3E in the light theme, red #FF7A8F
  in the dark theme, so all text meets WCAG AA.
- No gradients, glows, blur or glass, background patterns, animated or
  pulsing elements, emoji, illustrations or decorative icons.
- The theme follows the system setting by default.

Neutrality rules (important)
- No Fibrous logo or name in the header. The attached Fibrous mark appears
  only in the footer, next to "Built by Fibrous".
- Fibrous is just one solver in the data: never highlighted, pinned, or
  given a special colour or position.
- Teal is never a solver colour.
- No promotional CTAs.

Logo
- Replace the earlier lens icon. Add a route #/brand that shows three
  options at 16, 32 and 64px on both themes, and use A in the header until
  one is chosen:
  A) a scope ring drawn by one continuous fiber strand ending in a small
     dot, echoing the line-and-dot style of the attached Fibrous mark;
  B) three parallel fiber strands bending into a reticle;
  C) a wordmark whose "o" in "scope" is a reticle.
  Each must work as a favicon and in a single colour.

Navbar
- One slim top bar (56–64px); a hairline border appears once the page
  scrolls.
- Left: logo + "Fiberscope", then Overview, Ranking, Settlements,
  Methodology; the active item uses the accent.
- Right: network switcher (chain logo + name; Base active; Ethereum, Gnosis,
  Arbitrum, Polygon, Avalanche, BNB, Linea, Plasma and Ink disabled with a
  "Soon" tag), language switcher, theme toggle.
- The period selector (24h / 7d / 30d / All) and the "Updated 2 min ago"
  status (tooltip with the data timestamp and refresh interval) sit in the
  page header row beside the title, not in the navbar.
- Mobile: only the top bar is sticky (at most 56px); a menu sheet holds the
  nav, network, language and theme; the network chip always shows the chain
  name.

Footer
- Four columns on desktop, stacked on mobile:
  1) logo, "Open-source analytics for CoW Protocol solvers." and
     "Independent project, not affiliated with CoW DAO."
  2) Product: Overview, Ranking, Settlements, Methodology.
  3) Data: data timestamp, sources (GPv2Settlement events, CoW Orderbook
     API), GitHub (MIT licence).
  4) Ecosystem: CoW Protocol, CoW Explorer, CoW Swap, the original Dune
     dashboard.
- Bottom row: "© 2026 Fiberscope · MIT" on the left; "Built by Fibrous" with
  the Fibrous mark on the right.

Charts
- Bars: rounded top corners and 2px gaps between stacked segments; hovering
  a column highlights it and dims the rest.
- Lines: smooth monotone curves, 2px strokes, no gradient fills.
- Horizontal gridlines only, very subtle; small muted axis labels; no chart
  borders.
- Tooltip: the time range, rows sorted by value with colour dots, and a
  total row.
- Legends are chips that show values; clicking one isolates that series.
- 300ms transitions when the period changes; respect prefers-reduced-motion.
- Charts show the top 8 solvers of the selected period and group the rest as
  "Other" in neutral gray. A solver's colour belongs to the solver, not to
  its rank.
- Solver palette: calm, readable on both themes, colour-blind
  safe (check deuteranopia and protanopia), no hue close to the teal accent,
  distinct from the status colours. Assign colours by all-time rank so the
  largest solvers get the most distinct hues.
- Every chart has role="img" and a one-sentence aria-label summary.
- Buckets: clock hours for 24h (10:00–11:00 UTC), UTC days for 7d and 30d,
  ISO weeks for All.

Internationalization
- Default English; 11 locales: en, tr, de, es, fr, ja, pl, ru, uk, vi, zh.
- Layouts handle long strings (de, ru) and CJK. Solver names, addresses and
  token symbols are never translated; numbers and dates use locale
  formatting.
- Turkish terms: trade = "takas" (Takaslar, Takas başına ort. gas,
  Gas/takas); transaction = "işlem" (İşlem maliyeti); percentage points =
  "yüzde puan" (short "yp"), never "puan" alone; the environments "Prod" and
  "Barn" stay untranslated; relative time "3 dk önce" without a full stop.

States
- Loading skeletons per section; one page-level error banner with a single
  Retry while cards quietly show "—"; an empty state; a stale-data warning
  when no update has arrived for a while.
- No horizontal page scroll at 390px: tooltips and popovers stay inside the
  viewport. Wide tables become card lists on mobile, or show Solver, Batches
  and Share with a visible scroll affordance.

Pages
1. Overview, in sections:
   a) Page header: title, context line (Base · Last 24 hours · Oct 1, 10:35
      – Oct 2, 10:35 UTC), period selector, updated status.
   b) Leader: leading solver, its batch share, the multiple over the next
      solver, the change vs the previous period, and a share strip of the
      top 8 + Other.
   c) KPI grid (2 rows of 4): Batches, Trades, Volume, Active solvers, Avg
      batch value, Trades per batch, Avg gas per trade, Tx cost (total and
      per trade). Each shows the change vs the previous period and a teal
      sparkline.
   d) Activity: "Batch share over time" (100% stacked) at full width;
      "Batches by solver" and "Volume by solver" (stacked bars) side by side.
   e) Competition: a "Participation vs win rate" bubble chart (x =
      participation %, y = win rate %, bubble size = batches, labels for the
      top 8), next to auction stats: auctions, average solutions per
      auction, share of auctions with several winners, filtered-out
      solutions.
   f) Efficiency: "Gas per trade by solver" and "DEX swaps per trade by
      solver" as sorted horizontal bars with a Base-wide average line.
   g) Top 10 table: Rank, Solver, Batches, Share, Trades, Volume, Avg batch
      value, Gas/trade, DEX swaps/trade, Participation, Win rate, Last
      settlement; a "Full ranking" link.
   h) Latest settlements: the 8 rows below (time, solver, trades, token pair,
      volume, gas, tx cost, links to CoW Explorer and Basescan).
2. Ranking: the full sortable table with every column above plus Tx cost and
   Flash-loan settlements, search and a period filter.
3. Solver detail (example: Helixbox): name, prod/barn addresses, KPI cards,
   time series (batches, volume, win rate, gas/trade), competition panel
   (participation, win rate, average best rank, solutions per auction,
   filtered-out), recent settlements.
4. Settlements: paginated table — time, solver, trades, token pair, volume,
   gas used, tx cost (L2+L1), links to CoW Explorer and Basescan; filter by
   solver.
5. Methodology: the definitions below; every metric label elsewhere links to
   its definition.

Metric definitions
- Batch: one settlement transaction with at least one trade (zero-trade
  buffer/withdrawal settlements are excluded).
- Trade: one filled order (Trade event) inside a settlement.
- Volume (USD): per trade, the lower of the sell-side and buy-side value,
  priced with the auction's native prices × ETH/USD (guards against
  mispriced tokens).
- Avg batch value: volume / batches. Trades per batch: trades / batches.
- Gas per trade: settlement gas used / trades in it.
- Tx cost: L2 execution fee + L1 data fee, in USD.
- DEX swaps per trade: settlement interactions excluding token approvals and
  WETH unwraps, / trades.
- Participation: share of auctions in which the solver submitted at least
  one solution.
- Win rate: auctions won / auctions entered (an auction can have several
  winners).
- Solutions per auction, average best rank and filtered-out solutions come
  from the same auction data.
- Solver names: on-chain allow-list + open name registry; unknown addresses
  are shown shortened.
- Solver attribution: settlements executed through CoW's flash-loan router
  (0x9da8…2c69) are credited to the solver that won the auction, not to
  the router.
- Flash-loan settlements: settlements that went through the flash-loan
  router.
- Sources: GPv2Settlement events on Base (0x9008…ab41) + CoW Orderbook API.
All auction metrics are regular per-period metrics; "—" means there is no
auction data for that solver.

Sample data: real, Base, 24h ending 2026-10-02 10:35 UTC. Generate plausible
7d, 30d and All series around these daily values (±20%).
Totals: 3,652 batches · 3,849 trades · $4.87M volume · 19 solvers · avg batch
value $1,334 · 1.05 trades per batch · 644K gas per trade · 1.83 DEX swaps per
trade · $68.99 tx cost ($0.018 per trade) · 195 flash-loan settlements.
Auction metrics were measured on 183 auctions in the last 82 minutes of the
window: 9.3 solutions per auction, 9.8% with several winners, 20 solutions
filtered out. Use these rates for the 24h view and scale the counts to each
period (about 3,300 auctions in 24h).
Solver | Batches | Trades | Volume $ | Gas/trade | DEX swaps/trade | Tx cost $ | Flash-loan settl. | Particip. | Win rate | Sol./auction | Avg best rank | Filtered
0x588e…5e30 (unnamed) | 1,711 | 1,808 | 444,238 | 468K | 2.26 | 13.30 | 59 | 87% | 58% | 1.00 | 2.6 | 3
Helixbox | 474 | 525 | 285,674 | 884K | 1.28 | 19.01 | 72 | 61% | 10% | 1.00 | 6.3 | 3
Rizzolver | 317 | 317 | 1,572,725 | 302K | 1.25 | 15.80 | 16 | 26% | 33% | 1.00 | 4.0 | 0
Fibrous | 232 | 232 | 165,217 | 774K | 1.16 | 2.82 | 0 | 54% | 22% | 1.06 | 4.0 | 0
0x5c35…fce1 (unnamed) | 210 | 229 | 953,776 | 999K | 1.97 | 3.99 | 1 | 63% | 11% | 1.13 | 4.0 | 2
Arc | 169 | 169 | 52,998 | 1.37M | 1.20 | 3.63 | 1 | 46% | 14% | 1.00 | 6.0 | 0
Wraxyn | 131 | 131 | 374,989 | 766K | 1.20 | 1.56 | 0 | 45% | 6% | 1.00 | 8.5 | 0
BRRRolver | 126 | 132 | 322,659 | 805K | 2.62 | 2.14 | 17 | 57% | 4% | 1.08 | 3.9 | 4
Kipseli | 120 | 129 | 476,706 | 873K | 1.50 | 4.71 | 14 | 45% | 13% | 1.06 | 4.9 | 1
Kaisersolver | 65 | 65 | 2,357 | 383K | 1.34 | 0.39 | 13 | 54% | 1% | 2.79 | 7.2 | 5
Horadrim | 31 | 41 | 24,564 | 503K | 2.05 | 0.33 | 0 | 37% | 1% | 1.00 | 10.8 | 0
Baseline | 21 | 26 | 53 | 196K | 1.46 | 0.08 | 1 | 15% | 7% | 1.00 | 9.3 | 0
Rosato | 14 | 14 | 3,559 | 1.52M | 1.00 | 0.35 | 0 | 28% | 17% | 1.00 | 4.9 | 0
BitgetWallet | 12 | 12 | 52,994 | 2.15M | 1.92 | 0.42 | 1 | 57% | 0% | 1.00 | 9.7 | 0
Dsolver | 10 | 10 | 1,475 | 477K | 1.30 | 0.07 | 0 | 53% | 1% | 1.03 | 8.2 | 0
Tsolver | 4 | 4 | 137,586 | 2.04M | 1.75 | 0.34 | 0 | 38% | 0% | 1.47 | 8.3 | 2
Elfomo | 2 | 2 | 1,520 | 842K | 10.50 | 0.03 | 0 | — | — | — | — | —
Gnosis_BalancerSOR | 2 | 2 | 13 | 449K | 1.50 | 0.01 | 0 | 3% | 0% | 1.00 | 11.8 | 0
OKX | 1 | 1 | 56 | 885K | 1.00 | 0.01 | 0 | 31% | 0% | 1.00 | 8.8 | 0

Addresses (prod / barn)
0x588e…5e30: 0x588ef3de14875ff9c4fc74c9e2c308767d665e30
Helixbox: 0xffd98b05962fca73cdfd22ed73198dfb2e5241eb / 0x2ee19d575d58ddfde8086078323e50f34f0d7a70
Rizzolver: 0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7 / 0x707dfa95835542a6528fd077c351446f497276cf
Fibrous: 0xa95157266e0f53d2762fd8a885d4cdb2409eb29e / 0x3ace981a4bef82fd123257bf9b3fc304191a6fd8
0x5c35…fce1: 0x5c3593481cba011737e36ded62f1797c9f6afce1
Arc: 0x4566961fa9a5f38a7ef18ca2bd6459869305f010 / 0xfff69057784015fb6bd36767ae632c435e0346d1
Wraxyn: 0xa2e28dedaab59d732ae375832fb855510aa7fe57 / 0x0c4aef2fc24529b08dad1bcabf4537cb1e0b5157
BRRRolver: 0xb222da0155640eb2f604164d4a3684139dcc1f95 / 0xb222da076c21b7784a975dd54fd09c0f7c21262f
Kipseli: 0xbee162fa5ae892be74f3f3e01c23da89adbccccc / 0x9775be2bb0b72d4ea98bfd38024ef733dc048a30
Kaisersolver: 0x4c7bdd2d75050c4fdb84ad47dd328dc5c07d7743 / 0x68ebc0d91c951ec9471b7ece57558315fced84f6
Horadrim: 0xea270e6cad15c5bafa35b9019bec7087ff82d8e8
Baseline: 0x69d7f96dfd091652f317d0734a5f2b492accbe07 / 0x8d98057b8c3d6c7cb02f1c1be7e37d416f2d3e96
Rosato: 0x70f5474ea078a63f874695ea2ed99aebc4ad4393 / 0x728a498a1ff4c7d64f48b5b7fefd72fdde010613
BitgetWallet: 0x48573687867c72957926c4eb1a6e95e7ce6cf2fb / 0xa1789d24ede2d75b737cc180df762e31dfaf64ed
Dsolver: 0x0195214d609edc3032366eb5c977d26d46d0a661 / 0x7627043a5ccd976bad8d6ab8a7003c7bd5703b86
Tsolver: 0x3980daa7eaad0b7e0c53cfc5c2760037270da54d / 0xac73db8296f6be1836288da8a57c0f29379741e2
Elfomo: 0x2c975c34d54ad06607f8ea14519c36f91275349d / 0x07cad32e40a92a86e7f2e7b373baaf4704d92c5b
Gnosis_BalancerSOR: 0x983ac485620e265730e367b2c7bcbf6eb9d62a21 / 0x9451d27c993f7a61096bfc33e0241644a7566f66
OKX: 0xd875cd50b179a046512c80edf6cb2c1fc3f3072d / 0x4ead087d78c21fd95d30411928a2ade7456f56f4

Latest settlements (UTC | solver | trades | pair | volume | gas | tx cost | tx hash)
10:35:49 | 0x588e…5e30 | 1 | MEZO→USDC | $56 | 436K | $0.0070 | 0x301ddf0dd9351e99e6eb9f9cc5b2402968d704892769777127e39339113167ef
10:35:37 | 0x588e…5e30 | 1 | USDT→USDC | $10 | 373K | $0.0063 | 0xe11035d932f5dcbd3907c1ae0d8d04332899668ea8919f2d5e490f2b466f57d9
10:34:25 | 0x588e…5e30 | 1 | DAI→USDC | $5 | 369K | $0.0057 | 0xf01106ec08288b7ba7b4434225c73d6d90977374dacd6c723db8e5471091911a
10:33:43 | 0x588e…5e30 | 2 | USDS→USDC +1 | $95 | 849K | $0.0135 | 0x40aee93d073a5881132e1c63f574295a78168b09c12571f28a1abce927e340b2
10:32:25 | 0x588e…5e30 | 1 | BASE→ETH | $9 | 204K | $0.0033 | 0xf73520cb6c7a5b2ee241ac4821df26d7a612171f73d6b10c47c073cc08067275
10:32:03 | Rizzolver (flash loan) | 1 | USDC→WETH | $820 | 1,016K | $0.1693 | 0x2e3c357c7b0c1eb51595fa1a5bc02f84d2ee7dc653c13bf1281d2cf00898f5a8
10:31:49 | 0x588e…5e30 | 1 | OFC→USDC | $1 | 370K | $0.0058 | 0x3077cab76920d7bf8ef7eed421ae067f9deb3e47341eee382b05a24672be62f1
10:31:31 | 0x5c35…fce1 | 1 | USDT→USDbC | $100 | 313K | $0.0055 | 0x9a3133cd89f58e02079af4db7c8dc52d84be0fd233d9bbffd6c670f285a274b4
```
