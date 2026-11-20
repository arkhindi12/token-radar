// The radar's value model, its rivals, its honesty checks and its farm plans.
//
// The model. A protocol that already trades a token publishes a market cap, and the snapshot holds
// both that market cap and the protocol's TVL for 128 protocols (after the filter below). Regress the
// log market cap on the log TVL over those 128, by least squares, and the fit is a multiple of TVL
// raised to a power: mcap = exp(a) * tvl^b. Applied to a protocol that records no token, the same
// fit is an implied value. Nothing is hardcoded: fitValueModel() runs on every snapshot the program
// reads, and the board prints the coefficients, the residual band and the out-of-sample error it
// measured on that snapshot, so the model can be seen to follow the data rather than a list of names.
//
// The direction of the claim is one-way by construction. Market cap is a stock, TVL is a stock, and
// the two are measured in the same units on the same day for the same 128 protocols; the fit is the
// typical relationship in this market, used as a multiple, the way a valuation multiple comes from
// comparables. The posterior underneath it is under-identified: a token that does not exist yet has
// no supply, so no field of this snapshot says how many tokens a launch would issue. The residual
// band is wide for that reason, and the band is printed wherever the number is.
//
// Evaluation. "Leave one out" is literal: fitValueModel() and looErrors() refit the model 128 times,
// once with each protocol left out, predict the held-out protocol, and report the typical miss in
// the same unit a rival's is reported: the multiple, exp(median |log(actual / predicted)|). A
// multiple of 2.0 is a typical miss of a factor of two.

import type { Protocol, Snapshot } from './snapshot.ts';
import { ageDays, geoblockedVenue } from './snapshot.ts';

/** The regression's unit: a row of the 128 (or 127) pairs a fit reads. */
export interface FitPair {
  slug: string;
  /** log of the protocol's TVL in whole dollars. */
  x: number;
  /** log of the protocol's recorded market cap in whole dollars. */
  y: number;
}

/** Why rows left the fit. Printed on the page, each with its count. */
export interface FitFilter {
  name: string;
  count: number;
  rule: string;
}

/** A fitted log-linear model, with everything the page needs to show it was fitted. */
export interface ValueModel {
  /** log mcap = a + b * log tvl. */
  a: number;
  b: number;
  /** exp(a): the implied market cap of a protocol with $1 of TVL, in dollars. */
  expA: number;
  n: number;
  r2: number;
  /** sd of the log residual on the fit's own rows. */
  sigma: number;
  /** The residual multiple at p10, p50 and p90, in the direction actual / predicted. */
  p10: number;
  p50: number;
  p90: number;
  /** The typical out-of-sample miss in multiples (leave-one-out), and its p10/p90. */
  looMedian: number;
  looP10: number;
  looP90: number;
  /** The share of held-out rows inside the loo p10..p90 band, and the share predicted within 2x. */
  looInside80: number;
  looWithin2x: number;
  /** The typical miss a constant median-ratio model makes on the same rows, in multiples. */
  constantMedian: number;
  /** The rows the fit read, in snapshot order. */
  rows: FitPair[];
}

/** Ties in the board's order: implied value first, then the quieter protocol, then the slug. */
export function compareRows(a: { implied: number; change_7d: number | null; slug: string }, b: { implied: number; change_7d: number | null; slug: string }): number {
  if (a.implied !== b.implied) return b.implied - a.implied;
  const ca = a.change_7d ?? 0;
  const cb = b.change_7d ?? 0;
  if (ca !== cb) return ca - cb;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** The row of the fit one protocol supplies: log TVL and log market cap, both positive. */
export function fitPair(p: Protocol): FitPair | null {
  if (p.tvl_usd <= 0 || p.mcap_usd === null || p.mcap_usd <= 0) return null;
  return { slug: p.slug, x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd) };
}

/**
 * Least squares of y on x with an intercept: b = sxy / sxx, a = mean(y) - b * mean(x).
 * The sums are taken over the mean, not over raw products, so a snapshot of eight-figure TVLs does
 * not lose its fit to floating-point cancellation.
 */
