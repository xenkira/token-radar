// Token Radar — original entry for make.fun token-radar-01.
// Node 22, standard library only, no network at runtime.
// Reads the sealed snapshot, scores every eligible pre-token protocol
// with the model below, writes board.json + data.js, copies dashboard/
// and screenshots/ to the output dir, and writes dossier.json with the
// vendored make.fun library (vendor/makefun-board.ts).
//
// Usage: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
//
// Value model (same function scores every protocol; no name is special-cased):
//   size    = (tvl_usd / 1e6) ^ 0.55            -- log-ish scale: TVL matters, but
//                                                a 10x TVL gap is worth ~3.5x value, not 10x
//   growth  = 1 + clamp(change_7d, -50, 100) / 100 * 0.6   -- 0.70 .. 1.60
//   age     = days from listed_at to as_of (unknown: 365)
//   maturity= 0.75 + min(age, 1460) / 1460 * 0.50          -- 0.75 .. 1.25; longer
//                                                running with no token recorded = higher
//   reach   = 1 + 0.02 * min(chains - 1, 10)              -- 1.00 .. 1.20
//   implied = round(5_000_000 * size * growth * maturity * reach / 1000) * 1000
// Eligibility: records no token (gecko_id, symbol and mcap_usd all null), and
// is not a wrapped / staked / bridged product, not a CEX, bridge or liquid-
// staking product, and not a versioned (V2/2.0) or exchange-branded name.
// Token-bearing protocols are never ranked; they are counted and listed
// separately in data.js as the live market, for reference only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Breakdown {
  size_factor: number;
  growth_factor: number;
  maturity_factor: number;
  reach_factor: number;
  age_days: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  breakdown: Breakdown;
}

const EXCLUDED_CATEGORIES = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC',
]);
const EXCHANGE_FIRST_WORDS = new Set([
  'Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini',
]);

function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

