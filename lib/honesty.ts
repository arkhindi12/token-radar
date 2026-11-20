// Two honesty tests on the value model, kept apart from the fit itself so both are visible in one
// place and neither can drift from the other:
//
//   oosSplit()     an out-of-sample miss three ways: leave-one-out over all 128 priced protocols, a
//                  random 50/50 split (one fold), and a time split that trains on the half listed
//                  longer ago and tests on the half listed more recently. The time split is the one a
//                  reader faces: a protocol tracked for months, not years, and market conditions that
//                  moved since the older rows were priced.
//   thresholds()   the farm verdict as a stated threshold instead of a slider: the minimum drop share
//                  at which a $1000 position turns positive, the deposit-sized threshold, and the
//                  sensitivity: how far the implied value has to move for the verdict to flip.

import type { FitPair } from './model.ts';
import { linearFit, quantile } from './model.ts';

/** One out-of-sample record: how many rows trained it and how many it predicted, and the misses. */
export interface OosRecord {
  name: string;
  /** What the split is, in the words the page prints. */
  how: string;
  train: number;
  test: number;
  /** The typical miss as exp(median |log error|): 1.0 is a perfect fit, 2.0 a factor of two. */
  median_abs: number;
  p10: number;
  p90: number;
  within2x: number;
  /** The median signed error, exp(median log(actual/predicted)): below 1 the model over-predicts. */
  centre: number;
}

/** The mean absolute deviation in logs, in the same unit: exp(MAD). */
function record(name: string, how: string, train: readonly FitPair[], test: readonly FitPair[]): OosRecord {
  const f = linearFit(train);
  const errs = test.map((r) => f.a + f.b * r.x - r.y);
  const abs = errs.map((e) => Math.exp(Math.abs(e))).sort((p, q) => p - q);
  return {
    name,
    how,
    train: train.length,
    test: test.length,
    median_abs: quantile(abs, 0.5),
    p10: quantile(abs, 0.1),
    p90: quantile(abs, 0.9),
    within2x: abs.filter((m) => m <= 2).length / abs.length,
    centre: Math.exp(quantile([...errs].sort((p, q) => p - q), 0.5)),
  };
}

/** The day a row's protocol was listed, from the snapshot's own field; null rows sort last. */
export interface DatedPair extends FitPair {
  days_listed: number | null;
}

/**
 * The three out-of-sample records. The random split is deterministic: rows are ordered by their
 * position in the snapshot (slug order) and every other one trains, the rest test, so a second run
 * gives the same numbers and the page can print a split the reader could rebuild.
 */
export function oosSplit(rows: readonly DatedPair[]): { loo: OosRecord; random: OosRecord; time: OosRecord; cut: number } {
  // Leave-one-out, pooled: every row predicted by a fit that never saw it.
  const looAbs: number[] = [];
  const looErr: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const f = linearFit(rows.filter((_, j) => j !== i));
    const e = f.a + f.b * rows[i]!.x - rows[i]!.y;
    looErr.push(e);
    looAbs.push(Math.exp(Math.abs(e)));
  }
  const looSorted = looAbs.sort((p, q) => p - q);
  const loo: OosRecord = {
    name: 'leave one out',
    how: `each of the ${rows.length} rows predicted by a fit on the other ${rows.length - 1}`,
    train: rows.length - 1,
    test: rows.length,
    median_abs: quantile(looSorted, 0.5),
    p10: quantile(looSorted, 0.1),
    p90: quantile(looSorted, 0.9),
    within2x: looSorted.filter((m) => m <= 2).length / looSorted.length,
    centre: Math.exp(quantile([...looErr].sort((p, q) => p - q), 0.5)),
  };

  const even = rows.filter((_, i) => i % 2 === 0);
  const odd = rows.filter((_, i) => i % 2 === 1);
  const random = record('alternating split', `every other row by slug trains (${even.length}), the rest test (${odd.length})`, even, odd);

  // The time split: the listed_at day is the protocol's age. Rows with no listed_at are left out of
  // this split, because a split on time cannot place them; the count is printed.
  const dated = rows.filter((r) => r.days_listed !== null);
  const days = dated.map((r) => r.days_listed as number).sort((p, q) => p - q);
  const cut = quantile(days, 0.5);
  const older = dated.filter((r) => (r.days_listed as number) >= cut);
  const newer = dated.filter((r) => (r.days_listed as number) < cut);
  const time = record(
    'time split',
    `trained on the ${older.length} protocols listed at least ${Math.round(cut)} days ago, tested on the ${newer.length} listed more recently (${rows.length - dated.length} undated left out)`,
    older,
    newer,
  );
  return { loo, random, time, cut };
}

/** The verdict at a stated deposit and the drop share at which it turns from SKIP to FARM. */
export interface Threshold {
  /** The minimum share of the implied value the token must keep, at the row's own plan cost. */
  keep_floor: number;
  /** The maximum drop share (per cent) at which the plan still pays, at its own cost. */
  drop_max: number;
  /** The same two at a $1000 position, which is the deposit the page states beside them. */
  keep_floor_1000: number;
  drop_max_1000: number;
  /** How far the implied value must move, as a share of itself, for the verdict to flip. */
  sensitivity: number;
  /** True when the verdict is FARM at every implied value above its break-even value. */
  robust: boolean;
}

/** The deposit the page's threshold column is stated at, whatever the plan's own size. */
export const THRESHOLD_DEPOSIT = 1000;

/**
 * The break-even algebra, in one place. A farmer receives `hold` of the implied value when the
 * launch happens; if the token then keeps share `s` of that value, the farm returns `hold * V * s`
 * against a cost `f`, so it turns positive when `s >= f / (hold * V)`. Everything below is that
 * inequality, evaluated at the plan's own cost and at the $1000 deposit the page prints.
 */
export function thresholds(implied: number, hold: number, cost: number): Threshold {
  const keepFloor = cost / (hold * implied);
  const keep1000 = THRESHOLD_DEPOSIT / (hold * implied);
  // Sensitivity: the smallest move in the implied value, as a share of itself, that takes the verdict
  // from one side of its break-even to the other. The verdict is FARM when implied >= cost / hold, so
  // the flip is a move to, or away from, that value; a row already past it is as robust as the cost
  // being 100% of the return.
  const flip = cost / (hold * implied);
  const sensitivity = Math.abs(1 - flip);
  return {
    keep_floor: keepFloor,
    drop_max: 100 * (1 - keepFloor),
    keep_floor_1000: keep1000,
    drop_max_1000: 100 * (1 - keep1000),
    sensitivity,
    robust: keepFloor < 1,
  };
}