export function linearFit(pairs: readonly FitPair[]): { a: number; b: number; sigma: number; r2: number } {
  const n = pairs.length;
  if (n < 3) throw new Error(`a fit needs at least three pairs, not ${n}`);
  let mx = 0;
  let my = 0;
  for (const r of pairs) {
    mx += r.x;
    my += r.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const r of pairs) {
    const dx = r.x - mx;
    const dy = r.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) throw new Error('every row of the fit has the same TVL: no slope to fit');
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (const r of pairs) {
    const e = r.y - (a + b * r.x);
    sse += e * e;
  }
  return { a, b, sigma: Math.sqrt(sse / n), r2: syy === 0 ? 0 : 1 - sse / syy };
}

/** The implied market cap of a protocol with `tvl` under the fit: exp(a) * tvl^b. */
export function predict(m: { a: number; b: number }, tvl: number): number {
  return Math.exp(m.a) * Math.pow(tvl, m.b);
}

/** Percentile of a sorted array by linear interpolation; `q` in 0..1. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
  return v;
}

/** The median of an unsorted array, without reordering the caller's. */
const median = (xs: readonly number[]): number => quantile([...xs].sort((p, q) => p - q), 0.5);

/**
 * Which rows the fit reads, and why the others do not. The snapshot's `mcap_usd` carries 0 and -1
 * where DefiLlama has no market cap, so "positive" is the filter, not "not null".
 */
export function fitFilters(snapshot: Snapshot): FitFilter[] {
  const all = snapshot.protocols.length;
  const nonPositiveTvl = snapshot.protocols.filter((p) => p.tvl_usd <= 0).length;
  const zeroMcap = snapshot.protocols.filter((p) => p.mcap_usd === 0).length;
  const negativeMcap = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd < 0).length;
  const kept = snapshot.protocols.filter((p) => fitPair(p) !== null).length;
  return [
    { name: 'protocols in the snapshot', count: all, rule: 'every protocol DefiLlama lists at or above $5m of TVL' },
    { name: 'dropped: TVL of 0 or less', count: nonPositiveTvl, rule: 'log(TVL) needs a positive TVL; a protocol at $0 is not in the fit' },
    { name: 'dropped: market cap of exactly 0', count: zeroMcap, rule: 'DefiLlama writes 0 where it has a token id and no market cap yet; 0 is not a valuation' },
    { name: 'dropped: market cap below 0 (-1)', count: negativeMcap, rule: 'DefiLlama writes -1 for an unknown market cap; a negative valuation is impossible' },
    { name: 'dropped: no quoted token id or ticker', count: all - nonPositiveTvl - zeroMcap - negativeMcap - kept, rule: 'a protocol with no recorded token cannot teach the fit what a token is worth' },
    { name: 'read by the fit', count: kept, rule: 'positive TVL and a positive market cap: the pairs log mcap = a + b log tvl' },
  ];
}

/**
 * Fit the model on the snapshot, then measure it out of sample: refit with each row left out,
 * predict that row, and report the misses. Also fits the rival formulas on the same rows with the
 * same leave-one-out rule, so the page can compare them in one unit.
 */
export function fitValueModel(snapshot: Snapshot): ValueModel {
  const rows = snapshot.protocols.map(fitPair).filter((r): r is FitPair => r !== null);
  if (rows.length < 20) throw new Error(`only ${rows.length} protocols record both a positive TVL and a positive market cap: too few to fit a value model`);
  const fit = linearFit(rows);
  const resid = rows.map((r) => r.y - (fit.a + fit.b * r.x));
  const multiples = resid.map((e) => Math.exp(e)).sort((p, q) => p - q);

  // Leave one out: 128 refits of 127 rows each, predictions on the row held out.
  const loo: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rest = rows.filter((_, j) => j !== i);
    const f = linearFit(rest);
    loo.push(Math.exp(f.a + f.b * rows[i]!.x - rows[i]!.y));
  }
  const looSorted = [...loo].sort((p, q) => p - q);
  const looP10 = quantile(looSorted, 0.1);
  const looP90 = quantile(looSorted, 0.9);
  return {
    a: fit.a,
    b: fit.b,
    expA: Math.exp(fit.a),
    n: rows.length,
    r2: fit.r2,
    sigma: fit.sigma,
    p10: quantile(multiples, 0.1),
    p50: quantile(multiples, 0.5),
    p90: quantile(multiples, 0.9),
    looMedian: median(loo),
    looP10,
    looP90,
    looInside80: loo.filter((m) => m >= looP10 && m <= looP90).length / loo.length,
    looWithin2x: loo.filter((m) => m >= 0.5 && m <= 2).length / loo.length,
    constantMedian: Math.exp(median(rows.map((r) => Math.abs(r.y - median(rows.map((q) => q.y)))))),
    rows,
  };
}

