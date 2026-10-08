import { describe, expect, it } from "bun:test";
import {
  BLOCKS_PER_HOUR,
  LIVE_DEFAULT_HOURS,
  LIVE_MAX_HOURS,
  LIVE_MAX_TRADERS,
  LIVE_MIN_HOURS,
  LOG_CHUNK_BLOCKS,
  LOG_CONCURRENCY,
  TESTNET_LOG_CHUNK_BLOCKS,
  TESTNET_LOG_CONCURRENCY,
  assembleLiveTraders,
  blocksForHours,
  chunkRanges,
  clampHours,
  filterOpeningsByPerp,
  latestPerAccount,
  logChunkBlocks,
  logConcurrency,
  type LiveCandidate,
  type Opening,
} from "./live";

const opening = (perpId: bigint, accountId: bigint, blockNumber: bigint): Opening => ({
  perpId,
  accountId,
  blockNumber,
});

const live = (account: string, entryBlock: bigint, open = true): LiveCandidate => ({
  account,
  entryBlock,
  entryTime: Number(entryBlock) * 2,
  position: open
    ? { side: "long", size: 1, entryPrice: 100, markPrice: 110, unrealizedPnl: 10, fundingPnl: 0 }
    : null,
});

describe("clampHours", () => {
  it("defaults to 6 hours when nothing usable arrives", () => {
    expect(clampHours(undefined)).toBe(LIVE_DEFAULT_HOURS);
    expect(clampHours(null)).toBe(LIVE_DEFAULT_HOURS);
    expect(clampHours("")).toBe(LIVE_DEFAULT_HOURS);
    expect(clampHours("soon")).toBe(LIVE_DEFAULT_HOURS);
    expect(clampHours(NaN)).toBe(LIVE_DEFAULT_HOURS);
    expect(LIVE_DEFAULT_HOURS).toBe(6);
  });
  it("clamps the window to 1..24 hours", () => {
    expect(clampHours(0)).toBe(LIVE_MIN_HOURS);
    expect(clampHours(-3)).toBe(LIVE_MIN_HOURS);
    expect(clampHours(1)).toBe(1);
    expect(clampHours(24)).toBe(24);
    expect(clampHours(100)).toBe(LIVE_MAX_HOURS);
    expect(clampHours("48")).toBe(LIVE_MAX_HOURS);
    expect(LIVE_MIN_HOURS).toBe(1);
    expect(LIVE_MAX_HOURS).toBe(24);
  });
  it("floors fractional hours and reads numeric strings", () => {
    expect(clampHours(2.9)).toBe(2);
    expect(clampHours("6")).toBe(6);
  });
});

describe("blocksForHours", () => {
  it("covers about 12,000 Monad blocks per hour", () => {
    expect(BLOCKS_PER_HOUR).toBe(12_000);
    expect(blocksForHours(6)).toBe(72_000n);
    expect(blocksForHours(100)).toBe(24n * 12_000n);
  });
});

describe("filterOpeningsByPerp", () => {
  it("keeps only logs for the requested perpId", () => {
    const logs = [opening(1n, 7n, 10n), opening(10n, 8n, 11n), opening(1n, 9n, 12n)];
    const kept = filterOpeningsByPerp(logs, 1n);
    expect(kept.map((o) => o.accountId)).toEqual([7n, 9n]);
  });
  it("keeps nothing when the market has no openings", () => {
    expect(filterOpeningsByPerp([opening(10n, 8n, 11n)], 1n)).toEqual([]);
  });
});

describe("latestPerAccount", () => {
  it("keeps the most recent opening per account", () => {
    const rows = latestPerAccount([opening(1n, 7n, 10n), opening(1n, 7n, 30n), opening(1n, 8n, 20n)]);
    expect(rows).toHaveLength(2);
    expect(rows.find((o) => o.accountId === 7n)?.blockNumber).toBe(30n);
    expect(rows.find((o) => o.accountId === 8n)?.blockNumber).toBe(20n);
  });
});

describe("chunkRanges", () => {
  it("pages a 6-hour window in 1,000-block chunks", () => {
    const ranges = chunkRanges(0n, 72_000n - 1n);
    expect(ranges).toHaveLength(72);
    for (const r of ranges) expect(r.toBlock - r.fromBlock).toBe(999n);
    expect(ranges[0]?.fromBlock).toBe(0n);
    expect(ranges[71]?.toBlock).toBe(71_999n);
  });
  it("caps the last chunk at the tip", () => {
    expect(chunkRanges(0n, 2500n)).toEqual([
      { fromBlock: 0n, toBlock: 999n },
      { fromBlock: 1000n, toBlock: 1999n },
      { fromBlock: 2000n, toBlock: 2500n },
    ]);
  });
  it("returns no ranges when the tip moved backwards", () => {
    expect(chunkRanges(10n, 5n)).toEqual([]);
  });
});

describe("logChunkBlocks", () => {
  it("uses the testnet provider's 100-block limit", () => {
    expect(logChunkBlocks("testnet")).toBe(100);
    expect(TESTNET_LOG_CHUNK_BLOCKS).toBe(100);
    expect(logChunkBlocks("mainnet")).toBe(LOG_CHUNK_BLOCKS);
  });
});

describe("logConcurrency", () => {
  it("caps public testnet reads at eight concurrent 100-block pages", () => {
    expect(logChunkBlocks("testnet")).toBe(100);
    expect(logConcurrency("testnet")).toBe(TESTNET_LOG_CONCURRENCY);
    expect(TESTNET_LOG_CONCURRENCY).toBe(8);
    expect(logConcurrency("mainnet")).toBe(LOG_CONCURRENCY);
  });
});

describe("assembleLiveTraders", () => {
  it("sorts most recent entry first", () => {
    const out = assembleLiveTraders([live("0xaaa", 10n), live("0xbbb", 30n), live("0xccc", 20n)]);
    expect(out.map((t) => t.account)).toEqual(["0xbbb", "0xccc", "0xaaa"]);
  });
  it("caps the rail at 12 traders, keeping the freshest", () => {
    const cands = Array.from({ length: 15 }, (_, i) => live(`0x${String(i).padStart(4, "0")}`, BigInt(i)));
    const out = assembleLiveTraders(cands);
    expect(LIVE_MAX_TRADERS).toBe(12);
    expect(out).toHaveLength(12);
    expect(out[0]?.entryBlock).toBe("14");
    expect(out[11]?.entryBlock).toBe("3");
  });
  it("skips accounts that already closed", () => {
    const out = assembleLiveTraders([live("0xaaa", 10n, false), live("0xbbb", 30n, true)]);
    expect(out.map((t) => t.account)).toEqual(["0xbbb"]);
  });
  it("returns nothing open when every candidate closed", () => {
    expect(assembleLiveTraders([live("0xaaa", 10n, false)])).toEqual([]);
  });
  it("serializes the entry block as a string for JSON", () => {
    const out = assembleLiveTraders([live("0xaaa", 10n)]);
    expect(out[0]?.entryBlock).toBe("10");
    expect(out[0]?.entryTime).toBe(20);
  });
});
