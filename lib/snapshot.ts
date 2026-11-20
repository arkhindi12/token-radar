// Reading the sealed snapshot, and the rules that sort its protocols into the sets the radar ranks.
//
// The snapshot is DefiLlama's own record, fetched once: 758 protocols, ten fields each, no ranking
// and no implied value. Everything the radar claims is derived from these fields, here and in
// model.ts. Two of the fields are dirty in a way the radar must state rather than hide: `mcap_usd`
// carries 0 and -1 where DefiLlama has no market cap, and a protocol can record a market cap while
// recording no token. Both are filtered explicitly and counted, so the page can print how many rows
// each filter removed.

/** One protocol exactly as the snapshot writes it. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Why a file is not a snapshot this program can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The snapshot out of a file's text. The check is strict about the parts the radar relies on (a
 * slug, a name, a finite TVL, the watchlist) and lenient about an absent optional field, which it
 * reads as null: a malformed snapshot is refused twice, once here and once by the gate-shaped
 * self-check in boardCheck(), so the program never writes a board it cannot defend.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (!isRecord(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const asOf = raw.as_of;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date (YYYY-MM-DD)');
  if (typeof raw.source !== 'string' || raw.source === '') throw new SnapshotError('snapshot.json has no source line');
  const floor = raw.floor_usd;
  if (typeof floor !== 'number' || !Number.isFinite(floor) || floor <= 0) throw new SnapshotError('snapshot.json has no positive floor_usd');
  if (!Array.isArray(raw.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist array of slugs');

  const seen = new Set<string>();
  const protocols = raw.protocols.map((entry, i): Protocol => {
    if (!isRecord(entry)) throw new SnapshotError(`protocol ${i} is not an object`);
    const { slug, name, tvl_usd } = entry;
    if (typeof slug !== 'string' || slug === '') throw new SnapshotError(`protocol ${i} has no slug`);
    if (/\s/.test(slug)) throw new SnapshotError(`protocol ${i} has a slug with whitespace: ${JSON.stringify(slug)}`);
    if (seen.has(slug)) throw new SnapshotError(`protocol ${i} repeats the slug ${slug}`);
    seen.add(slug);
    if (typeof name !== 'string' || name.trim() === '') throw new SnapshotError(`protocol ${slug} has no name`);
    if (typeof tvl_usd !== 'number' || !Number.isFinite(tvl_usd)) throw new SnapshotError(`protocol ${slug} has no finite tvl_usd`);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v !== '-' ? v : null);
    return {
      slug,
      name,
      category: str(entry.category),
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string' && c !== '') : [],
      tvl_usd,
      change_7d: num(entry.change_7d),
      mcap_usd: num(entry.mcap_usd),
      listed_at: typeof entry.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.listed_at) ? entry.listed_at : null,
      gecko_id: str(entry.gecko_id),
      symbol: str(entry.symbol),
    };
  });
  const watchlist = [...new Set(raw.watchlist as string[])];
  const missing = watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) throw new SnapshotError(`the watchlist names ${missing.length} slug(s) the protocols do not hold: ${missing.slice(0, 5).join(', ')}`);
  return { as_of: asOf, source: raw.source, floor_usd: floor, protocols, watchlist };
}

// ---------------------------------------------------------------- the three cuts of the universe

/**
 * Whether a protocol records a token. `gecko_id` or `symbol` present is a token record; so is a
 * positive market cap, because a market cap is a price times a supply and both belong to a token.
 * A protocol that fails this test records no token, which is not the same as having none: DefiLlama
 * can lag a launch, and the page says so where it counts these.
 */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || (p.mcap_usd !== null && p.mcap_usd > 0);
}

/** The version marker DefiLlama uses for a pool of another protocol: a name ending in V2, v2.1, 2.0. */
export const VERSION_MARKER = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;

/**
 * The categories DefiLlama uses for the machinery around an existing token — bridges, staking and
 * restaking receipts, centralised exchanges — as the snapshot's own watchlist rule lists them.
 */