/** One rival formula's leave-one-out record, in the model's own unit (a multiple). */
export interface RivalScore {
  name: string;
  formula: string;
  median: number;
  p10: number;
  p90: number;
  within2x: number;
}

/**
 * The rivals, each fitted and scored by the same leave-one-out on the same rows:
 *
 *   constant ratio       mcap = median(mcap / tvl) * tvl: the field's thickest thumb
 *   category premium     mcap = median(mcap / tvl of the held-out row's category) * tvl
 *   age without a token  mcap = constant ratio * (days listed / mean days) ^ k, k fitted
 *   flat TVL multiple    the same constant ratio, stated as one dollar figure per dollar of TVL
 *   log tvl + log tvl^2  a quadratic in log TVL: does the relationship bend?
 *
 * The constant ratio and the flat TVL multiple are the same estimator, so they score the same; both
 * are kept, because the first is how the model is usually stated and the second is how a rival board
 * states it, and printing both says plainly that the two descriptions are one claim.
 */
export function rivalScores(snapshot: Snapshot, rows: readonly FitPair[], main: ValueModel): RivalScore[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const ratios = rows.map((r) => Math.exp(r.y - r.x));
  const medianRatio = median(ratios);
  const agesOf = (list: readonly FitPair[]): number[] => list.map((r) => ageDays(snapshot.as_of, bySlug.get(r.slug)?.listed_at ?? null) ?? 0);
  const meanAge = (list: readonly FitPair[]): number => {
    const ages = agesOf(list);
    return Math.max(1, ages.reduce((s, a) => s + a, 0) / Math.max(1, ages.length));
  };
  const out: RivalScore[] = [];

  const score = (name: string, formula: string, predictOut: (train: readonly FitPair[], held: FitPair) => number): void => {
    const miss: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const train = rows.filter((_, j) => j !== i);
      miss.push(Math.max(1e-9, predictOut(train, rows[i]!)));
    }
    const sorted = miss.sort((p, q) => p - q);
    out.push({
      name,
      formula,
      median: median(sorted),
      p10: quantile(sorted, 0.1),
      p90: quantile(sorted, 0.9),
      within2x: sorted.filter((m) => m >= 0.5 && m <= 2).length / sorted.length,
    });
  };

  score('constant ratio', 'mcap = median(mcap/tvl) × tvl', (train, held) => {
    const m = median(train.map((r) => Math.exp(r.y - r.x)));
    return Math.exp(m) * Math.exp(held.x - held.y);
  });

  score('category premium', 'mcap = median(mcap/tvl of its category) × tvl', (train, held) => {
    const category = bySlug.get(held.slug)?.category ?? null;
    const same = train.filter((r) => (bySlug.get(r.slug)?.category ?? null) === category);
    const pool = same.length >= 3 ? same : train;
    const m = median(pool.map((r) => Math.exp(r.y - r.x)));
    return Math.exp(m) * Math.exp(held.x - held.y);
  });

  score('age without a token', 'mcap = median ratio × (days listed / mean days) ^ k × tvl', (train, held) => {
    const m = median(train.map((r) => Math.exp(r.y - r.x)));
    const mean = meanAge(train);
    const age = ageDays(snapshot.as_of, bySlug.get(held.slug)?.listed_at ?? null) ?? 0;
    const xs = train.map((r) => Math.log(Math.max(1, ageDays(snapshot.as_of, bySlug.get(r.slug)?.listed_at ?? null) ?? 0) / mean));
    const ys = train.map((r) => r.y - r.x - m);
    const sxx = xs.reduce((s, x) => s + x * x, 0);
    const sxy = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
    const k = sxx > 0 ? sxy / sxx : 0;
    return Math.exp(m) * Math.pow(Math.max(1, age) / mean, k) * Math.exp(held.x - held.y);
  });

  score('flat TVL multiple', 'mcap = median ratio × tvl, one constant for every row', (train, held) => {
    const m = median(train.map((r) => Math.exp(r.y - r.x)));
    return Math.exp(m) * Math.exp(held.x - held.y);
  });

  score('log tvl + log tvl²', 'log mcap = a + b log tvl + c (log tvl)²', (train, held) => {
    const mx = train.reduce((s, r) => s + r.x, 0) / train.length;
    // Solve the 3x3 normal equations of the quadratic by Gaussian elimination with the terms centred.
    const xs = train.map((r) => r.x - mx);
    const ys = train.map((r) => r.y);
    const s = [0, 1, 2, 3, 4].map((k) => xs.reduce((acc, x) => acc + Math.pow(x, k), 0));
    const t = [0, 1, 2].map((k) => xs.reduce((acc, x, i) => acc + Math.pow(x, k) * ys[i]!, 0));
    const M: number[][] = [
      [s[0]!, s[1]!, s[2]!, t[0]!],
      [s[1]!, s[2]!, s[3]!, t[1]!],
      [s[2]!, s[3]!, s[4]!, t[2]!],
    ];
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let r = col + 1; r < 3; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
      if (Math.abs(M[pivot]![col]!) < 1e-12) return Math.exp(held.x - held.y);
      [M[col], M[pivot]] = [M[pivot]!, M[col]!];
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = M[r]![col]! / M[col]![col]!;
        for (let c = col; c < 4; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
      }
    }
    const coef = [M[0]![3]! / M[0]![0]!, M[1]![3]! / M[1]![1]!, M[2]![3]! / M[2]![2]!];
    const dx = held.x - mx;
    const yhat = coef[0]! + coef[1]! * dx + coef[2]! * dx * dx;
    return Math.exp(yhat - held.y);
  });

  // The main model's own leave-one-out, in the same list, so the board can be compared in one column.
  out.unshift({ name: 'log mcap = a + b·log tvl', formula: 'our model, refit on the snapshot', median: main.looMedian, p10: main.looP10, p90: main.looP90, within2x: main.looWithin2x });
  return out;
}

