import { afterEach, describe, expect, it } from "bun:test";
import {
  ALCHEMY_TESTNET_LOG_CHUNK_BLOCKS,
  ALCHEMY_TESTNET_LOG_CONCURRENCY,
  LOG_CHUNK_BLOCKS,
  LOG_CONCURRENCY,
  TESTNET_LOG_CHUNK_BLOCKS,
  TESTNET_LOG_CONCURRENCY,
  logChunkBlocks,
  logConcurrency,
  liveLogRanges,
  scanRecentOpenings,
  type Opening,
} from "./live";

const ENV_KEY = "ALCHEMY_MONAD_TESTNET_RPC";
const savedEnv = process.env[ENV_KEY];

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

const opening = (perpId: bigint, accountId: bigint, blockNumber: bigint): Opening => ({
  perpId,
  accountId,
  blockNumber,
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const setAlchemy = (v: string | undefined): void => {
  if (v === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = v;
};

describe("alchemy testnet chunk/concurrency selection", () => {
  it("keeps public testnet behavior at 100 blocks serial when unset", () => {
    setAlchemy(undefined);
    expect(TESTNET_LOG_CHUNK_BLOCKS).toBe(100);
    expect(TESTNET_LOG_CONCURRENCY).toBe(1);
    expect(logChunkBlocks("testnet")).toBe(100);
    expect(logConcurrency("testnet")).toBe(1);
  });

  it("treats empty or blank rpc as public testnet", () => {
    setAlchemy("");
    expect(logChunkBlocks("testnet")).toBe(100);
    expect(logConcurrency("testnet")).toBe(1);
    setAlchemy("   ");
    expect(logChunkBlocks("testnet")).toBe(100);
    expect(logConcurrency("testnet")).toBe(1);
  });

  it("uses 10-block ranges with concurrency 10 when configured", () => {
    setAlchemy("https://example.invalid/alchemy");
    expect(ALCHEMY_TESTNET_LOG_CHUNK_BLOCKS).toBe(10);
    expect(ALCHEMY_TESTNET_LOG_CONCURRENCY).toBe(10);
    expect(logChunkBlocks("testnet")).toBe(10);
    expect(logConcurrency("testnet")).toBe(10);
    const ranges = liveLogRanges("testnet", 100n, 135n);
    expect(ranges).toEqual([
      { fromBlock: 100n, toBlock: 109n },
      { fromBlock: 110n, toBlock: 119n },
      { fromBlock: 120n, toBlock: 129n },
      { fromBlock: 130n, toBlock: 135n },
    ]);
    expect(ranges.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 10n)).toBe(true);
  });

  it("leaves mainnet at 1000 blocks concurrency 4 either way", () => {
    setAlchemy(undefined);
    expect(logChunkBlocks("mainnet")).toBe(LOG_CHUNK_BLOCKS);
    expect(logConcurrency("mainnet")).toBe(LOG_CONCURRENCY);
    expect(LOG_CHUNK_BLOCKS).toBe(1000);
    expect(LOG_CONCURRENCY).toBe(4);
    setAlchemy("https://example.invalid/alchemy");
    expect(logChunkBlocks("mainnet")).toBe(1000);
    expect(logConcurrency("mainnet")).toBe(4);
  });

  it("keeps actual public testnet ranges at 100 blocks when Alchemy is unset", () => {
    setAlchemy(undefined);
    const ranges = liveLogRanges("testnet", 100n, 350n);
    expect(ranges).toEqual([
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 299n },
      { fromBlock: 300n, toBlock: 350n },
    ]);
  });
});

describe("scanRecentOpenings concurrency bound", () => {
  it("never exceeds the selected alchemy bound of 10 in flight", async () => {
    setAlchemy("https://example.invalid/alchemy");
    const bound = logConcurrency("testnet");
    expect(bound).toBe(10);

    const ranges = Array.from({ length: 25 }, (_, i) => ({
      fromBlock: BigInt(i * 10),
      toBlock: BigInt(i * 10 + 9),
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const fetched: bigint[] = [];
    await scanRecentOpenings(
      ranges,
      1n,
      async (range) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(10);
        fetched.push(range.toBlock);
        inFlight -= 1;
        return [];
      },
      1000,
      bound,
    );
    expect(fetched).toHaveLength(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("respects a small bound of 2 in flight", async () => {
    setAlchemy(undefined);
    const ranges = Array.from({ length: 6 }, (_, i) => ({
      fromBlock: BigInt(i * 100),
      toBlock: BigInt(i * 100 + 99),
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    await scanRecentOpenings(
      ranges,
      1n,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(15);
        inFlight -= 1;
        return [];
      },
      1000,
      2,
    );
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("scanRecentOpenings newest-first under out-of-order completion", () => {
  it("prefers the newest batch entry even when it resolves last", async () => {
    const ranges = [
      { fromBlock: 0n, toBlock: 9n },
      { fromBlock: 10n, toBlock: 19n },
      { fromBlock: 20n, toBlock: 29n },
      { fromBlock: 30n, toBlock: 39n },
    ];
    const started: bigint[] = [];
    const out = await scanRecentOpenings(
      ranges,
      1n,
      async (range) => {
        started.push(range.toBlock);
        if (range.toBlock === 39n) {
          await sleep(40);
          return [opening(1n, 7n, 35n)];
        }
        if (range.toBlock === 29n) {
          await sleep(5);
          return [opening(1n, 8n, 25n)];
        }
        return [];
      },
      1,
      2,
    );
    expect(started[0]).toBe(39n);
    expect(started[1]).toBe(29n);
    expect(out).toEqual([opening(1n, 7n, 35n)]);
  });

  it("keeps newest-first results with dedup when older pages finish first", async () => {
    const ranges = [
      { fromBlock: 0n, toBlock: 9n },
      { fromBlock: 10n, toBlock: 19n },
      { fromBlock: 20n, toBlock: 29n },
      { fromBlock: 30n, toBlock: 39n },
    ];
    const out = await scanRecentOpenings(
      ranges,
      1n,
      async (range) => {
        if (range.toBlock === 39n) {
          await sleep(40);
          return [opening(1n, 7n, 35n)];
        }
        if (range.toBlock === 29n) {
          await sleep(5);
          return [opening(1n, 8n, 25n)];
        }
        if (range.toBlock === 19n) {
          await sleep(1);
          return [opening(1n, 7n, 15n)];
        }
        return [];
      },
      10,
      4,
    );
    expect(out).toEqual([opening(1n, 7n, 35n), opening(1n, 8n, 25n)]);
  });
});