/** A pre-token protocol whose record could plausibly precede a token launch. */
export function isEligible(p: SnapshotProtocol): boolean {
  if (hasToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(v2|v3|2\.0|3\.0)$/i.test(p.name)) return false;
  const first = p.name.split(/\s+/)[0] ?? '';
  if (EXCHANGE_FIRST_WORDS.has(first)) return false;
  return true;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function ageDays(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 365;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return 365;
  return Math.floor(ms / 86_400_000);
}

export function score(p: SnapshotProtocol, asOf: string): { value: number; breakdown: Breakdown } {
  const age = ageDays(p.listed_at, asOf);
  const sizeFactor = Math.pow(Math.max(p.tvl_usd, 1) / 1_000_000, 0.55);
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -50, 100);
  const growthFactor = 1 + (growth / 100) * 0.6;
  const maturityFactor = 0.75 + (Math.min(age, 1460) / 1460) * 0.5;
  const reachFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  const raw = 5_000_000 * sizeFactor * growthFactor * maturityFactor * reachFactor;
  const value = Math.max(1_000, Math.round(raw / 1_000) * 1_000);
  return {
    value,
    breakdown: {
      size_factor: round3(sizeFactor),
      growth_factor: round3(growthFactor),
      maturity_factor: round3(maturityFactor),
      reach_factor: round3(reachFactor),
      age_days: age,
    },
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1_000)}K`;
}

function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'budget $5–$30 per transaction on Ethereum mainnet and transact outside peak hours';
  if (chain === 'Solana') return 'fees are under $0.01 per transaction on Solana, so splitting into several small steps costs almost nothing';
  if (chain === 'Tron') return 'budget a few TRX for energy/bandwidth on Tron, or rent energy for about $1–$3 per session';
  if (chain === 'Bitcoin') return 'on-chain Bitcoin fees run $1–$10 per transaction depending on congestion, so batch your moves';
  return `fees on ${chain} are typically $0.05–$0.50 per transaction, so a full setup costs under $2 in gas`;
}

/** The category-specific core action: what "using" this protocol actually means. */
function coreAction(p: SnapshotProtocol): { verb: string; detail: string } {
  const cat = p.category ?? '';
  switch (cat) {
    case 'Dexs':
      return {
        verb: 'swap and provide liquidity',
        detail: `swap $100–$500 of a major asset into another asset on ${p.name}, then add $100–$500 to a liquid pair pool and keep the LP position open for at least 2–4 weeks so the position accrues volume and fees`,
      };
    case 'Lending':
      return {
        verb: 'supply and borrow',
        detail: `supply $200–$1,000 of collateral to ${p.name}, then borrow a small amount (under 40% of the collateral value) against it and repay it after 2–3 weeks, keeping the health factor above 1.5 the whole time`,
      };
    case 'Yield':
    case 'Yield Aggregator':
    case 'Liquidity Manager':
    case 'Farm':
    case 'Leveraged Farming':
      return {
        verb: 'deposit into a yield vault',
        detail: `deposit $200–$1,000 into a ${p.name} vault or farm, leave it compounding for 3–4 weeks, and harvest or re-deposit the yield at least once a week so the position shows repeated activity`,
      };
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return {
        verb: 'deposit into a curated vault',
        detail: `deposit $200–$1,000 into a curated vault on ${p.name}, choose a vault whose strategy you understand, and hold the position for at least a month, topping it up once mid-way if the vault stays open`,
      };
    case 'RWA':
      return {
        verb: 'take a tokenised real-world position',
        detail: `open a $200–$1,000 position in a tokenised asset on ${p.name}, complete any eligibility check the product requires, and hold the position for at least 30 days`,
      };
    case 'CDP':
    case 'CDP Manager':
    case 'Dual-Token Stablecoin':
      return {
        verb: 'open a collateralised vault',
        detail: `open a vault on ${p.name} with $300–$1,000 of collateral, mint stablecoins worth under 50% of the collateral, and keep the vault above its liquidation ratio for at least 3 weeks`,
      };
    case 'Derivatives':
    case 'Basis Trading':
    case 'Interest Rate Derivatives':
    case 'Options Vault':
      return {
        verb: 'open a small hedged position',
        detail: `open a $100–$300 hedged position on ${p.name} with a defined stop-loss, close it after 1–2 weeks, and repeat once with a different market so the account shows more than a single trade`,
      };
    case 'Prediction Market':
      return {
        verb: 'take prediction positions',
        detail: `place $20–$100 of prediction positions across at least 3 different markets on ${p.name} over 2 weeks, and let at least one resolve before adding more`,
      };
    default:
      return {
        verb: 'use the product regularly',
        detail: `use ${p.name} as an active user: complete its core action with $100–$500, repeat it at least twice over 2–3 weeks, and keep the position or account active for a full month`,
      };
  }
}

export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const chainList = p.chains.slice(0, 4).join(', ');
  const core = coreAction(p);
  const cat = p.category ?? 'DeFi';
  const steps = [
    `Set up a fresh wallet for ${p.name} farming, fund it with $300–$1,000 in a major asset on ${chain}, and ${gasNote(chain)}; allow about 30 minutes for the first setup.`,
    `Open the official ${p.name} app on ${chain} and verify the URL and contract addresses from its docs before connecting; never connect through a link from social media.`,
    `To ${core.verb}: ${core.detail}. This is the step most likely to count, so do it with real funds, not a dust amount.`,
    `Return weekly for 4 weeks: repeat the core action or add $50–$200 to the position, check the ${cat} position on ${chainList} each time, and keep a note of dates, amounts and transaction hashes.`,
    `Use a second chain where ${p.name} runs (${chainList}) for one smaller $50–$150 position, so the activity is not confined to a single chain; this takes about 15–20 minutes plus gas.`,
    `Wind down carefully at the end of the month: close or reduce positions gradually over 2–3 days, keep at least one small active position if the protocol is still live, and export your full transaction history as your record.`,
  ];
  for (const s of steps) {
    if (s.trim().length < 20 || s.trim().length > 600) throw new Error(`farm step length out of range for ${p.slug}`);
  }
  return steps;
}

export function buildBoard(snapshot: Snapshot): { rows: RadarRow[]; liveCount: number; liveTop: { slug: string; name: string; mcap_usd: number }[] } {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isEligible)
    .map((p) => ({ p, ...score(p, snapshot.as_of) }));
  const bySlug = new Map(scored.map((s) => [s.p.slug, s]));
  const picked: typeof scored = [];
  for (const slug of snapshot.watchlist) {
    const s = bySlug.get(slug);
    if (s) picked.push(s);
  }
  const rest = scored
    .filter((s) => !watch.has(s.p.slug))
    .sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  for (const s of rest) {
    if (picked.length >= 200) break;
    picked.push(s);
  }
  picked.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: RadarRow[] = picked.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.value,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    watchlist: watch.has(s.p.slug),
    breakdown: s.breakdown,
  }));
  const live = snapshot.protocols
    .filter(hasToken)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
  return {
    rows,
    liveCount: live.length,
    liveTop: live.slice(0, 5).map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd ?? 0 })),
  };
}

/** Self-check the board against the gate's shape; returns the first problem or null. */
export function boardIssue(rows: RadarRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows`;
  const slugs = new Set<string>();
  for (const r of rows) {
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `invented slug ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug}: farm step of ${t.length} chars`;
    }
  }
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `watchlist slug missing: ${slug}`;
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.rank !== i + 1) return `ranks are not 1..N at position ${i}`;
    if (i > 0 && sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  }
  if (rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) return 'all implied values equal';
  return null;
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function main(): void {
  const inputArg = arg('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
  const { rows, liveCount, liveTop } = buildBoard(snapshot);
  const issue = boardIssue(rows, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  const boardRows: BoardRow[] = rows.map((r) => ({
    slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps,
  }));
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);
  const data = {
    meta: {
      title: 'Token Radar — pre-token protocols ranked by implied value',
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      rows: rows.length,
      watchlist_rows: rows.filter((r) => r.watchlist).length,
      live_token_protocols_set_aside: liveCount,
      live_top_by_mcap: liveTop,
      model:
        'implied = round(5,000,000 * (tvl_usd/1e6)^0.55 * growth * maturity * reach / 1000) * 1000; ' +
        'growth = 1 + clamp(change_7d, -50, 100)/100 * 0.6; maturity = 0.75 + min(age_days, 1460)/1460 * 0.50 ' +
        '(age from listed_at to as_of, unknown = 365 days); reach = 1 + 0.02 * min(chains-1, 10). ' +
        'Board holds pre-token protocols only; protocols that already record a token are counted above and never ranked. ' +
        'Implied value is this entry\'s own claim from the snapshot figures, not a prediction that a token will launch.',
    },
    rows,
  };
  writeFileSync(join(out, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(data)};\n`);

  const copyFiles = (from: string, to: string): string[] => {
    if (!existsSync(from)) return [];
    mkdirSync(to, { recursive: true });
    const copied: string[] = [];
    for (const name of readdirSync(from)) {
      if (name.startsWith('.')) continue;
      const path = join(from, name);
      if (!statSync(path).isFile()) continue;
      copyFileSync(path, join(to, name));
      copied.push(name);
    }
    return copied;
  };
  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows scored\n` +
      `token radar: top ${rows[0]!.name} ${fmtUsd(rows[0]!.implied_value_usd)}, wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard, screenshots (${shots.length}) and dossier.json\n`,
  );
}

main();
