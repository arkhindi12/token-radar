# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arkhindi12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arkhindi12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token. It reads the sealed DefiLlama
snapshot of 14 November 2026 (758 protocols, 40 on the watchlist, $50M TVL floor),
fits a value model on the snapshot's own live-token protocols, ranks every genuine
pre-token candidate by implied launch value, and hands each one a farm plan with
its cost and its time.

## The board

- 198 pre-token rows, strongest implied value first: the 40 watchlist protocols
  plus 158 early finds the watchlist leaves out. The watchlist is the floor,
  never the ceiling.
- Top of the board: 1 Steakhouse Financial $1,290,376,808; 2 Sentora
  $1,162,243,412; 3 Gauntlet $774,453,923.
- 30 live-token protocols are set apart in their own view with their market caps
  shown: they already trade, so their value is a fact, not a model.
- A protocol is rankable when it records no token (no market cap, no CoinGecko
  id, no symbol) and is not a wrapped, staked or bridged product, not a versioned
  pool of another protocol, and not an exchange.

## The model (radar-5)

    implied = round( tvl_usd x comparable(category)
                     x (1 + clamp(change_7d, -60, 150) / 100 x 0.6)
                     x (0.6 + min(age_days, 1095) / 1095 x 0.4)
                     x (1 + 0.04 x min(chains - 1, 5)) )

`comparable(category)` is what the market already pays per dollar of TVL for live
tokens in the same category: the median mcap / TVL over the snapshot's live-token
protocols (CEX excluded), each ratio winsorised at 3.0, the category median shrunk
toward the global median with k = 8, then clamped to 0.05 - 1.0. A category with no
live protocol takes the global median. No protocol name is ever special-cased, and
the same function scores every row. The multiple is rounded to four decimals before
scoring, so the dashboard's in-page recompute lands on the exact number board.json
carries. Farm plans are personalised per row: step 1 varies by chain, and steps 6 and 7
name the protocol and its chain and TVL.

## Farm plans

Every row gets a seven-step plan derived from its own record — category, chains,
TVL and age — never from a hand-written list of names. Each step states what it
costs and how long it takes. Gas is priced by chain (Ethereum about $8 for the
first transaction, Solana under $1, L2s about $2, other chains about $3). Capital
is $50-$250 by TVL tier; the hold is 30-60 days by age. Step 1 is chain-specific,
step 6 names the protocol and its chain, step 7 names the protocol and its TVL.

## The dashboard

Dark emerald, one page, no network: every byte it shows is in data.js. Search,
category / chain / minimum-TVL filters, a watchlist-only toggle, sortable columns,
pre-token / live-token tabs, category bars, a model panel stating the formula, and
a detail view per protocol that recomputes its row (and says whether it matches
board.json), explains "Why rank N" from the model's own inputs, and shows the full
seven-step farm plan.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
node gate-check.mjs   # the fifteen gate rows, locally
```

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into `$MAKEFUN_OUTPUT_DIR`. It exits non-zero, and writes nothing,
if the board it would write breaks a gate rule. Screenshots are rendered with
Playwright (`shots.mjs`).

## What is weak, honestly

- Implied values are model estimates from TVL, growth, age and chain count — not
  prices, not promises, and not financial advice. The snapshot is sealed at
  14 November 2026; nothing here refreshes it.
- A protocol that records no token may still have one its record does not carry.
- The comparable is a median over live tokens in the same category; thin
  categories mostly take the global median, so their rows differ mainly by TVL,
  growth, age and chains.
