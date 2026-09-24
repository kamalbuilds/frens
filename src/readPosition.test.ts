import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { exchangeAbi, NETWORKS, publicClient } from "./perpl";
import { decodePosition, effectiveEntryPrice, expectedDeltaPnl, readPerpMeta, readPosition, type RawPosition } from "./readPosition";

const close = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("effectiveEntryPrice (dex-sdk test vectors, 4 price decimals)", () => {
  test("long", () => {
    close(effectiveEntryPrice(0, 1n, 0n, 4n), 0.0001);
    close(effectiveEntryPrice(0, 1n, 1n, 4n), 0.00000000152587890625);
    close(effectiveEntryPrice(0, 10001n, 8n, 4n), 1.00000001220703125);
    close(effectiveEntryPrice(0, 10000n, 65535n, 4n), 0.9999999984741210937);
  });
  test("short", () => {
    close(effectiveEntryPrice(1, 1n, 0n, 4n), 0.0001);
    close(effectiveEntryPrice(1, 0n, 1n, 4n), 0.00000000152587890625);
    close(effectiveEntryPrice(1, 10000n, 8n, 4n), 1.00000001220703125);
    close(effectiveEntryPrice(1, 9999n, 65535n, 4n), 0.9999999984741210937);
  });
});

describe("decodePosition", () => {
  const meta = { symbol: "BTC", priceDecimals: 1n, lotDecimals: 5n };
  const ctx = { account: "0x0000000000000000000000000000000000000001" as Address, market: 1, block: 1n };
  const raw: RawPosition = {
    accountId: 7n, positionType: 1, depositCNS: 50_000_000n, pricePNS: 700_000n, lotLNS: 200n,
    entryBlock: 5n, pnlCNS: 0n, deltaPnlCNS: -2_000_000n, premiumPnlCNS: 250_000n, priceResiduePNSQ16: 0n,
  };
  test("scales a short position", () => {
    const p = decodePosition(raw, 710_000n, true, meta, ctx)!;
    expect(p.side).toBe("short");
    close(p.size, 0.002);
    close(p.entryPrice, 70_000);
    close(p.markPrice, 71_000);
    close(p.deposit, 50);
    close(p.unrealizedPnl, -1.75);
    close(expectedDeltaPnl(p), -2); // short loses 1,000 * 0.002 when price rises
  });
  test("no size means no position", () => {
    expect(decodePosition({ ...raw, lotLNS: 0n }, 710_000n, true, meta, ctx)).toBeNull();
  });
  test("unknown position type is refused, not guessed", () => {
    expect(() => decodePosition({ ...raw, positionType: 2 }, 710_000n, true, meta, ctx)).toThrow();
  });
});

// Live, read-only against Perpl mainnet. Discovers real open positions rather than
// trusting a fixture, so an empty result fails instead of passing vacuously.
describe("readPosition on mainnet", () => {
  const net = NETWORKS.mainnet;
  const client = publicClient("mainnet");

  test("decodes live positions and agrees with the contract's own list and PnL", async () => {
    const block = await client.getBlockNumber();
    let checked = 0;
    for (const market of [1, 20]) {
      const [start] = (await client.readContract({
        address: net.exchange, abi: exchangeAbi, functionName: "getPositionIds", args: [BigInt(market)], blockNumber: block,
      })) as [bigint, bigint];
      const [list] = (await client.readContract({
        address: net.exchange, abi: exchangeAbi, functionName: "getPositionsV2", args: [BigInt(market), start, 3n], blockNumber: block,
      })) as [{ accountId: bigint; lotLNS: bigint; positionType: number }[]];
      const meta = await readPerpMeta(client, net.exchange, market, block);
      for (const e of list) {
        const acc = (await client.readContract({
          address: net.exchange, abi: exchangeAbi, functionName: "getAccountById", args: [e.accountId], blockNumber: block,
        })) as { accountAddr: Address };
        const p = await readPosition(acc.accountAddr, market, { client, blockNumber: block });
        expect(p).not.toBeNull();
        expect(p!.accountId).toBe(e.accountId);
        expect(p!.side).toBe(e.positionType === 0 ? "long" : "short");
        expect(p!.size).toBe(Number(e.lotLNS) / 10 ** Number(meta.lotDecimals));
        expect(p!.markValid).toBe(true);
        expect(p!.entryPrice).toBeGreaterThan(0);
        // Our (mark - entry) * size must reproduce the contract's delta PnL to the cent.
        expect(Math.abs(p!.deltaPnl - expectedDeltaPnl(p!))).toBeLessThan(0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  }, 60_000);

  test("an address with no Perpl account returns null", async () => {
    expect(await readPosition("0x000000000000000000000000000000000000dEaD", 1, { client })).toBeNull();
  }, 20_000);
});
