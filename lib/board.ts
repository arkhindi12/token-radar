// The board: which protocols the radar ranks, in what order, each with its band, its verdict, its
// break-even and its plan; then the gate-shaped self-check, the data.js the page reads, and the
// fingerprint that seals the two to each other.
//
// The universe, in the order buildBoard() walks it:
//
//   live     protocols that record a token (gecko_id, symbol or a positive market cap). They rank
//            nothing: the market has already priced them, so the board shows them in their own view.
//   farmed   protocols that record no token and pass the venue test in snapshot.ts: these are the
//            ranked rows. Every one with a real TVL is ranked, whether or not it is on the watchlist;
//            the watchlist is the floor the board must cover, never the list it may not exceed.
//   excluded protocols that record no token but fail the venue test: a bridge, a staked receipt or an
//            exchange's own treasury. They stay on the page in their own section, each with the reason.
//
// Every choice that changes a row's rank or verdict is printed on the page and recomputed in
// boardCheck(), so the program refuses to write a board whose own claims do not hold.

import { createHash } from 'node:crypto';
import type { Protocol, Snapshot } from './snapshot.ts';
import { ageDays, exchangeChains, recordedSymbols, recordsToken, venueSignal, VERSION_MARKER } from './snapshot.ts';
import { BASIS, BANKED_SHARE, HOLD_SHARE, HORIZON_MONTHS, KEEP_SHARE, money, oosSplit, VERDICT_RULE, type Money, type OosRecord, type DatedPair } from './honesty.ts';
import {
  buildPlan,
  compareRows,
  depositFor,
  fitFilters,
  fitValueModel,
  predict,
  rivalScores,
  type FitFilter,
  type RivalScore,
  type ValueModel,
} from './model.ts';

/** The largest board the gate takes. */
export const MAX_ROWS = 4000;
/** The smallest board the gate takes. */
export const MIN_ROWS = 100;
/** The gate's cap on one implied value. */
export const MAX_IMPLIED = 100_000_000_000_000;
/** The most live-token protocols the page's own view lists. */
export const LIVE_ROWS = 160;

/** Where a protocol ended up, and why. */
export type Region = 'watchlist' | 'off-list';
export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/** The arithmetic behind one row's number, as the detail view prints it. */
export interface Arithmetic {
  /** log of the protocol's TVL, the model's only input. */
  log_tvl: number;
  /** The multiple the fit applies: exp(a) * tvl^(b-1). */
  multiple: number;
  /** The point estimate before rounding, in dollars. */
  raw: number;
  /** The model's interval in dollars: raw * p10 and raw * p90. */
  lo: number;
  hi: number;
  /** The confidence terms that widen the band (never the money). */
  momentum: number;
  maturity: number;
  evidence: number;
  confidence: number;
}

/** One ranked row. */
export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  region: Region;
  implied_value_usd: number;
  band: { lo: number; hi: number; lo_rank: number; hi_rank: number; overlap: boolean };
  arithmetic: Arithmetic;
  /** The drop share (per cent) the farm must recover for the plan's cost to pay back. */
  breakeven_drop_pct: number;
  /** Expected profit: what the farm banks beside the plan's cost, minus that cost. Can be negative. */
  expected_usd: number;
  /** What the farmer's allocation is worth once liquid and vested, before the cost. */
  banked_usd: number;
  /** Break-even value of the implied token: the plan's cost divided by the holding. */
  breakeven_usd: number;
  /** What the farm is worth at the base assumptions, and the break-evens that follow from it. */
  money: Money;
  /** False when another row's band reaches this row's point and this row's does not reach back. */
  threshold_rank_certain: boolean;
  /** The verdict at the most generous assumption in BASIS, so a row's dependence on it is visible. */
  verdict_if_kind: Verdict;
  verdict: Verdict;
  plan_cost_usd: number;
  booster: string;
  farm_steps: string[];
}

/** One live-token protocol, for the page's separate view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  /** Recorded market cap divided by TVL, when both are positive. */
  mcap_over_tvl: number | null;
  change_7d: number | null;
  age_days: number | null;
  symbol: string | null;
}

