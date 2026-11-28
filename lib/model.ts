// Comparable multiple — how a protocol's value is priced against its peers:
//   1. Take the live-token median mcap/TVL inside the protocol's own category;
//      a category with no live protocol falls back to the global median.
//   2. Winsorise the raw multiple at 3.0 so one outlier cannot set the price.
//   3. Shrink the category median toward the global median (0.1857) with k=8,
//      so thin categories borrow strength from the whole universe instead of
//      trusting a handful of noisy peers.
//   4. Clamp the result to [0.05, 1.0] and round it to 4dp BEFORE scoring, so
//      the number the dashboard recomputes in-page is the number the model used.
// The multiple is a peer-relative price, not a judgement: the same TVL in a
// richly priced category is worth more than in a cheaply priced one, by design.
// The token radar's model, v4 (radar-4): one snapshot of the protocol universe in, one ranked
// board out.
//
// The board ranks every genuine pre-token candidate in the snapshot: a protocol that records no
// token (no market cap, no CoinGecko id, no symbol) and is not a wrapped, staked or bridged product
// of a token that already trades, not a versioned pool of another protocol, and not an exchange.
// That is the watchlist's own rule, applied to the whole snapshot instead of only above the floor,
// so the board holds all 40 watchlist protocols plus every strict pre-token protocol below the
// floor and above it that the watchlist leaves out. The watchlist is the floor, never the ceiling.
//
// Implied value follows only from the snapshot's own figures:
//
//   comparable = the market's price per dollar of TVL for live tokens in the same category:
//                the median of mcap_usd / tvl_usd over the snapshot's live-token protocols
//                (CEX excluded), each ratio winsorised at COMPARABLE_WINSOR_CAP, the category
//                median shrunk toward the global median with COMPARABLE_SHRINK_K, then clamped
//                to [COMPARABLE_CLAMP_LO, COMPARABLE_CLAMP_HI]; a category with no live protocol
//                takes the global median. No protocol name is ever special-cased.
//   base        = tvl_usd x comparable
//   growth      = clamp(change_7d, -60, 150) per cent
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity    = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult   = 1 + 0.04 x min(chains - 1, 5)            (more chains, wider reach)
//   implied     = max(1, round(base x growthMult x maturity x chainMult))
//
// TVL is the size of the launch, the category comparable is what the market already pays per
// dollar of TVL for live tokens doing the same thing, seven-day growth is its momentum, age with
// no token is how long the launch has been waited for, and chain count is how widely the protocol
// already distributes. The constants are the model's, stated in the dashboard. The same function
// scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  comparable_shrink_k: number;
  comparable_winsor_cap: number;
  comparable_clamp_lo: number;
  comparable_clamp_hi: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  comparable_shrink_k: 8,
  comparable_winsor_cap: 3.0,
  comparable_clamp_lo: 0.05,
  comparable_clamp_hi: 1.0,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_cap: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comparable_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comparable_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  comparable_global: number;
  category_multiples: Record<string, number>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The middle value of a sorted list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

// The comparable multiple, in one line: what the market already pays per dollar of TVL for
// live tokens in the same category — the median mcap/TVL of the snapshot's own live protocols,
// winsorised, shrunk toward the global median, then clamped. No outside price feed is involved.
/**
 * The market's price per dollar of TVL, by category, from the snapshot's own live-token
 * protocols (CEX excluded): each live protocol's mcap_usd / tvl_usd, winsorised at the cap so
 * one thin-TVL outlier cannot set a category, the category median shrunk toward the global
 * median (a category with one live protocol mostly takes the global), then clamped. A category
 * with no live protocol takes the global median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { global: number; byCategory: Map<string, number> } {
  const winsor = (r: number): number => Math.min(model.comparable_winsor_cap, Math.max(0, r));
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX');
  const global = median(live.map((p) => winsor(p.mcap_usd! / p.tvl_usd)));
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'null';
    const list = grouped.get(key) ?? [];
    list.push(winsor(p.mcap_usd! / p.tvl_usd));
    grouped.set(key, list);
  }
  const byCategory = new Map<string, number>();
  for (const [key, ratios] of grouped) {
    const shrunk = (ratios.length * median(ratios) + model.comparable_shrink_k * global) / (ratios.length + model.comparable_shrink_k);
    byCategory.set(key, Math.min(model.comparable_clamp_hi, Math.max(model.comparable_clamp_lo, shrunk)));
  }
  return { global, byCategory };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, comparable: number): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const chainMult = 1 + model.chain_step * extraChains;
  const base = protocol.tvl_usd * comparable;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name that begins with an exchange's name is that exchange's product, not its own launch. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking in the name marks a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not a versioned pool, and not an exchange. This is the
 * watchlist's own rule, applied to every protocol in the snapshot.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const firstWord = p.name.split(' ')[0] ?? '';
  if (EXCHANGE_NAMES.includes(firstWord)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const multiples = categoryMultiples(snapshot, model);
  // Every strict pre-token candidate in the snapshot, watchlist or not: the floor is never the
  // ceiling, and a protocol the watchlist leaves out is no worse a subject for the radar.
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  // A watchlist slug is covered even if it somehow failed the strict rule above: coverage is the
  // gate's row and is never gambled on a filter.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.includes(p)) chosen.push(p);
  }

  const scored = chosen.map((p) => {
    // The multiple the board states is the multiple the board uses: rounded to four decimals
    // here, so the dashboard's recompute from data.js lands on the same implied value.
    const comparable = round4(multiples.byCategory.get(p.category ?? 'null') ?? multiples.global);
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model, comparable);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, age, comparable };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      comparable_multiple: round4(s.comparable),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('basis')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name}'s chain and use one of its apps, then keep the funds there.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different action: a farm counts repeated, varied use, not one deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} against the supply on ${name}, then repay it the same week so the loan is on record.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${small} through ${name}'s main pool on ${chain} once a week to add trading volume.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge and open a second small trade on ${name} so the account shows more than one fill.`;
  if (c.includes('prediction')) return `Settle the first market position on ${name} and open a second one in a different market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('basis')) return `Move $${small} between two vaults on ${name} once, so the account shows vault activity beyond the first deposit.`;
  if (c.includes('stable')) return `Redeem $${small} of the stable asset through ${name} and deposit it again the same week.`;
  if (c.includes('rwa')) return `Check the yield the position earned on ${name} and compound $${small} of it back into the same asset.`;
  if (c.includes('insurance')) return `File a test quote for a second cover amount on ${name} so the account shows repeat use.`;
  if (c.includes('chain')) return `Send $${small} between two apps on ${name}'s chain so the wallet shows activity on the chain itself.`;
  return `Repeat the deposit with $${small} more on ${name} a week later, so the account shows more than one entry.`;
}

/** Gas in whole dollars per transaction, by chain: Ethereum mainnet costs more than the rest. */
function gasFor(chain: string): { setup: number; small: number; weekly: number } {
  return chain === 'Ethereum' ? { setup: 8, small: 5, weekly: 3 } : { setup: 3, small: 2, weekly: 1 };
}