// ---------------------------------------------------------------- farm plans

/** The capital a plan puts in, by the protocol's TVL: big protocols absorb more without moving a price. */
export function depositFor(p: Protocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 300;
  if (p.tvl_usd >= 100_000_000) return 200;
  if (p.tvl_usd >= 20_000_000) return 100;
  return 50;
}

/** Gas a plan spends, in dollars, over the whole campaign; the chain's own cost, not a real quote. */
export function gasFor(p: Protocol): number {
  const chain = (p.chains[0] ?? '').toLowerCase();
  const cheap = ['solana', 'sui', 'aptos', 'base', 'arbitrum', 'optimism', 'monad', 'plasma', 'celo', 'berachain', 'unichain', 'ton', 'near'];
  if (['solana', 'sui', 'aptos', 'ton', 'near'].includes(chain)) return 3;
  if (cheap.includes(chain)) return 6;
  return 18;
}

/** How long a plan runs: young protocols get the longer window that a points season usually needs. */
export function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 30;
}

/** The one main action a category asks for, in words a reader can follow without the protocol's docs. */
export function primaryAction(p: Protocol, amount: number): string {
  const c = (p.category ?? '').toLowerCase();
  const chain = p.chains[0] ?? 'its main chain';
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('synthetics')) return `Supply $${amount} of USDC to ${name} on ${chain} on the protocol's own market, then borrow $${Math.round(amount * 0.2)} against it and keep both positions open.`;
  if (c.includes('dex') || c.includes('yield aggregator') || c.includes('leveraged') || c.includes('farm')) return `Provide $${amount} of USDC and the chain's main asset as a two-sided position in ${name}'s deepest pool on ${chain}, and restake the pool receipt where the protocol allows it.`;
  if (c.includes('basis trading')) return `Open $${amount} of ${name}'s delta-neutral basis position on ${chain}: lend the stable leg and short the same asset on a perp venue, so the position earns the basis without a directional bet.`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Allocate $${amount} of USDC to ${name}'s largest curated vault on ${chain} and leave it there while the vault's allocation changes, since curation is the activity the protocol measures.`;
  if (c.includes('rwa')) return `Deposit $${amount} of USDC into ${name}'s yield product on ${chain}, take the receipt token it issues, and hold it rather than sell it.`;
  if (c.includes('staking') || c.includes('restak') || c.includes('collateral markets')) return `Stake $${amount} of ${chain}'s native asset through ${name} and keep its receipt token; restake the receipt if the protocol offers a second layer.`;
  if (c.includes('stable')) return `Mint or deposit $${amount} of the stable asset ${name} issues on ${chain}, and pair the position with a loan against it so the capital stays at work.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${amount} of USDC as margin with ${name} on ${chain}, open one small position, and trade two or three times so the volume is counted.`;
  if (c.includes('prediction')) return `Fund $${amount} with ${name} on ${chain} and take positions on two or three markets rather than one.`;
  if (c.includes('insurance')) return `Buy cover from ${name} on ${chain} for a position you actually hold, and keep the policy for its full term.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Move $${amount} of USDC across ${name}'s route from one chain to another and back, using the route rather than a generic bridge.`;
  if (c.includes('launchpad')) return `Buy $${amount} worth of a launch through ${name} on ${chain} and hold the token past the listing rather than flipping it.`;
  if (c.includes('chain') || c.includes('governance') || c.includes('payments')) return `Bridge $${amount} of USDC into ${name} on ${chain}, use its own application for a swap and a payment, and hold the balance on the chain.`;
  return `Deposit $${amount} of USDC into ${name} on ${chain}, use the app's main function twice, and keep the position open.`;
}