const MACHINERY_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** The exchange names a wrapped product borrows, as the snapshot's own watchlist rule lists them. */
const EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/**
 * Whether a name is a venue's own pool or an exchange's treasury rather than a protocol waiting on
 * a token. Three signals, all from the record and none from a hand-written list of names:
 *
 *  1. the protocol's own category is one of the machinery categories (bridges, LSTs, restaked BTC,
 *     CEXes): DefiLlama's published designation of a product that holds or moves a token it did not
 *     issue;
 *  2. its name begins with an exchange's name, or its only chain is an exchange's own chain;
 *  3. its name contains the ticker of a token the snapshot already records, as a whole word, after
 *     the first word: "Binance staked ETH", "OKX xBTC", "Stacks sBTC". The first word is skipped so
 *     a protocol is not excluded for carrying its own name; only tickers of three to five characters
 *     are tested, since a longer one is an English word often enough to misfire.
 *
 * The page prints this rule and every protocol it moved, with the signal that moved it, in the
 * excluded section: nothing leaves the farm ranking without its reason on the page.
 */
export function venueSignal(p: Protocol, symbols: Set<string>, exchangeChains: Set<string>): string | null {
  if (p.category !== null && MACHINERY_CATEGORIES.has(p.category)) return `category ${p.category}`;
  const name = p.name.trim().toLowerCase();
  const exchange = EXCHANGES.find((e) => name === e || name.startsWith(`${e} `) || name.startsWith(`${e}-`) || name.startsWith(`${e}.`));
  if (exchange !== undefined) return `named for ${exchange}`;
  const chains = p.chains.map((c) => c.toLowerCase());
  if (chains.length === 1 && exchangeChains.has(chains[0]!)) return `only on ${p.chains[0]}, an exchange's chain`;
  const words = name.split(/[^a-z0-9]+/).filter((w) => w !== '').slice(1);
  for (const word of words) {
    if (word.length >= 3 && word.length <= 5 && words.length > 1 && symbols.has(word)) return `repeats the ticker ${word.toUpperCase()}`;
  }
  return null;
}

/** The tickers the snapshot's token-bearing protocols already record, lower-cased. */
export function recordedSymbols(protocols: Protocol[]): Set<string> {
  const out = new Set<string>();
  for (const p of protocols) if (p.symbol !== null) out.add(p.symbol.trim().toLowerCase());
  return out;
}

/** Chains that carry an exchange's name, which no protocol of its own is built on. */
export function exchangeChains(protocols: Protocol[]): Set<string> {
  const out = new Set<string>(['binance', 'okexchain', 'robinhood chain', 'coinbase chain']);
  for (const p of protocols) {
    for (const c of p.chains) {
      const low = c.toLowerCase();
      if (EXCHANGES.some((e) => low.startsWith(`${e} `))) out.add(low);
    }
  }
  return out;
}

/** A whole day count from `listed_at` to the snapshot's day, floored at zero; null when undated. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const then = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/**
 * The venues whose terms exclude US persons as a matter of public record, by the exchange name a
 * protocol's name begins with. This is stated as a check the reader must repeat, never as advice:
 * terms change, and the plan's first step says so.
 */
export const GATED_VENUES: ReadonlyMap<string, string> = new Map([
  ['binance', 'Binance'],
  ['bybit', 'Bybit'],
  ['bitget', 'Bitget'],
  ['okx', 'OKX'],
  ['bitfinex', 'Bitfinex'],
  ['mexc', 'MEXC'],
  ['htx', 'HTX'],
  ['kucoin', 'KuCoin'],
  ['gate', 'Gate'],
  ['bitstamp', 'Bitstamp'],
  ['poloniex', 'Poloniex'],
  ['deribit', 'Deribit'],
  ['phemex', 'Phemex'],
  ['weex', 'WEEX'],
]);

/** The venue whose published terms exclude US persons that a protocol's name points at, or null. */
export function geoblockedVenue(p: Protocol): string | null {
  const name = p.name.trim().toLowerCase();
  for (const [key, label] of GATED_VENUES) {
    if (name === key || name.startsWith(`${key} `) || name.startsWith(`${key}-`) || name.startsWith(`${key}.`)) return label;
  }
  return null;
}