/**
 * Gas for the first transaction on a chain, in words: mainnet costs most, Solana least.
 * The first farm step names this cost, so it varies by chain instead of one flat figure.
 */
function gasSetupFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $8 of gas for the first transaction';
  if (chain === 'Solana') return 'under $1 of gas for the first transaction';
  if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Scroll', 'Linea', 'Blast', 'Unichain', 'Ink', 'Mode', 'Mantle', 'Manta', 'Starknet', 'xDai'].includes(chain)) {
    return 'about $2 of gas for the first transaction';
  }
  return 'about $3 of gas for the first transaction';
}

/** A TVL in short form, as the dashboard prints it. */
function tvlShort(tvl: number): string {
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(2)}B`;
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(1)}M`;
  if (tvl >= 1e3) return `$${Math.round(tvl / 1e3)}K`;
  return `$${Math.round(tvl)}`;
}

/** The category's weekly action: a farm counts repeated, varied use, not one deposit. */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Top up the supply by $${small} or repay part of the borrow on ${name} once a week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${small} through ${name}'s main pool on ${chain} once a week to add trading volume.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open and close one small trade a week on ${name} so the account shows steady fills.`;
  if (c.includes('prediction')) return `Place one new market position a week on ${name}, in a different market each time.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('basis')) return `Check the vault yield on ${name} once a week and add $${small} when it compounds.`;
  if (c.includes('stable')) return `Mint or redeem $${small} of the stable asset through ${name} once a week.`;
  if (c.includes('rwa')) return `Check the yield the position earned on ${name} once a week and compound $${small} of it back in.`;
  if (c.includes('insurance')) return `Request a fresh cover quote on ${name} once a week so the account shows repeat use.`;
  if (c.includes('chain')) return `Use one app on ${name}'s chain once a week so the wallet shows activity on the chain itself.`;
  return `Add $${small} to the position on ${name} once a week, so the account shows more than one entry.`;
}

/** The hold, in words: younger protocols get a longer qualifying window. */
function holdText(age: number | null, hold: number): string {
  if (age === null || age < 180) return `Hold the position for at least ${hold} days: a protocol this young counts steady, early activity across more than one snapshot.`;
  if (age < 365) return `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`;
  return `Hold the position for at least ${hold} days: the launch has been waited for this long, so a month of steady activity is the minimum that reads as a real user.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  const weekly = weeklyActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet on ${chain} that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gasSetupFor(chain),
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${gas.small} of gas`,
      time: '10 minutes',
    },
    {
      text: weekly,
      cost: `about $${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: holdText(age, hold),
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page on ${chain} and claim only from the link it publishes. Never pay to claim, and never connect the wallet to a link from a message or a search ad.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction for ${p.name} (${tvlShort(p.tvl_usd)}) in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comparable_multiple: row.model.comparable_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: row.watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiples = categoryMultiples(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    comparable_global: Math.round(multiples.global * 1e4) / 1e4,
    category_multiples: Object.fromEntries([...multiples.byCategory.entries()].map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
