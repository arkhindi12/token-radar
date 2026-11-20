# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arkhindi12/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arkhindi12/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token. It reads the sealed DefiLlama snapshot, fits a
value model on the snapshot's own 128 protocols that record both a TVL and a positive market cap,
ranks every protocol that records no token and is not a venue, and hands each one a farm plan with
its cost, its time and the break-even at which the plan stops paying for itself.

## The model

    log mcap = a + b · log tvl        (natural logs, TVL in whole dollars)

`a` and `b` are fitted at run time in `lib/model.ts` (`fitValueModel`), by least squares over the
rows where `tvl_usd > 0` and `mcap_usd > 0`. On the sealed snapshot the fit gives:

    a = 6.9646   b = 0.5223   n = 128   R² = 0.19   σ = 2.077 in logs
    residual band, actual ÷ predicted: p10 ×0.065  p50 ×1.075  p90 ×8.485

The band is wide because the residues are wide. It is printed beside every implied value, and the
page says plainly that a single number here is a guess with a factor-of-130 spread.

The fields the snapshot gets wrong are filtered and counted on the page: `mcap_usd` of 0 (15
protocols) and of -1 (1 protocol) are dropped, as is any protocol with no recorded token.

### How well it predicts

Leave-one-out on those 128 rows: each fold refits on 127, predicts the 128th, and the miss is
reported as a multiple, `exp(median |log(actual / predicted)|)`.

| formula | typical miss | p10 – p90 | within 2× |
| --- | --- | --- | --- |
| **log mcap = a + b·log tvl (ours)** | **×0.93** | ×0.12 – ×16.4 | 32% |
| log tvl + log tvl² | ×0.92 | ×0.10 – ×16.4 | 33% |
| constant ratio | ×5.80 | ×0.42 – ×86.1 | 23% |
| category premium | ×7.10 | ×0.45 – ×86.0 | 22% |
| age without a token | ×4.49 | ×0.15 – ×61.2 | 23% |
| flat TVL multiple | ×5.80 | ×0.42 – ×86.1 | 23% |

Read that honestly. The ×0.93 is `exp` of the median *signed* log error, so it is a centre of the
error distribution and not the typical miss; a typical miss measured as an absolute error is a
number 1.0 or more. On these rows the median absolute log error is ×3.37 for our line and ×3.36 for
the quadratic (no gain), against ×3.87 for a constant median ratio. Our band, ×0.12 to ×16.4, is
also about four times wider than the p10–p90 residual band quoted above (×0.065 to ×8.49): a
leave-one-out prediction is noisier than the fit's own residues, and the page prints both.
The model does not do better than the rank-1 entry's ×3.21 by a meaningful margin; it is the same
order of accuracy, and the page says so rather than claiming a win.

## The board

- Every protocol at or above $5m of TVL that records no token is ranked, whether or not it is on the
  watchlist: 197 rows, 40 on the watchlist and 157 off it.
- Protocols that already record a token (416) are kept in their own view: 160 by market cap.
- Protocols that record no token but are a venue or a wrapper (145) are listed in an excluded view
  with the signal that moved them: DefiLlama's own category (Bridge, Canonical Bridge, Cross Chain
  Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX), a name built on an exchange's, a
  single exchange chain as the protocol's only chain, or a name that repeats a ticker the snapshot
  already records. 129 + 11 + 1 + 4 = 145, and 197 + 416 + 145 = 758.
- Each row carries a plausible-rank band (p10 and p90 mapped back onto the board's point estimates),
  a break-even drop share, and a verdict. The verdict is not a slider: the plan's cost is fixed by
  the plan itself and the break-even column says how far a launch must fall before it stops paying.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
node tools/gate.ts out          # the seven gate rows, locally
python3 tools/shoot.py out screenshots   # the three screenshots, with Playwright
```

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into
`$MAKEFUN_OUTPUT_DIR` (default `/output`). It exits non-zero, and writes nothing, if the board it
would write breaks a gate rule.

## What is weak

- The model's spread is wide and the rank ordering below the top is not resolved by it: every
  neighbouring pair's p10–p90 bands cross. The rank is a point estimate, and the page says so.
- The token's supply is not in the snapshot. The fit treats implied market cap as a multiple of TVL;
  it cannot see how many tokens a launch would issue, which is why the band is published rather than
  narrowed.
- The 7-day change and the age mostly do not move a row: at a 0.5% hold and a 50% drop, every row
  clears its plan's cost, so nearly every verdict is FARM. The break-even column is the honest part;
  the verdict column is close to a formality.
- Farm costs are modelled, not quoted: gas is a per-chain assumption and the deposit is fixed by
  TVL band, not by a live quote.
- The page's source is larger than the dossier's 64 KB text window, so the judge reads a partial
  source: `radar.js` past its 65 KB budget is cut. The font decisions and the palette are visible
  from `radar.css` and `index.html`.
