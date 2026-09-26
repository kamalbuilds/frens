import { describe, expect, it } from "bun:test";
import { decodeFunctionData } from "viem";
import { encodeCopyOrder, toCopyOrder, type CopyOrderDesc, type FriendTrade } from "./copy";
import { exchangeAbi } from "./perpl";
import { encodeCloseOrder, sizeToLots } from "./suggest";

const BPS = 10_000n;

// The BTC market from the chart and suggestion tests: market 16, 1 price
// decimal, 5 lot decimals, so 0.00179 BTC is exactly 179 lots.
const META = { symbol: "BTC", priceDecimals: 1n, lotDecimals: 5n };
const ORDER_ID = 1_758_638_400_000n;
const FRIEND_LONG: FriendTrade = { market: 16, side: "long" };

type Opts = Parameters<typeof toCopyOrder>[2];
const opts = (over: Partial<Opts> = {}): Opts => ({
  size: 0.00179,
  markPrice: 70000,
  maxSlippageBps: 200,
  orderDescId: ORDER_ID,
  ...over,
});

// Wire order types, the 0-indexed dex-sdk enum trade.ts read off a fork:
// OPEN_LONG = 0, and because the enum interleaves open and close pairs the
// short open is 1.
const WIRE_OPEN_LONG = 0;
const WIRE_OPEN_SHORT = 1;

