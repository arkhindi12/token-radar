/**
 * A local stand-in for the sealed gate, written from RULES.txt ("The gate", "The dashboard", "The
 * dossier"): the seven rows the scorer checks, in the same order, with the same limits. It reads an
 * output directory and prints each row's verdict, and exits 1 if any row fails.
 *
 *   node tools/gate.ts out
 *
 * This is not the scorer. It is a second pair of eyes on the same rules, written here so the entry
 * is never handed in on the strength of its own self-check alone.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapshotPath = process.argv[3] ?? '/opt/data/work/mf/tr-kit/token-radar-01-kit/input/snapshot.json';

interface Check {
  row: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const add = (row: string, problems: string[]): void => {
  checks.push({ row, ok: problems.length === 0, detail: problems.length === 0 ? 'pass' : problems.slice(0, 3).join('; ') });
};

const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// ---------------------------------------------------------------- dashboard_files
{
  const dir = join(out, 'dashboard');
  const problems: string[] = [];
  const files: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(rel === '' ? dir : join(dir, rel), { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) problems.push(`dot-directory ${p}`);
        if (rel === '') files.push(`D:${e.name}`);
        walk(p);
      } else if (e.isFile()) {
        if (!NAME.test(e.name)) problems.push(`bad name ${p}`);
        files.push(p);
      } else problems.push(`${p} is not a regular file`);
    }
  };
  if (!existsSync(dir)) problems.push('no dashboard/');
  else {
    walk('');
    const names = files.filter((f) => !f.startsWith('D:'));
    const bytes = names.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    if (!names.includes('index.html')) problems.push('no index.html');
    if (!names.some((f) => f.endsWith('.css'))) problems.push('no .css');
    if (!names.some((f) => f.endsWith('.js'))) problems.push('no .js');
    if (names.length > 400) problems.push(`${names.length} files`);
    if (bytes > 4 * 1024 * 1024) problems.push(`${bytes} bytes`);
    const NET = /https?:\/\//i;
    for (const f of names) {
      const text = readFileSync(join(dir, f), 'utf8');
      if (f.endsWith('.html')) {
        // Attribute values, <style> bodies, inline imports.
        const attrs = [...text.matchAll(/\s[a-zA-Z-]+\s*=\s*["']([^"']*)["']/g)].map((m) => m[1] ?? '');
        const styles = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '');
        const inlineImports = [...text.matchAll(/import\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1] ?? '');
        if (attrs.some((v) => NET.test(v)) || styles.some((v) => NET.test(v)) || inlineImports.some((v) => NET.test(v))) problems.push(`${f} names a network address`);
      }
      if (f.endsWith('.css') && NET.test(text)) problems.push(`${f} names a network address`);
      if (f.endsWith('.js') || f.endsWith('.mjs')) {
        const specs = [...text.matchAll(/\b(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)];
        if (specs.some((m) => NET.test(m[1] ?? m[2] ?? m[3] ?? ''))) problems.push(`${f} imports a network address`);
      }
    }
  }
  add('dashboard_files', problems);
}

// ---------------------------------------------------------------- board_file + sorted_by_value + coverage + farm_steps
{
  const p = join(out, 'board.json');
  const problems: string[] = [];
  let rows: any[] = [];
  if (!existsSync(p)) problems.push('no board.json');
  else {
    const text = readFileSync(p, 'utf8');
    if (statSync(p).size > 8 * 1024 * 1024) problems.push('board.json over 8 MiB');
    let doc: any;
    try {
      doc = JSON.parse(text);
    } catch {
      problems.push('not JSON');
    }
    rows = Array.isArray(doc) ? doc : doc?.rows;
    if (!Array.isArray(rows)) problems.push('no rows array');
    else if (rows.length < 100 || rows.length > 4000) problems.push(`${rows.length} rows`);
  }
  const snap = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : null;
  const known = new Set<string>((snap?.protocols ?? []).map((x: any) => x.slug));
  const badFields: string[] = [];
  for (const r of rows) {
    if (typeof r?.slug !== 'string' || !/^\S{1,128}$/.test(r.slug)) badFields.push(`slug ${String(r?.slug)}`);
    else if (snap && !known.has(r.slug)) badFields.push(`invented slug ${r.slug}`);
    if (typeof r?.name !== 'string' || r.name === '') badFields.push(`${r?.slug} name`);
    if (!Number.isSafeInteger(r?.rank) || r.rank <= 0) badFields.push(`${r?.slug} rank`);
    if (!Number.isSafeInteger(r?.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) badFields.push(`${r?.slug} implied`);
  }
  if (badFields.length) problems.push(...badFields);
  if (new Set(rows.map((r) => r?.slug)).size !== rows.length) problems.push('a slug appears twice');
  if (rows.length >= 2 && new Set(rows.map((r) => r?.implied_value_usd)).size === 1) problems.push('every implied value is the same');
  add('board_file', problems);

  const order: string[] = [];
  const ranks = new Set(rows.map((r) => r?.rank));
  if (ranks.size !== rows.length || [...ranks].some((k) => typeof k !== 'number' || k < 1 || k > rows.length)) order.push('ranks are not 1..N once each');
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) { order.push(`rank ${byRank[i].rank} is worth more than rank ${byRank[i - 1].rank}`); break; }
  add('sorted_by_value', order);

  const cov: string[] = [];
  if (snap) {
    const have = new Set(rows.map((r) => r?.slug));
    const missing = (snap.watchlist as string[]).filter((s) => !have.has(s));
    if (missing.length) cov.push(`missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`);
  } else cov.push('snapshot not found to compare');
  add('coverage', cov);

  const steps: string[] = [];
  for (const r of rows) {
    const s = r?.farm_steps;
    if (!Array.isArray(s) || s.length < 3 || s.length > 12) { steps.push(`${r?.slug} has ${Array.isArray(s) ? s.length : 'no'} steps`); continue; }
    for (const t of s) {
      if (typeof t !== 'string' || t.trim().length < 20 || t.trim().length > 600) { steps.push(`${r?.slug} has a step of ${typeof t === 'string' ? t.trim().length : 'non-string'}`); break; }
    }
  }
  add('farm_steps', steps);
}

// ---------------------------------------------------------------- screenshots
{
  const dir = join(out, 'screenshots');
  const problems: string[] = [];
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort() : [];
  if (names.length < 3 || names.length > 4) problems.push(`${names.length} images`);
  const png = (b: Buffer): boolean => b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = (b: Buffer): boolean => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  for (const n of names) {
    const p = join(dir, n);
    if (!NAME.test(n)) problems.push(`bad name ${n}`);
    if (!lstatSync(p).isFile()) problems.push(`${n} not a regular file`);
    const size = statSync(p).size;
    if (size > 512 * 1024) problems.push(`${n} ${size} bytes`);
    const b = readFileSync(p);
    if (!png(b) && !jpeg(b)) { problems.push(`${n} not a whole PNG/JPEG`); continue; }
    if (png(b)) {
      // IHDR holds the width and height.
      const w = b.readUInt32BE(16);
      const h = b.readUInt32BE(20);
      if (Math.max(w, h) > 1440 || Math.min(w, h) < 800) problems.push(`${n} ${w}x${h}`);
    }
  }
  add('screenshots', problems);
}

// ---------------------------------------------------------------- dossier_matches
{
  const problems: string[] = [];
  const p = join(out, 'dossier.json');
  if (!existsSync(p)) problems.push('no dossier.json');
  else {
    const have = readFileSync(p);
    if (have.length > 1.5 * 1024 * 1024) problems.push(`${have.length} bytes`);
    const want = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
    const same = Buffer.from(want).equals(have);
    const ha = createHash('sha256').update(have).digest('hex').slice(0, 16);
    const hb = createHash('sha256').update(want).digest('hex').slice(0, 16);
    if (!same) problems.push(`differs from buildDossier (${ha} vs ${hb})`);
    else problems.push(`sha256 ${ha}… matches buildDossier`);
  }
  const c = { row: 'dossier_matches', ok: problems.length === 1, detail: problems.join('; ') };
  checks.push(c);
}

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.row.padEnd(18)} ${c.detail}\n`);
}
process.stdout.write(failed === 0 ? '\ngate: 7 of 7 rows pass\n' : `\ngate: ${failed} row(s) fail\n`);
process.exit(failed === 0 ? 0 : 1);
