/// Live view: the most recent Perpl perp openers, so faces sit on current
/// candles instead of pinned to the chart edge.
///
/// The default room (lib/room.json) is a frozen list whose entries are weeks
/// old, so every face falls outside the visible candles. This module reads
/// fresh PositionOpened logs from the Exchange contract over the last `hours`
/// (Monad makes about 12,000 blocks per hour at 0.3 s), keeps the most recent
/// opening per account, resolves each accountId to its address, and reads the
/// CURRENT open position, skipping accounts that already closed.
///
/// Server only: it uses the per-network server client (mainnet goes through
/// MONAD_RPC_URL, a QuickNode endpoint that allows 1,000-block eth_getLogs),
/// so log reads page in 1,000-block chunks with concurrency 4 and retry on 429.
import { type Abi, type AbiEvent, type Address } from "viem";
import officialAbiJson from "./exchange-official.abi.json";
import { blockTime, clientFor } from "./server";
import { NETWORKS, type Network } from "./perpl";
import { readPosition } from "./readPosition";

const officialAbi = officialAbiJson as Abi;

/// The two open-position event fragments from the official ABI, so log reads
/// filter and decode against the same ABI file.
function eventFragment(name: "PositionOpened" | "PositionOpenedV2"): AbiEvent {
  const frag = (officialAbi as Abi).find((e) => e.type === "event" && (e as { name?: string }).name === name);
  if (!frag || frag.type !== "event") throw new Error(`event ${name} missing from the official ABI`);
  return frag as AbiEvent;
}

const OPENED_EVENTS: AbiEvent[] = [eventFragment("PositionOpened"), eventFragment("PositionOpenedV2")];

export const LIVE_MAX_TRADERS = 12;
export const LIVE_DEFAULT_HOURS = 6;
export const LIVE_MIN_HOURS = 1;
export const LIVE_MAX_HOURS = 24;
export const LIVE_CACHE_MS = 60_000;
export const LOG_CHUNK_BLOCKS = 1000;
export const TESTNET_LOG_CHUNK_BLOCKS = 100;
export const LOG_CONCURRENCY = 4;
export const TESTNET_LOG_CONCURRENCY = 1;
/// Monad targets 0.3 s blocks: about 12,000 blocks per hour.
export const BLOCKS_PER_HOUR = 12_000;
/// Bound the accountId -> position fan-out: resolve the most recent openings
/// first and stop once the trader list is full.
const MAX_RESOLVE_CANDIDATES = 40;

export function logChunkBlocks(network: Network): number {
  return network === "testnet" ? TESTNET_LOG_CHUNK_BLOCKS : LOG_CHUNK_BLOCKS;
}

export function logConcurrency(network: Network): number {
  return network === "testnet" ? TESTNET_LOG_CONCURRENCY : LOG_CONCURRENCY;
}

export type LiveTrader = {
  account: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  fundingPnl: number;
  entryBlock: string;
  entryTime: number | null;
};

/// Clamp the requested window to 1..24 hours, defaulting to 6 for anything
/// missing or unparseable. The route clamps rather than rejecting so a stale
/// link still renders.
export function clampHours(raw: unknown): number {
  const text = typeof raw === "string" ? raw.trim() : null;
  const n = text !== null ? (text === "" ? NaN : Number(text)) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return LIVE_DEFAULT_HOURS;
  return Math.min(LIVE_MAX_HOURS, Math.max(LIVE_MIN_HOURS, Math.floor(n)));
}

/// How many blocks `hours` covers at Monad speed. Pure so the route and the
/// fetcher agree on the window.
export function blocksForHours(hours: number): bigint {
  return BigInt(clampHours(hours)) * BigInt(BLOCKS_PER_HOUR);
}

export type Opening = { perpId: bigint; accountId: bigint; blockNumber: bigint };

/// Keep only openings for the requested market. QuickNode caps ranges, not
/// filters, and the event leaves perpId unindexed, so this runs client-side.
export function filterOpeningsByPerp(openings: Opening[], perpId: bigint): Opening[] {
  return openings.filter((o) => o.perpId === perpId);
}

/// One row per account: the most recent opening wins, so a trader who
/// re-entered sits on the candles at their latest entry, not their first.
export function latestPerAccount(openings: Opening[]): Opening[] {
  const best = new Map<string, Opening>();
  for (const o of openings) {
    const k = o.accountId.toString();
    const cur = best.get(k);
    if (!cur || o.blockNumber > cur.blockNumber) best.set(k, o);
  }
  return [...best.values()];
}

export type BlockRange = { fromBlock: bigint; toBlock: bigint };

/// Split an inclusive block range into chunks of at most `size` blocks, so no
/// single eth_getLogs call exceeds the provider's 1,000-block cap.
export function chunkRanges(from: bigint, to: bigint, size: number = LOG_CHUNK_BLOCKS): BlockRange[] {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`bad chunk size ${String(size)}`);
  if (to < from) return [];
  const out: BlockRange[] = [];
  let start = from;
  while (start <= to) {
    const end = start + BigInt(size) - 1n <= to ? start + BigInt(size) - 1n : to;
    out.push({ fromBlock: start, toBlock: end });
    start = end + 1n;
  }
  return out;
}