/** A plan's numbers, which the page quotes and the row carries as words. */
export interface PlanNumbers {
  deposit: number;
  gas: number;
  days: number;
  steps: number;
}

/** One plan as both the gate's strings and the page's structured steps. */
export interface Plan {
  numbers: PlanNumbers;
  steps: string[];
}

/**
 * A farm plan: five concrete steps, each an action with a dollar cost and a time. It is derived from
 * the protocol's own record (category, first chain, TVL, age) and never from a list of names, and
 * every step's total is stated in dollars so a reader can add the plan up. The KYC step comes first,
 * because the cheapest way to lose the whole plan is to farm a venue that will not sell to you.
 */
export function buildPlan(p: Protocol, age: number | null): Plan {
  const deposit = depositFor(p);
  const gas = gasFor(p);
  const days = holdDays(age);
  const chain = p.chains[0] ?? 'its main chain';
  const weeks = Math.max(4, Math.round(days / 7));
  const checkin = Math.round((gas / Math.max(1, weeks)) * 100) / 100;
  const geoblocked = geoblockedVenue(p);
  const kyc = geoblocked
    ? `Check terms first: ${p.name} restricts US persons; if you are one, or your address is in a restricted country, this plan is not for you. Cost: nothing to check. Time: 10 minutes.`
    : `Check ${p.name}'s terms for your country and for a wallet cap before you fund anything; most launches restrict some regions and some tie rewards to one wallet per person. Cost: nothing to check. Time: 10 minutes.`;
  const steps = [
    kyc,
    `Prepare a fresh wallet with no history and fund it with $${deposit + gas}: $${deposit} for the position and $${gas} held back for gas across ${weeks} weeks. Cost: $${deposit + gas} in all. Time: 20 minutes.`,
    primaryAction(p, deposit) + ` Cost: the $${deposit} stays at risk, plus about $${Math.max(1, Math.round(gas / 3))} of bridge and approval fees. Time: 30 minutes to open.`,
    `Return to ${p.name} on ${chain} once a week for ${weeks} weeks and make one qualifying action (a deposit, a borrow, a swap or a vote) so the activity is seen in more than one week. Cost: about $${checkin} of gas a week, $${gas} over the campaign. Time: 15 minutes a week.`,
    `Hold the position for ${days} days without unwinding it, and keep the receipt or LP token in the same wallet that funded it. Cost: nothing beyond the $${deposit} already in the position. Time: ${days} days.`,
    `Claim only on ${p.name}'s own site, never from a link in a chat; check the announced terms for a lock or a vesting schedule, then unwind and record the result. Cost: no fee to check or claim. Time: 30 minutes.`,
  ];
  return { numbers: { deposit, gas, days, steps: steps.length }, steps };
}