describe("toCopyOrder", () => {
  it("builds the exact OPEN_LONG taker order trade.ts places", () => {
    // 70000 mark at 200 bps is 71400, which is 714000 ticks at 1 price
    // decimal. 0.00179 BTC at 5 lot decimals is 179 lots.
    expect(toCopyOrder(FRIEND_LONG, META, opts())).toEqual({
      orderDescId: ORDER_ID,
      perpId: 16n,
      orderType: WIRE_OPEN_LONG,
      orderId: 0n,
      pricePNS: 714000n,
      lotLNS: 179n,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: true,
      maxMatches: 0n,
      leverageHdths: 300n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxNegPnlCollatBPS: 1000n,
    } satisfies CopyOrderDesc);
  });

  it("builds the mirrored OPEN_SHORT that sells down to the same bound", () => {
    const order = toCopyOrder({ market: 16, side: "short" }, META, opts());
    expect(order.orderType).toBe(WIRE_OPEN_SHORT);
    expect(order.pricePNS).toBe(686000n);
    expect(order.perpId).toBe(16n);
    expect(order.immediateOrCancel).toBe(true);
    expect(order.postOnly).toBe(false);
    // Same collateral buffer as the long: a taker fill that starts below mark
    // reverts without it.
    expect(order.maxNegPnlCollatBPS).toBe(1000n);
    expect(order.leverageHdths).toBe(300n);
  });

  it("rounds the bound to the worst tick still inside what the copier approved", () => {
    // A 70001.3 mark at 200 bps has exact bounds of 71401.326 and 68601.274
    // dollars, or 714013.26 and 686012.74 ticks. The copier approved paying at
    // most the first and receiving at least the second, so the long must floor
    // to 714013 and the short must ceil to 686013.
    //
    // Rounding the other way is the bug this guards. priceToPNS ceils a short
    // and floors a long because a resting maker wants to be filled, but a copy
    // is the taker paying the fill, so those directions are backwards here:
    // ceiling the buy would hand the long a bid a tick above the promise, and
    // flooring the sell would take the short a tick below it. Both cost the
    // copier real money on a real fill.
    const long = toCopyOrder(FRIEND_LONG, META, opts({ markPrice: 70001.3 }));
    const short = toCopyOrder({ market: 16, side: "short" }, META, opts({ markPrice: 70001.3 }));
    expect(long.pricePNS).toBe(714013n);
    expect(short.pricePNS).toBe(686013n);
  });

  it("keeps the promise when a rounded mark has no whole tick inside it", () => {
    // A mark of 10.01 is 100.1 ticks, which only happens on a mark that was
    // rounded or estimated for display: markPNS on chain is a whole number of
    // ticks. The two guarantees a copy owes the copier, never outside the
    // slippage bound and never at a free price, cannot both hold at sub-tick
    // resolution, and the bound wins because it is the number the copier chose.
    //
    // At 50 bps the long's exact bound is 100.6005 ticks, so 101 breaches it
    // and 100 is the only whole tick the copier approved. Bidding 10.0 against
    // a 10.01 mark does not cross, so the order may not fill. That is what
    // honouring a tight slippage bound costs on a mark that was never a real
    // chain price.
    //
    // At 150 bps the short's exact bound is 98.5985 ticks, which would allow a
    // 99, but the ceiled mark of 101 ticks only reaches 99.485 and ceils to
    // 100: the copier sells at 10.0 rather than 9.9, a tick better than the
    // bound strictly required.
    expect(toCopyOrder(FRIEND_LONG, META, opts({ markPrice: 10.01, maxSlippageBps: 50 })).pricePNS).toBe(100n);
    expect(
      toCopyOrder({ market: 16, side: "short" }, META, opts({ markPrice: 10.01, maxSlippageBps: 150 })).pricePNS,
    ).toBe(100n);
  });

  it("holds maxSlippageBps exactly where double math drifts a whole tick", () => {
    // 5000 at 333 bps is 5166.5 and 4833.5 exactly, and 45 at 400 bps is 43.2
    // exactly. In doubles 5000 * 1.0333 is 5166.500000000001, which ceils to a
    // bid one tick above the bound, and 45 * 0.96 is 43.199999999999996, which
    // floors to a sale one tick below it. The bps have to be integer math on
    // ticks, not doubles on a price.
    const at = (side: "long" | "short", markPrice: number, maxSlippageBps: number) =>
      toCopyOrder({ market: 16, side }, META, opts({ markPrice, maxSlippageBps })).pricePNS;
    expect(at("long", 5000, 333)).toBe(51665n);
    expect(at("short", 5000, 333)).toBe(48335n);
    expect(at("short", 45, 400)).toBe(432n);
  });

  it("prices the copier inside maxSlippageBps, never even by a tick, on both sides", () => {
    const cases: [number, number][] = [
      [70000, 200],
      [70001.3, 200],
      [5000, 333],
      [45, 400],
      [73229.3, 333],
      [100.5, 1],
      [1, 500],
      [10.01, 50],
      [10.01, 150],
    ];
    for (const [markPrice, maxSlippageBps] of cases) {
      const bps = BigInt(maxSlippageBps);
      // The mark as an exact numerator over 1000, so a mark with decimals is
      // compared against the limit in integer ticks with no double rounding.
      const n = BigInt(Math.round(markPrice * 1000));
      const long = toCopyOrder(FRIEND_LONG, META, opts({ markPrice, maxSlippageBps })).pricePNS;
      const short = toCopyOrder({ market: 16, side: "short" }, META, opts({ markPrice, maxSlippageBps })).pricePNS;
      // Ticks are dollars * 10, so a limit in ticks is under a dollar bound when
      // limit * BPS * 100 <= n * (BPS +/- bps). A long pays no more than its
      // bound and a short receives no less than its bound, with no tolerance.
      expect(long * BPS * 100n <= n * (BPS + bps)).toBe(true);
      expect(n * (BPS - bps) <= short * BPS * 100n).toBe(true);
      // A copy is also never a free fill or a maker rebate, so the long bids at
      // or above the mark and the short offers at or below it. At priceDecimals
      // 1 that only holds when the mark is a whole number of ticks, which is
      // every mark that comes off the chain: a whole-tick mark has thousandths
      // that are a multiple of 100. On the one fractional mark in this list the
      // two guarantees are mutually exclusive, the bound above wins, and the
      // "no free fill" half is deliberately not asserted. The blind spot is
      // real but it only opens on a mark that was never a chain price.
      if (n % 100n === 0n) {
        const markPNS = n / 100n;
        expect(long).toBeGreaterThanOrEqual(markPNS);
        expect(short).toBeLessThanOrEqual(markPNS);
      }
    }
  });

  it("sizes from the copier's opts, never the friend's position", () => {
    // A friend payload a real caller might pass straight through, size and all.
    const leaky = { ...FRIEND_LONG, size: 12.5, lotLNS: 1_250_000n } as unknown as FriendTrade;
    const order = toCopyOrder(leaky, META, opts({ size: 0.00179 }));
    expect(order.lotLNS).toBe(179n);
    expect(order.lotLNS).toBe(sizeToLots(0.00179, META.lotDecimals));
    // A copier who sizes up gets their own size, not the friend's.
    const bigger = toCopyOrder(leaky, META, opts({ size: 1 }));
    expect(bigger.lotLNS).toBe(100000n);
    expect(bigger.lotLNS).not.toBe(1_250_000n);
  });

  it("floors a fractional lot like every other size in the app", () => {
    // 0.00179999 is 179.999 lots, so 179 lots trade and the remainder is
    // dropped rather than rounded up into size the copier never asked for.
    expect(toCopyOrder(FRIEND_LONG, META, opts({ size: 0.00179999 })).lotLNS).toBe(179n);
  });

  it("rejects a slippage bound outside 1..500 bps", () => {
    for (const bps of [0, -1, 501, 1000, 1.5, NaN, Infinity]) {
      expect(() => toCopyOrder(FRIEND_LONG, META, opts({ maxSlippageBps: bps }))).toThrow(/maxSlippageBps/);
    }
    // Both ends of the range are allowed: 1 bps on 70000 is 70007.0, which is
    // 700070 ticks, and 500 bps is 73500.0, which is 735000 ticks.
    expect(toCopyOrder(FRIEND_LONG, META, opts({ maxSlippageBps: 1 })).pricePNS).toBe(700070n);
    expect(toCopyOrder(FRIEND_LONG, META, opts({ maxSlippageBps: 500 })).pricePNS).toBe(735000n);
  });

  it("rejects a non-positive or non-finite size or mark price", () => {
    for (const size of [0, -1, NaN, Infinity]) {
      expect(() => toCopyOrder(FRIEND_LONG, META, opts({ size }))).toThrow(/size/);
    }
    for (const markPrice of [0, -70000, NaN, Infinity]) {
      expect(() => toCopyOrder(FRIEND_LONG, META, opts({ markPrice }))).toThrow(/mark price/);
    }
  });

  it("rejects a size too small to be one whole lot", () => {
    // 0.000001 BTC is a tenth of a lot, so the order would trade nothing and
    // still look like a successful send.
    expect(() => toCopyOrder(FRIEND_LONG, META, opts({ size: 0.000001 }))).toThrow(/one whole lot/);
  });

  it("rejects a bad market, a bad side, and a non-bigint order id", () => {
    for (const market of [-1, 1.5, NaN]) {
      expect(() => toCopyOrder({ market, side: "long" }, META, opts())).toThrow(/market/);
    }
    expect(() => toCopyOrder({ market: 16, side: "up" as unknown as "long" }, META, opts())).toThrow(/side/);
    expect(() => toCopyOrder(FRIEND_LONG, META, opts({ orderDescId: 7 as unknown as bigint }))).toThrow(
      /orderDescId/,
    );
  });
});

