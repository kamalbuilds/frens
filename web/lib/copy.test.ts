import { describe, expect, it } from "bun:test";
import { decodeAbiParameters, decodeFunctionData, type Abi, type Hex } from "viem";
import { COPY_BUILDER_FEE_PER_100K, encodeCopyOrder, toCopyOrder, type CopyOrderDesc, type FriendTrade } from "./copy";
import officialAbi from "./exchange-official.abi.json";
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
const at = (side: "long" | "short", over: Partial<Opts>) =>
  toCopyOrder({ market: 16, side }, META, opts(over)).pricePNS;

// Wire order types, the 0-indexed dex-sdk enum trade.ts read off a fork:
// OPEN_LONG = 0, and because the enum interleaves open and close pairs the
// short open is 1.
const WIRE_OPEN_LONG = 0;
const WIRE_OPEN_SHORT = 1;

describe("toCopyOrder", () => {
  it("builds the exact OPEN_LONG taker order trade.ts places", () => {
    // 70000 mark at 200 bps is a bound of 71400, which is 714000 ticks at 1
    // price decimal. 0.00179 BTC at 5 lot decimals is 179 lots.
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

  it("rounds the limit to the best tick inside the copier's bound", () => {
    // A 70001.3 mark at 200 bps has exact bounds of 71401.326 and 68601.274.
    // The best whole tick inside them is 71401.3 for the long and 68601.3 for
    // the short. Rounding outward instead, ceil the buy and floor the sell,
    // would put both limits a tick past what the copier approved.
    expect(at("long", { markPrice: 70001.3 })).toBe(714013n);
    expect(at("short", { markPrice: 70001.3 })).toBe(686013n);
  });

  it("anchors the bound on a mark that has no whole tick", () => {
    // 10.01 is 100.1 ticks, so which way the mark is scaled decides the limit.
    // Flooring it for the long anchors the bound at 100.0, a bid of 10.0
    // against an exact bound of 10.06005; ceiling it would give 10.1, a tick
    // above the promise. Ceiling it for the short anchors the bound at 10.1,
    // an offer of 10.0 against an exact bound of 9.85985; flooring it would
    // give 9.9, a tick below. Chain marks are whole ticks, so this only bites
    // on a rounded or estimated mark, which is exactly when it must not bite
    // the wrong way.
    expect(at("long", { markPrice: 10.01, maxSlippageBps: 50 })).toBe(100n);
    expect(at("short", { markPrice: 10.01, maxSlippageBps: 150 })).toBe(100n);
  });

  it("holds the exact bound where double math silently lands a tick tight", () => {
    // 20 at 50 bps is a bound of 20.1, which is 201 ticks, and 40 at 25 bps is
    // 39.9, which is 399. In doubles 20 * 1.005 is 20.099999999999998 and
    // 40 * 0.9975 is 39.900000000000006, so the limit drifts to 200 and 400:
    // an order a tick tighter than the slippage the copier chose, which can sit
    // below the fill it was allowed to take. About one bound in twenty lands
    // that way, so it is not a rounding curiosity.
    expect(at("long", { markPrice: 20, maxSlippageBps: 50 })).toBe(201n);
    expect(at("short", { markPrice: 40, maxSlippageBps: 25 })).toBe(399n);
  });

  it("prices the copier inside maxSlippageBps with no tolerance, on both sides", () => {
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
      [20, 50],
      [40, 25],
    ];
    for (const [markPrice, maxSlippageBps] of cases) {
      const bps = BigInt(maxSlippageBps);
      // The mark as an exact numerator over 1000, so a mark with decimals is
      // compared against the limit in whole ticks with no double rounding.
      const n = BigInt(Math.round(markPrice * 1000));
      const long = at("long", { markPrice, maxSlippageBps });
      const short = at("short", { markPrice, maxSlippageBps });
      // Ticks are dollars * 10, so a limit is inside a dollar bound when
      // limit * BPS * 100 <= n * (BPS + bps). A long pays no more than its
      // bound and a short receives no less than its bound, exactly.
      expect(long * BPS * 100n <= n * (BPS + bps)).toBe(true);
      expect(n * (BPS - bps) <= short * BPS * 100n).toBe(true);
      // A copy is never the better price: no free fills, no maker rebate. The
      // mark each side is measured from is the one it can actually express, a
      // floored tick for a long and a ceiled one for a short.
      expect(long >= n / 100n).toBe(true);
      expect(short <= (n + 99n) / 100n).toBe(true);
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
    // Both ends of the range are allowed: 1 bps on 70000 is a 70007.0 bound,
    // which is 700070 ticks, and 500 bps is 73500.0, which is 735000 ticks.
    expect(at("long", { maxSlippageBps: 1 })).toBe(700070n);
    expect(at("long", { maxSlippageBps: 500 })).toBe(735000n);
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
    const decoded = decodeFunctionData({ abi: officialAbi as Abi, data: encodeCopyOrder(order) });
    expect(decoded.functionName).toBe("execOrderV2");
    return { order: decoded.args?.[0] as CopyOrderDesc, extension: decoded.args?.[1] as Hex };
  };

  it("round trips through viem decodeFunctionData to the same struct", () => {
    for (const side of ["long", "short"] as const) {
      const order = toCopyOrder({ market: 16, side }, META, opts());
      expect(wire(order).order).toEqual(order);
    }
  });

  it("carries the taker flags and open order type on the wire, not just in the struct", () => {
    const long = wire(toCopyOrder(FRIEND_LONG, META, opts())).order;
    expect(long.orderType).toBe(WIRE_OPEN_LONG);
    expect(long.immediateOrCancel).toBe(true);
    expect(long.postOnly).toBe(false);
    expect(long.pricePNS).toBe(714000n);
    expect(long.lotLNS).toBe(179n);
    const short = wire(toCopyOrder({ market: 16, side: "short" }, META, opts())).order;
    expect(short.orderType).toBe(WIRE_OPEN_SHORT);
    expect(short.pricePNS).toBe(686000n);
  });

  it("carries frens' builder attribution (id 23) at the configured fee", () => {
    const { extension } = wire(toCopyOrder(FRIEND_LONG, META, opts()));
    const [version, payload] = decodeAbiParameters([{ type: "uint16" }, { type: "bytes" }], extension);
    expect(version).toBe(1);
    expect(decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], payload)).toEqual([23n, BigInt(COPY_BUILDER_FEE_PER_100K)]);
  });
});