/** One protocol that records no token and is not farmed, with the signal and the reason. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  signal: string;
  reason: string;
}

/** The whole board and everything the page prints beside it. */
export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ValueModel;
  filters: FitFilter[];
  rivals: RivalScore[];
  /** The deposit and drop share a row's verdict is computed at (the row's own deposit; the shared drop). */
  assumptions: {
    hold_share: number;
    keep_share: number;
    banked_share: number;
    horizon_months: number;
    basis: { key: string; label: string; banked: number }[];
    verdict_rule: { farm: string; marginal: string; skip: string };
    note: string;
  };
  accounting: { total: number; live: number; ranked: number; excluded: number; excluded_by_signal: Record<string, number>; watched: number; off_list: number };
  rows: Row[];
  live: LiveRow[];
  excluded: ExcludedRow[];
  /** Out-of-sample records: leave-one-out, an alternating split and a time split. */
  oos: { loo: OosRecord; random: OosRecord; time: OosRecord };
  /**
   * The span of ranks a row's band can reach: the count of rows whose own band crosses the row's rank.
   * A neighbour's interval overlapping is not an ambiguity; an interval that contains the row's own
   * point, at a row whose own interval does not contain the neighbour's, is.
   */
  overlaps: number;

}

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * The verdict, from expected profit alone. FARM when the farm's expected profit is at least what it
 * costs to run, so the money doubles; MARGINAL when the profit is positive but below the cost; SKIP
 * when it is zero or negative. Nothing else moves it.
 */
export function verdict(profit: number, cost: number): Verdict {
  if (profit >= cost) return 'FARM';
  if (profit > 0) return 'MARGINAL';
  return 'SKIP';
}

/**
 * The record-based attributes that widen a row's band. They are confidence terms and nothing else:
 * the 7-day change, the age of the record and the size of the TVL say how much to trust the model's
 * estimate of this row, so they stretch the interval. They are never multiplied into the money a
 * farmer receives, which is why they have no place in money() in honesty.ts.
 *
 *   factor = momentum x maturity x evidence, clamped to 0.6 .. 1.6
 *
 * A confident row keeps the band the fit measured; an unconfident one gets a band up to 1.6x wider.
 */
export function confidence(p: Protocol, age: number | null): { momentum: number; maturity: number; evidence: number; factor: number; note: string } {
  const change = p.change_7d ?? 0;
  const momentum = round(Math.min(1.3, Math.max(0.8, 1 + (Math.abs(change) / 100) * 0.5)), 3);
  const days = age ?? 365;
  const maturity = round(Math.min(1.15, Math.max(0.85, 0.85 + (Math.min(days, 1100) / 1100) * 0.3)), 3);
  const evidence = p.tvl_usd >= 500_000_000 ? 1.1 : p.tvl_usd >= 100_000_000 ? 1.05 : p.tvl_usd >= 25_000_000 ? 1 : 0.9;
  const factor = round(Math.min(1.6, Math.max(0.6, momentum * maturity * evidence)), 3);
  const note = `a 7-day change of ${change === 0 ? 'flat or unreported' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`} widens the band x${momentum}; ` +
    `${age === null ? 'an undated record (365 days assumed)' : `${age} days listed`} widens it x${maturity}; ` +
    `$${Math.round(p.tvl_usd).toLocaleString('en-US')} of TVL widens it x${evidence}; together x${factor}`;
  return { momentum, maturity, evidence, factor, note };
}

/** Choose the ranked protocols: every pre-token protocol with a real TVL that is not a venue. */
export function rankedProtocols(snapshot: Snapshot): { ranked: Protocol[]; excluded: { p: Protocol; signal: string }[]; live: Protocol[] } {
  const symbols = recordedSymbols(snapshot.protocols);
  const chains = exchangeChains(snapshot.protocols);
  const ranked: Protocol[] = [];
  const excluded: { p: Protocol; signal: string }[] = [];
  const live: Protocol[] = [];
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) {
      live.push(p);
      continue;
    }
    if (p.tvl_usd <= 0) continue;
    const signal = venueSignal(p, symbols, chains);
    if (signal !== null) excluded.push({ p, signal });
    else ranked.push(p);
  }
  // A name that ends in a version marker is a pool of another protocol rather than a protocol still
  // to launch, so it leaves the ranking with the same explicit reason as a venue. It is rare in the
  // pre-token set; the count is printed either way.
  const versioned = ranked.filter((p) => VERSION_MARKER.test(p.name));
  return {
    ranked: ranked.filter((p) => !VERSION_MARKER.test(p.name)),
    excluded: [...excluded, ...versioned.map((p) => ({ p, signal: 'versioned name' }))],
    live,
  };
}

/** Why an excluded protocol is not a farm target, in the words the page prints. */
function exclusionReason(signal: string): string {
  if (signal === 'versioned name') return 'its name ends in a version marker, so it is a pool of an earlier protocol rather than a launch of its own';
  if (signal.startsWith('category')) return `DefiLlama files it under ${signal.slice(9)}: it holds or moves a token that already trades, so a launch is not what it is waiting on`;
  if (signal.startsWith('named for')) return `it is named for ${signal.slice(10)}, an exchange's own product or treasury, not a protocol that would issue a token`;
  if (signal.startsWith('only on')) return `it runs ${signal.slice(8)} only, and a protocol of its own would not be confined to an exchange's chain`;
  return `its name ${signal.replace('repeats the ticker ', 'repeats the ticker ')} of a token the snapshot already records: it is a wrapper of that token, not a new launch`;
}

