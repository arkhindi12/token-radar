/**
 * The audit the page's claims are held to, run as a check rather than read by eye.
 *
 *   node tools/audit.ts out [snapshot.json]
 *
 * Every claim below is recomputed from the snapshot independently of main.ts, and compared with what
 * the program wrote. A failure exits 1.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'out';
const snapPath = process.argv[3] ?? '/opt/data/work/mf/tr-kit/token-radar-01-kit/input/snapshot.json';
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const D = JSON.parse(readFileSync(join(out, 'data.js'), 'utf8').replace(/^window\.RADAR\s*=\s*/, '').replace(/;\s*$/, ''));
const B = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));

let bad = 0;
const ok = (name: string, holds: boolean, detail: string): void => {
  if (!holds) bad++;
  process.stdout.write(`${holds ? 'HOLDS' : 'FAILS'}  ${name.padEnd(46)} ${detail}\n`);
};
const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

// ---------------------------------------------------------------- 1. the coefficients on the page price the rows
const both = snap.protocols.filter((p: any) => p.tvl_usd > 0 && p.mcap_usd > 0);
const X = both.map((p: any) => Math.log(p.tvl_usd));
const Y = both.map((p: any) => Math.log(p.mcap_usd));
const n = X.length;
const mx = X.reduce((a: number, b: number) => a + b, 0) / n;
const my = Y.reduce((a: number, b: number) => a + b, 0) / n;
let sxy = 0;
let sxx = 0;
for (let i = 0; i < n; i++) {
  sxy += (X[i] - mx) * (Y[i] - my);
  sxx += (X[i] - mx) ** 2;
}
const b = sxy / sxx;
const a = my - b * mx;
ok('page a,b equal an independent refit', Math.abs(a - D.model.a) < 1e-9 && Math.abs(b - D.model.b) < 1e-9, `refit a=${a.toFixed(6)} b=${b.toFixed(6)} n=${n}; page a=${D.model.a.toFixed(6)} b=${D.model.b.toFixed(6)} n=${D.model.n}`);
const priced = D.rows.every((r: any) => Math.abs(Math.exp(a) * Math.pow(r.tvl_usd, b) - r.implied_value_usd) <= 1);
ok('those coefficients price every row', priced, `${D.rows.length} rows; first ${money(D.rows[0].implied_value_usd)} from TVL ${money(D.rows[0].tvl_usd)}`);
const boardAgrees = B.rows.every((r: any, i: number) => r.implied_value_usd === D.rows[i].implied_value_usd && r.rank === D.rows[i].rank);
ok('board.json and data.js carry the same numbers', boardAgrees, 'rank and implied value, row by row');