describe("encodeCopyOrder", () => {
  const wire = (order: CopyOrderDesc) => {
    const decoded = decodeFunctionData({ abi: exchangeAbi, data: encodeCopyOrder(order) });
    expect(decoded.functionName).toBe("execOrder");
    return decoded.args?.[0] as CopyOrderDesc;
  };

  it("round trips through viem decodeFunctionData to the same struct", () => {
    for (const side of ["long", "short"] as const) {
      const order = toCopyOrder({ market: 16, side }, META, opts());
      expect(wire(order)).toEqual(order);
    }
  });

  it("carries the taker flags and open order type on the wire, not just in the struct", () => {
    const long = wire(toCopyOrder(FRIEND_LONG, META, opts()));
    expect(long.orderType).toBe(WIRE_OPEN_LONG);
    expect(long.immediateOrCancel).toBe(true);
    expect(long.postOnly).toBe(false);
    expect(long.pricePNS).toBe(714000n);
    expect(long.lotLNS).toBe(179n);
    const short = wire(toCopyOrder({ market: 16, side: "short" }, META, opts()));
    expect(short.orderType).toBe(WIRE_OPEN_SHORT);
    expect(short.pricePNS).toBe(686000n);
  });

  it("is byte for byte the calldata a close order sends", () => {
    // The copier signs these bytes, so an open and a close of the same struct
    // must serialize identically; the Exchange reads the direction out of the
    // order type, not out of the selector.
    const order = toCopyOrder(FRIEND_LONG, META, opts());
    expect(encodeCopyOrder(order)).toBe(encodeCloseOrder(order));
  });
});