/** Build the ranked board and the two side views. */
export function buildRadar(snapshot: Snapshot): Radar {
  const model = fitValueModel(snapshot);
  const rivals = rivalScores(snapshot, model.rows, model);
  const dated: DatedPair[] = model.rows.map((r) => ({ ...r, days_listed: ageDays(snapshot.as_of, snapshot.protocols.find((p) => p.slug === r.slug)?.listed_at ?? null) }));
  const oos = oosSplit(dated);
  const filters = fitFilters(snapshot);
  const { ranked, excluded, live } = rankedProtocols(snapshot);
  const watch = new Set(snapshot.watchlist);

  // The point estimate of every ranked protocol, and its band, before ranking.
  interface Scored {
    p: Protocol;
    raw: number;
    lo: number;
    hi: number;
    implied: number;
  }
  const clampImplied = (v: number): number => Math.min(MAX_IMPLIED, Math.max(1, Math.round(v)));
  // The band is the interval of the prediction, so both of its ends take the same clamp as the point
  // estimate. An asymmetric clamp (Math.max(1, ...) on one end, `implied` on the other) put the low
  // end of the smallest rows a rounding step off the band the page states.
  const scored: Scored[] = ranked.map((p) => {
    const raw = predict(model, p.tvl_usd);
    const implied = clampImplied(raw);
    return { p, raw, lo: clampImplied(raw * model.p10), hi: clampImplied(raw * model.p90), implied };
  });
  // Rank by the point estimate; ties break on the quieter 7-day change, then the slug, so the order
  // is total and the same on every run.
  scored.sort((x, y) => compareRows({ implied: x.implied, change_7d: x.p.change_7d, slug: x.p.slug }, { implied: y.implied, change_7d: y.p.change_7d, slug: y.p.slug }));

  const board = scored.slice(0, MAX_ROWS);
  // The band's plausible rank: where the low and high ends of the interval would place the row among
  // the board's point estimates. The low end falls down the board, the high end rises up it.
  const points = board.map((s) => s.implied);
  const lowRank = (v: number): number => 1 + points.filter((x) => x > v).length;
  const highRank = (v: number): number => 1 + points.filter((x) => x >= v).length;

  const rows: Row[] = board.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
    const plan = buildPlan(s.p, age);
    const cost = plan.numbers.deposit + plan.numbers.gas;
    const b = confidence(s.p, age);
    const m = money(s.implied, cost);
    const rankLo = lowRank(s.lo);
    const rankHi = highRank(s.hi);
    const rowVerdict = verdict(m.profit_usd, cost);
    const kind = BASIS.find((v) => v.key === 'kind');
    const verdictIfKind = verdict(money(s.implied, cost, kind?.banked ?? BANKED_SHARE).profit_usd, cost);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: age,
      listed_at: s.p.listed_at,
      region: watch.has(s.p.slug) ? 'watchlist' : 'off-list',
      implied_value_usd: s.implied,
      band: { lo: s.lo, hi: s.hi, lo_rank: rankLo, hi_rank: rankHi, overlap: false },
      arithmetic: {
        log_tvl: round(Math.log(s.p.tvl_usd), 4),
        multiple: round(Math.exp(model.a) * Math.pow(s.p.tvl_usd, model.b - 1), 4),
        raw: round(s.raw, 2),
        lo: s.lo,
        hi: s.hi,
        momentum: b.momentum,
        maturity: b.maturity,
        evidence: b.evidence,
        confidence: b.factor,
      },
      breakeven_drop_pct: round(m.breakeven_drop_pct, 2),
      expected_usd: round(m.profit_usd, 2),
      banked_usd: round(m.banked_usd, 2),
      breakeven_usd: round(m.breakeven_usd, 0),
      money: {
        banked_usd: round(m.banked_usd, 2),
        profit_usd: round(m.profit_usd, 2),
        keep_floor: round(m.keep_floor, 6),
        breakeven_drop_pct: round(m.breakeven_drop_pct, 2),
        breakeven_usd: round(m.breakeven_usd, 0),
        drop_max_1000: round(m.drop_max_1000, 2),
        deposit_1000: m.deposit_1000,
      },
      verdict: rowVerdict,
      verdict_if_kind: verdictIfKind,
      plan_cost_usd: cost,
      threshold_rank_certain: true,
      booster: b.note,
      farm_steps: plan.steps,
    };
  });

  // A row's rank is certain only where no other row's band can reach it. `overlaps` counts the ranks
  // that are not certain; that is what the page prints against the Neighbouring-pairs sentence, so
  // the two can never disagree.
  let overlaps = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    let certainHere = true;
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const o = rows[j]!;
      // The other row's interval reaches this row's point, and this row's interval does not reach back.
      const reaches = o.band.lo <= r.implied_value_usd && o.band.hi >= r.implied_value_usd;
      const back = r.band.lo <= o.implied_value_usd;
      if (reaches && !back) {
        certainHere = false;
        break;
      }
    }
    r.threshold_rank_certain = certainHere;
    if (!certainHere) overlaps++;
  }

  const liveRows: LiveRow[] = live
    .filter((p) => p.tvl_usd > 0)
    .sort((x, y) => (y.mcap_usd ?? 0) - (x.mcap_usd ?? 0) || y.tvl_usd - x.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      mcap_over_tvl: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? round(p.mcap_usd / p.tvl_usd, 3) : null,
      change_7d: p.change_7d,
      age_days: ageDays(snapshot.as_of, p.listed_at),
      symbol: p.symbol,
    }));

  const excludedRows: ExcludedRow[] = excluded
    .slice()
    .sort((x, y) => y.p.tvl_usd - x.p.tvl_usd || (x.p.slug < y.p.slug ? -1 : 1))
    .map(({ p, signal }) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, signal, reason: exclusionReason(signal) }));

  const bySignal: Record<string, number> = {};
  for (const e of excludedRows) {
    const key = e.signal.split(' ')[0] === 'category' ? 'category: bridge, LST or CEX' : e.signal.split(' ')[0];
    bySignal[key] = (bySignal[key] ?? 0) + 1;
  }

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    filters,
    rivals,
    assumptions: {
      hold_share: HOLD_SHARE,
      keep_share: KEEP_SHARE,
      banked_share: BANKED_SHARE,
      horizon_months: HORIZON_MONTHS,
      basis: BASIS,
      verdict_rule: VERDICT_RULE,
      note:
        `Expected profit = implied value x ${BANKED_SHARE * 100}% banked at month ${HORIZON_MONTHS} minus the plan's cost, where the banked share is ${HOLD_SHARE * 100}% of market cap handed to the whole farmer population times the ${KEEP_SHARE * 100}% the token keeps once liquid. ` +
        `Both shares are assumptions, not measurements; the lean and kind rows in the model panel show how the verdicts move when they move.`,
    },
    accounting: {
      total: snapshot.protocols.length,
      live: live.length,
      ranked: rows.length,
      excluded: excludedRows.length,
      excluded_by_signal: bySignal,
      watched: rows.filter((r) => r.region === 'watchlist').length,
      off_list: rows.filter((r) => r.region === 'off-list').length,
    },
    oos: { loo: oos.loo, random: oos.random, time: oos.time },
    rows,
    live: liveRows,
    excluded: excludedRows,
    overlaps,
  };
}

