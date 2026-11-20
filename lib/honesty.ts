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

/**
 * The money, from a basis said in one sentence:
 *
 *   expected profit = implied value x share the whole farmer population receives x share the token
 *                     keeps once liquid and vested - the plan's cost.
 *
 * Two shares, and they are not independent assumptions to be multiplied blindly: the first is a share
 * of market cap, the second is the level the token holds it at. Together they say how much of the
 * implied value a farmer banking at the horizon actually gets.
 *
 *   HOLD_SHARE = 0.001   The share of a protocol's market cap a launch hands the WHOLE farmer
 *                        population (airdrop plus farm rewards). 0.1% is a deliberately small prior:
 *                        launches have handed out nothing at one end and several per cent at the
 *                        other, and a board that assumes the generous end is a board that says "farm
 *                        everything". It is the first assumption a reader should move.
 *   KEEP_SHARE = 0.25    The share of the implied value the token still holds once liquid: launch
 *                        supply, unlocks and the drop's own selling are in it. 25% is a 75% fall from
 *                        the implied value, far outside the residual band's centre (x1.08), because
 *                        the band measures the model and not the launch.
 *
 * One combined number divides every row the same way:
 *
 *   BANKED_SHARE = 3e-5      Three basis points of market cap. It is small because the plans
 *                           are cheap: see the note above the constant for the arithmetic that sets
 *                           it, and the lean and kind rows for what the verdicts do when it moves
 *                           five times either way.
 *
 * No momentum, maturity or evidence multiplier enters the money: those are confidence terms that
 * widen the band (see confidence() in board.ts), never terms that inflate a payout.
 */
export const HOLD_SHARE = 0.001;
export const KEEP_SHARE = 0.25;

/** How long a reader is assumed to hold before the position is counted: the program's usual horizon. */
export const HORIZON_MONTHS = 12;

/** The position the page's secondary break-even column is stated at, whatever the plan's own size. */
export const THRESHOLD_DEPOSIT = 1000;

/**
 * The share of the implied value a farmer banks at the horizon, under the conservative base.
 *
 * `HOLD_SHARE x KEEP_SHARE = 0.001 x 0.25 = 2.5e-4`, and that product is the number this board
 * actually uses. The snapshot carries no airdrop, allocation or float field, so no share can be
 * derived from it: the two inputs above are a stated convention a reader can move, not a finding.
 * The brief they sit in is "a launch hands the community between a tenth of a per cent and a few
 * per cent of supply, and the token keeps a quarter to all of its implied value once liquid".
 *
 * An earlier revision of this file shipped `BANKED_SHARE = 3e-5`, chosen by sweeping candidate
 * values until the break-even column looked believable. That is the one thing this board must not
 * do, and it is gone: the base is now the conservative end of the stated band, printed as an
 * assumption on the page, and every row quotes the optimistic end beside it.
 */
export const BANKED_SHARE = HOLD_SHARE * KEEP_SHARE;

/** What a row's money comes to, and the break-evens that follow from it. */
export interface Money {
  /** What a farmer's allocation is worth once liquid, in dollars. */
  banked_usd: number;
  /** Expected profit: banked value minus the plan's cost. Negative when the plan does not pay. */
  profit_usd: number;
  /** The share of the implied value the token must keep for a plan this size to break even. */
  keep_floor: number;
  /** The break-even as a drop from the implied value, in per cent: the number a reader acts on. */
  breakeven_drop_pct: number;
  /** The implied market cap at which the plan's cost is exactly returned. */
  breakeven_usd: number;
  /** The same break-even drop at a flat $1,000 position, for a reader who funds more than the plan. */
  drop_max_1000: number;
  /** The deposit the secondary threshold is stated at. */
  deposit_1000: number;
}

/**
 * The family of assumptions offered to the reader, so a verdict's dependence on them is visible and a
 * row can be qualified rather than sold. Each field is the share of the implied value a farmer banks
 * at the horizon. The base is the column's basis; the others are the range it could honestly sit in:
 * five times less and two times more. A row that is FARM at lean and SKIP at kind is a row whose
 * verdict the reader must decide, and the page says which rows those are.
 */
export const BASIS: { key: string; label: string; banked: number }[] = [
  { key: 'lean', label: 'lean: -5x the base - a launch that hands out almost nothing and the token decays', banked: BANKED_SHARE / 5 },
  { key: 'base', label: 'base: a quarter of a basis point banked - what every column on the board uses', banked: BANKED_SHARE },
  { key: 'kind', label: 'kind: +2x the base - an allocation and a token at the generous end', banked: BANKED_SHARE * 2 },
];

/**
 * The money for one row. `banked` is the share of the implied value a farmer keeps at the horizon;
 * everything else is arithmetic. The plan turns positive when `implied * banked >= cost`, so the
 * break-even drop is `1 - cost / (implied * banked)`: it is in the tens of percent exactly when
 * `banked` times the implied value is a multiple of a few hundred dollars, which is the point.
 */
export function money(implied: number, cost: number, banked: number = BANKED_SHARE): Money {
  const bankedUsd = implied * banked;
  const keepFloor = cost / bankedUsd;
  const b1000 = THRESHOLD_DEPOSIT / bankedUsd;
  return {
    banked_usd: bankedUsd,
    profit_usd: bankedUsd - cost,
    keep_floor: keepFloor,
    breakeven_drop_pct: 100 * (1 - keepFloor),
    breakeven_usd: cost / banked,
    drop_max_1000: 100 * (1 - b1000),
    deposit_1000: THRESHOLD_DEPOSIT,
  };
}

/** The verdict bands, stated once: how far expected profit sits above or below the plan's cost. */
export const VERDICT_RULE = {
  farm: 'expected profit is at least twice the plan\u2019s cost: the farm returns more than 2x',
  marginal: 'expected profit is positive but below the plan\u2019s cost: it pays, but by less than 2x',
  skip: 'expected profit is zero or negative: the plan does not pay for itself at these assumptions',
} as const;
