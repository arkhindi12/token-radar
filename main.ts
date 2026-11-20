// A token launch radar: which protocol that records no token is worth farming, and what its token
// would be worth if its record stayed as it is.
//
// The program reads the sealed snapshot (at /input/snapshot.json, or --input <file|dir>), fits its
// value model on the snapshot's own 128 protocols that record both a TVL and a positive market cap,
// ranks every protocol that records no token and is not a venue, and writes:
//
//   <out>/board.json      the ranked rows, in the gate's shape, with each row's band and verdict
//   <out>/data.js         the same numbers for the page, one script, no fetch
//   <out>/dashboard/      the static page (copied from this repository)
//   <out>/screenshots/    the three screenshots (copied from this repository)
//   <out>/dossier.json    the judge's dossier, written by the vendored library from the three above
//
// It refuses to write a board the gate would reject, and refuses before writing anything: the
// self-check in lib/board.ts runs first and a failure exits non-zero with the reason on stderr.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot, SnapshotError } from './lib/snapshot.ts';
import { boardCheck, boardFingerprint, buildRadar, dataScript, gateRows } from './lib/board.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text one shapes the bytes, the others refuse. */
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_CAPS = {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

/** Write a file and say how it went, in the one summary the program prints. */
function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? resolve(inputArg) : resolve(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|a directory holding one>`, 2);
const out = resolve(arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  if (err instanceof SnapshotError) fail(`the snapshot is not one this radar can score: ${err.message}`, 2);
  throw err;
}

const radar = buildRadar(snapshot);
const issue = boardCheck(radar, snapshot);
if (issue !== null) fail(`the board this snapshot yields would fail the gate, so nothing was written: ${issue}.`);

const rows = gateRows(radar);
const fingerprint = boardFingerprint(rows);
const seal = {
  rows_drawn: radar.accounting.total,
  rows_ranked: radar.rows.length,
  ranks: `1..${radar.rows.length} once each`,
  monotonic: radar.rows.every((r, i) => i === 0 || radar.rows[i - 1]!.implied_value_usd >= r.implied_value_usd),
  total_implied_usd: radar.rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
  watchlist_covered: snapshot.watchlist.every((s) => radar.rows.some((r) => r.slug === s)),
  watchlist_slugs: snapshot.watchlist.length,
  distinct_values: new Set(radar.rows.map((r) => r.implied_value_usd)).size,
  board_sha256: fingerprint,
  fit_pairs: radar.model.n,
};

mkdirSync(out, { recursive: true });
// Clear the directories this program owns, so a second run over the same out/ writes the same tree
// rather than leaving a stale page or screenshot behind from an earlier run.
for (const dir of ['dashboard', 'screenshots']) {
  const path = join(out, dir);
  if (existsSync(path)) {
    for (const name of readdirSync(path)) rmSync(join(path, name), { recursive: true, force: true });
  }
}
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: radar.as_of, model: { a: radar.model.a, b: radar.model.b, n: radar.model.n }, rows: gateRows(radar) })}\n`);
// The page lives in dashboard/, so it reads the data from beside itself; board.json keeps a copy at
// the output root for the gate. The two are the same bytes of the same data, written once each.

/** Copy one directory's regular files into `to`, skipping hidden ones. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    // data.js is never copied: the program writes it below, from the numbers on this run's board.
    if (to.endsWith('dashboard') && name === 'data.js') continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names.sort();
}

const page = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (!page.includes('index.html')) fail('dashboard/index.html is missing from this repository');
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: the entry hands in 3`);

const data = dataScript(radar, seal);
writeFileSync(join(out, 'data.js'), data);
writeFileSync(join(out, 'dashboard', 'data.js'), data);

// The dossier is written last, from what is now on disk: the scorer rebuilds it and compares bytes.
const dossier = buildDossier(out, DOSSIER_CAPS);
writeFileSync(join(out, 'dossier.json'), dossier);

const usd = (n: number): string => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist\n` +
    `token radar: model log mcap = ${radar.model.a.toFixed(4)} + ${radar.model.b.toFixed(4)} * log tvl, fitted on ${radar.model.n} pairs ` +
    `(leave-one-out typical miss x${radar.model.looMedian.toFixed(2)}); band p10 x${radar.model.p10.toFixed(2)} / p50 x${radar.model.p50.toFixed(2)} / p90 x${radar.model.p90.toFixed(2)}\n` +
    `token radar: universe ${radar.accounting.total} = ${radar.accounting.ranked} ranked + ${radar.accounting.live} live-token + ${radar.accounting.excluded} excluded; ` +
    `${radar.accounting.watched} ranked rows on the watchlist, ${radar.accounting.off_list} off it\n` +
    `token radar: board ${radar.rows.length} rows, ranks 1..${radar.rows.length}, implied ${usd(radar.rows[0]!.implied_value_usd)} down to ${usd(radar.rows[radar.rows.length - 1]!.implied_value_usd)}, ` +
    `total ${usd(seal.total_implied_usd)}, fingerprint ${fingerprint.slice(0, 16)}…\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${page.length} files, ${page.join(' ')}), screenshots/ (${shots.length} images), dossier.json (${dossier.length} bytes)\n`,
);