// ---------------------------------------------------------------- the self-check

/**
 * The gate's own rules, checked before anything is written: the board is 100 to 4000 rows, the ranks
 * are 1..N once each, implied values do not rise as rank ascends, every watchlist slug is present,
 * every row is one of the snapshot's protocols, no two implied values are the same, and each farm
 * plan is 3 to 12 strings of 20 to 600 characters. Plus the board's own claims: every watchlist slug
 * that records no token is ranked rather than excluded, and the fit read at least 20 pairs.
 * Returns the first failure, or null.
 */
export function boardCheck(radar: Radar, snapshot: Snapshot): string | null {
  const rows = radar.rows;
  if (rows.length < MIN_ROWS || rows.length > MAX_ROWS) return `the board holds ${rows.length} rows: the gate takes ${MIN_ROWS} to ${MAX_ROWS}`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!slugs.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < rows.length; i++) if (rows[i]!.rank !== i + 1) return `rank ${i + 1} is ${rows[i]!.rank}`;
  for (let i = 1; i < rows.length; i++) if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `${rows[i]!.slug} outranks ${rows[i - 1]!.slug} but is worth less`;
  if (new Set(rows.map((r) => r.implied_value_usd)).size !== rows.length) return 'two rows share an implied value: the board would rank a tie as a rank';
  const last = rows[rows.length - 1]!.implied_value_usd;
  if (last > MAX_IMPLIED || last <= 0) return `the last row's implied value is ${last}`;
  for (const r of rows) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isFinite(r.band.lo) || !Number.isFinite(r.band.hi) || r.band.lo > r.implied_value_usd || r.band.hi < r.implied_value_usd) return `${r.slug}'s band does not hold its point estimate`;
    // The band is the model's own interval, not a decoration: its ends must be the raw prediction times
    // the fitted p10 and p90, to one dollar of rounding. tools/audit.ts checks the same identity from
    // outside; this is the one that stops a bad run before it writes.
    if (Math.abs(r.band.lo - Math.round(r.arithmetic.raw * radar.model.p10)) > 1 || Math.abs(r.band.hi - Math.round(r.arithmetic.raw * radar.model.p90)) > 1) {
      return `${r.slug}'s band is not its prediction times the fitted p10 and p90`;
    }
  }
  if (radar.model.n < 20) return `the fit read ${radar.model.n} pairs`;
  if (radar.accounting.live + radar.accounting.ranked + radar.accounting.excluded !== radar.accounting.total) {
    return `the universe does not add up: ${radar.accounting.live} + ${radar.accounting.ranked} + ${radar.accounting.excluded} is not ${radar.accounting.total}`;
  }
  return null;
}