// ---------------------------------------------------------------- 2. the band comes from the fit's own residuals
const resid = Y.map((y: number, i: number) => Math.exp(y - (a + b * X[i]))).sort((p: number, q: number) => p - q);
const q = (arr: number[], p: number): number => {
  const at = (arr.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return arr[lo] + (arr[hi] - arr[lo]) * (at - lo);
};
ok('p10/p50/p90 are the residual quantiles', Math.abs(q(resid, 0.1) - D.model.p10) < 1e-9 && Math.abs(q(resid, 0.5) - D.model.p50) < 1e-9 && Math.abs(q(resid, 0.9) - D.model.p90) < 1e-9, `p10 ${q(resid, 0.1).toFixed(4)} p50 ${q(resid, 0.5).toFixed(4)} p90 ${q(resid, 0.9).toFixed(4)}`);
// The band is the raw prediction times p10 and p90, rounded and clamped. `arithmetic.raw` carries the
// raw prediction, so the comparison is exact to the rounding of one dollar, not to a tolerance that
// hides a bug: an earlier asymmetric clamp left the smallest rows a step off and this caught it.
const bandOk = D.rows.every((r: any) => Math.abs(r.band.lo - Math.round(r.arithmetic.raw * D.model.p10)) <= 1 && Math.abs(r.band.hi - Math.round(r.arithmetic.raw * D.model.p90)) <= 1);
ok('each row band is the raw prediction x p10/p90', bandOk, `every one of ${D.rows.length} rows, to one dollar of rounding`);

// ---------------------------------------------------------------- 3. the break-even drop, worked by hand on one row
const r = D.rows.find((x: any) => x.slug === 'steakhouse-financial') ?? D.rows[0];
const V = r.implied_value_usd;
const hold = D.assumptions.hold_share_of_implied;
const steps = r.farm_steps.join(' ');
const Ddep = Number((steps.match(/\$(\d+) for the position/) ?? [])[1]);
const gas = Number((steps.match(/and \$(\d+) held back for gas/) ?? [])[1]);
const f = Ddep + gas;
const sStar = f / (hold * V);
ok('plan cost in the steps equals the page cost', f === r.plan_cost_usd, `${r.slug}: $${Ddep} deposit + $${gas} gas = ${money(f)}; page ${money(r.plan_cost_usd)}`);
ok('s* = f / (hold x V) reproduces the printed drop', Math.abs(100 * (1 - sStar) - r.breakeven_drop_pct) < 0.01, `s*=${sStar.toFixed(6)}, drop ${(100 * (1 - sStar)).toFixed(2)}%, page ${r.breakeven_drop_pct.toFixed(2)}%`);
ok('identity s* x hold x V = f', Math.abs(sStar * hold * V - f) < 1e-6, `s* x hold(${hold}) x V(${money(V)}) = ${(sStar * hold * V).toFixed(2)} = f ${f}`);
ok('break-even value is cost / hold', Math.abs(f / hold - r.breakeven_usd) <= 1, `${money(f / hold)} vs ${money(r.breakeven_usd)}`);
const s1k = 1000 / (hold * V);
ok('$1,000 threshold is 1000 / (hold x V)', Math.abs(100 * (1 - s1k) - r.threshold.drop_max_1000) < 1e-6, `drop ${(100 * (1 - s1k)).toFixed(2)}%, page ${r.threshold.drop_max_1000.toFixed(2)}%`);

// ---------------------------------------------------------------- 4. the plausible-rank band is derived, not typed
const points = D.rows.map((x: any) => x.implied_value_usd);
const derived = D.rows.every((x: any) => {
  const hi = 1 + points.filter((p: number) => p >= x.band.hi).length;
  const lo = 1 + points.filter((p: number) => p > x.band.lo).length;
  return hi === x.band.hi_rank && lo === x.band.lo_rank;
});
ok('plausible rank is the band mapped onto the board', derived, 'hi = 1 + #{points >= hi}, lo = 1 + #{points > lo}, every row');
const spanOk = D.rows.every((x: any) => x.band.hi_rank <= x.rank && x.rank <= x.band.lo_rank);
ok('the band contains the row\'s own rank', spanOk, 'every row');

// ---------------------------------------------------------------- 5. the out-of-sample records are refits, not copies
const bySlug = new Map(snap.protocols.map((p: any) => [p.slug, p]));
const dated = both
  .map((p: any) => {
    const at = p.listed_at ? Date.parse(`${snap.as_of}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`) : null;
    return { x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd), days: at === null ? null : Math.max(0, Math.floor(at / 86_400_000)) };
  })
  .filter((d: any) => d.days !== null)
  .sort((p: any, q2: any) => p.days - q2.days);
const cut = q(dated.map((d: any) => d.days), 0.5);
const older = dated.filter((d: any) => d.days >= cut);
const newer = dated.filter((d: any) => d.days < cut);
const fit = (rows: any[]) => {
  const mxx = rows.reduce((s: number, d: any) => s + d.x, 0) / rows.length;
  const myy = rows.reduce((s: number, d: any) => s + d.y, 0) / rows.length;
  let s1 = 0;
  let s2 = 0;
  for (const d of rows) {
    s1 += (d.x - mxx) * (d.y - myy);
    s2 += (d.x - mxx) ** 2;
  }
  const bb = s1 / s2;
  return { a: myy - bb * mxx, b: bb };
};
const tf = fit(older);
const tMiss = newer.map((d: any) => Math.exp(Math.abs(tf.a + tf.b * d.x - d.y))).sort((p: number, q2: number) => p - q2);
ok('the time split reproduces', Math.abs(q(tMiss, 0.5) - D.oos.time.median_abs) < 1e-9, `train ${older.length} / test ${newer.length}, median ${q(tMiss, 0.5).toFixed(3)}vs ${D.oos.time.median_abs.toFixed(3)}`);
void bySlug;

process.stdout.write(bad === 0 ? '\naudit: every claim holds\n' : `\naudit: ${bad} claim(s) do not hold\n`);
process.exit(bad === 0 ? 0 : 1);