export type LiveCandidatePosition = {
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  fundingPnl: number;
} | null;

export type LiveCandidate = {
  account: string;
  entryBlock: bigint;
  entryTime: number | null;
  /// Null when the account already closed the position: dropped below.
  position: LiveCandidatePosition;
};

function cmpBlock(a: bigint, b: bigint): number {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

/// Pure assembly, no network: drop closed positions, sort most recent entry
/// first, cap at 12. The fetcher resolves candidates in recency order, so the
/// cap keeps the freshest traders.
export function assembleLiveTraders(cands: LiveCandidate[], max: number = LIVE_MAX_TRADERS): LiveTrader[] {
  return cands
    .filter((c) => c.position !== null)
    .sort((a, b) => cmpBlock(a.entryBlock, b.entryBlock))
    .slice(0, max)
    .map((c) => {
      const p = c.position as Exclude<LiveCandidatePosition, null>;
      return {
        account: c.account,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unrealizedPnl: p.unrealizedPnl,
        fundingPnl: p.fundingPnl,
        entryBlock: c.entryBlock.toString(),
        entryTime: c.entryTime,
      };
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/// Retry provider rate limits with exponential backoff. Anything that is not
/// a 429 throws immediately so real failures surface fast.
async function withRetry<T>(fn: () => Promise<T>, attempts: number = 4): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : e);
      const limited = /429|too many requests|rate limit|rate_limit|requests limited/i.test(msg);
      if (!limited || i === attempts - 1) throw e;
      await sleep(500 * 2 ** i);
    }
  }
  throw last;
}

async function mapPool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

type CacheEntry = { at: number; payload: { block: string; hours: number; traders: LiveTrader[] } };
const cache = new Map<string, CacheEntry>();

export function clearLiveCache(): void {
  cache.clear();
}

/// Recent openers in one market on one network, most recent entry first, up
/// to 12. Results are cached per network, market and window for 60 s in
/// memory.
export async function getLiveTraders(
  market: number,
  hoursRaw: unknown,
  network: Network = "testnet",
): Promise<{ block: string; hours: number; traders: LiveTrader[] }> {
  const hours = clampHours(hoursRaw);
  const key = `${network}:${market}:${hours}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < LIVE_CACHE_MS) return hit.payload;

  const client = clientFor(network);
  const exchange = NETWORKS[network].exchange;

  const latest = await withRetry(() => client.getBlockNumber());
  const span = blocksForHours(hours);
  const from = latest > span ? latest - span : 0n;
  const ranges = chunkRanges(from, latest, logChunkBlocks(network));

  const perChunk = await mapPool(ranges, logConcurrency(network), ({ fromBlock, toBlock }) =>
    withRetry(() => client.getLogs({ address: exchange, events: OPENED_EVENTS, fromBlock, toBlock })),
  );
  const want = BigInt(market);
  const openings: Opening[] = [];
  for (const log of perChunk.flat()) {
    const args = log.args as { perpId?: unknown; accountId?: unknown } | undefined;
    if (typeof args?.perpId !== "bigint" || typeof args?.accountId !== "bigint") continue;
    if (args.perpId !== want) continue;
    openings.push({ perpId: args.perpId, accountId: args.accountId, blockNumber: log.blockNumber });
  }

  const recent = latestPerAccount(openings)
    .sort((a, b) => cmpBlock(a.blockNumber, b.blockNumber))
    .slice(0, MAX_RESOLVE_CANDIDATES);
  const cands = await mapPool(recent, LOG_CONCURRENCY, async (o): Promise<LiveCandidate | null> => {
    try {
      const info = (await withRetry(() =>
        client.readContract({ address: exchange, abi: officialAbi, functionName: "getAccountById", args: [o.accountId] }),
      )) as unknown as { accountAddr?: Address };
      const addr = info?.accountAddr;
      if (!addr || /^0x0{40}$/i.test(addr)) return null;
      const p = await readPosition(addr, market, { network, client, blockNumber: latest });
      const entryTime = await blockTime(network, o.blockNumber);
      if (!p) return { account: addr, entryBlock: o.blockNumber, entryTime, position: null };
      return {
        account: p.account,
        entryBlock: o.blockNumber,
        entryTime,
        position: {
          side: p.side,
          size: p.size,
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          unrealizedPnl: p.unrealizedPnl,
          fundingPnl: p.fundingPnl,
        },
      };
    } catch {
      return null;
    }
  });

  const payload = {
    block: latest.toString(),
    hours,
    traders: assembleLiveTraders(cands.filter((c): c is LiveCandidate => c !== null)),
  };
  cache.set(key, { at: now, payload });
  return payload;
}
