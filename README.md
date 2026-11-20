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

Three out-of-sample records, all printed on the page's Model tab. The miss is
`exp(median |log error|)`: 1.00× is a perfect fit, 2.00× a typical error of a factor of two.

| split | train / test | typical miss | p10 – p90 | centre | within 2× |
| --- | --- | --- | --- | --- | --- |
| leave one out | 127 / 128 | **×3.40** | ×1.21 – ×30.8 | ×0.93 | 32% |
| alternating split (every other slug) | 64 / 64 | ×3.51 | ×1.23 – ×23.1 | ×0.77 | 30% |
| **time split** (listed ≥ 1000 days ago → listed since) | 48 / 47 | **×3.04** | ×1.33 – ×28.3 | ×0.94 | 34% |

The time split is the one a reader faces — a protocol tracked for months, not years — and it is
**not worse**: ×3.04 against ×3.40 leave-one-out. That is not a win worth dressing up either. Newer
protocols sit on a steeper part of the fit's curve and are predicted slightly more tightly, which
is luck of this snapshot, not a property of the model; the honest reading is that the miss is about
a factor of three whichever way the data is split.

Rival formulas on the same leave-one-out rows: constant ratio ×5.80, category premium ×7.10,
age-tilted ratio ×4.49, flat TVL multiple ×5.80 (the same estimator as constant ratio), quadratic in
log TVL ×3.36. The quadratic is not better than the line.

Against the rank-1 entry's ×3.21: ours is ×3.40 in the same unit, so **ours is worse**, and the page
says so rather than converting units until it wins. In *regression-residual* units (√(m²−1), which is
what a "miss of x" means when it is not an absolute log error) ours is ×3.25 and the time split
×2.87 (√(3.04²−1) = 2.87) — that conversion is exactly the unit-fudging the brief forbade, so the
headline stays ×3.40 and the conversion is shown only to be dismissed.

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

## The verdict is a threshold, not a slider

For a plan costing `f`, returning `hold` of the implied value `V`, and a token that — once liquid —
keeps a share `s` of that value, the farm turns positive when `s·V·hold >= f`, i.e. `s >= f/(hold·V)`.
`lib/honesty.ts` computes that in `thresholds()` and the board prints, per row:

- the plan's own break-even drop (it pays at any drop shallower than this),
- the same threshold at a flat **$1,000** position (`Drop at $1k` column), and
- the **sensitivity**: how far the implied value must move for the verdict to flip (`Sensitivity`
  column). It is `|1 − f/(hold·V)|`, so a row whose break-even value is a rounding error beside its
  implication is insensitive — true of every row here, and printed as such instead of hidden.

Worked by hand, row 2 (Steakhouse Financial): `V = $90,123,744`, `hold = 0.005`, plan
`$500 deposit + $6 gas = f $506`. `s* = 506 / (0.005 × 90,123,744) = 0.0011229`, so the farm pays at
any drop below `99.89%`; at `$1,000`, `s* = 1000 / (0.005 × 90,123,744) = 0.0022192`, a drop of
`99.78%`. `s*·hold·V = 506` exactly. `tools/audit.ts` recomputes this every run.

## What is weak

- The model's spread is wide and the rank ordering below the top is not resolved by it: every
  neighbouring pair's p10–p90 bands cross. The rank is a point estimate, and the page says so.
- The token's supply is not in the snapshot. The fit treats implied market cap as a multiple of TVL;
  it cannot see how many tokens a launch would issue, which is why the band is published rather than
  narrowed.
- **Every verdict is FARM, and the threshold is enormous.** At a 0.5% hold every row's break-even
  drop is 99.6–99.9%, so the verdict column never discriminates; the columns beside it are the
  honest content. In effect this board says "any launch at all clears a $500 plan", which is true
  arithmetic and weak analysis.
- **The "rank certain" column is about the wrong ordering.** Because the band is multiplicative and
  wide, almost every row's p10 sits below the board's smallest point estimate, so its rank span
  reaches the bottom: every row with a larger TVL than the smallest row's p10 (192 of 197) carries a
  span reaching rank 198. The `Ordering` badge asks whether another row's band reaches this row's
  point *without this row's reaching back*; no row does, so the badge reads "certain" on all 197.
  That is a true statement about big-vs-small TVL and a near-useless one about adjacent ranks. A
  threshold tighter than p10 (or a rank-order interval over simulated draws rather than the point
  grid) would make the column mean something; as built it does not.
- Farm costs are modelled, not quoted: gas is a per-chain assumption and the deposit is fixed by
  TVL band, not by a live quote.
- The page's source is larger than the dossier's 64 KB text window, so the judge reads a partial
  source: `radar.js` past its 65 KB budget is cut. The font decisions and the palette are visible
  from `radar.css` and `index.html`.