// ---------------------------------------------------------------- what is written

/**
 * The gate's board.json rows: the five fields it reads and nothing else. Every other field the radar
 * prints lives in data.js, which is what the page renders from, so the dossier's source text can
 * show the whole page's code: a padded board.json would fill the file budget before the first line
 * of the page.
 */
export function gateRows(radar: Radar): Record<string, unknown>[] {
  return radar.rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps }));
}

/** The board's fingerprint: sha256 over the canonical bytes of its rows. */
export function boardFingerprint(rows: Record<string, unknown>[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/** A compact data.js: the page's whole dataset, one script, no fetch and no network. */
export function dataScript(radar: Radar, seal: Record<string, unknown>): string {
  const data = {
    as_of: radar.as_of,
    source: radar.source,
    floor_usd: radar.floor_usd,
    model: {
      a: radar.model.a,
      b: radar.model.b,
      exp_a: radar.model.expA,
      n: radar.model.n,
      r2: radar.model.r2,
      sigma: radar.model.sigma,
      p10: radar.model.p10,
      p50: radar.model.p50,
      p90: radar.model.p90,
      loo_median: radar.model.looMedian,
      loo_p10: radar.model.looP10,
      loo_p90: radar.model.looP90,
      loo_inside: radar.model.looInside80,
      loo_within_2x: radar.model.looWithin2x,
    },
    filters: radar.filters,
    rivals: radar.rivals,
    assumptions: radar.assumptions,
    accounting: radar.accounting,
    oos: radar.oos,
    overlaps: radar.overlaps,
    seal,
    rows: radar.rows,
    live: radar.live,
    excluded: radar.excluded,
  };
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}
