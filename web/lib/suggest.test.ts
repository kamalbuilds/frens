import { describe, expect, it } from "bun:test";
import type { Address } from "viem";
import { suggestionDescId } from "./callbook";
import type { Position } from "./readPosition";
import {
  CLOSE_LONG,
  CLOSE_SHORT,
  decodeCloseOrder,
  decodeSuggestion,
  encodeCloseOrder,
  encodeSuggestion,
  priceToPNS,
  sizeToLots,
  toCloseOrder,
  validateSuggestion,
  type Suggestion,
} from "./suggest";

const OWNER = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b" as Address;
const FRIEND = "0x4981053aC0000000000000000000000000000001" as Address;
const STRANGER = "0xe40825b200000000000000000000000000000003" as Address;

// Known BTC case from the chart tests: entry 69742.2, 1 price decimal,
// 5 lot decimals, 0.00179 BTC = 179 lots.
const MARKET = 16;
const CREATED_AT = 1758638400000;

function longPosition(over: Partial<Position> = {}): Position {
  return {
    account: OWNER,
    accountId: 7n,
    market: MARKET,
    symbol: "BTC",
    side: "long",
    size: 0.00179,
    entryPrice: 69742.2,
    markPrice: 70000,
    markValid: true,
    deposit: 100,
    deltaPnl: 0.46,
    fundingPnl: 0,
    unrealizedPnl: 0.46,
    entryBlock: 1n,
    block: 2n,
    ...over,
  };
}

function suggestion(over: Partial<Suggestion> = {}): Suggestion {
  return {
    owner: OWNER,
    market: MARKET,
    side: "long",
    price: 73229.31, // 5 percent above the 69742.2 entry
    sizeLots: 179n,
    from: FRIEND,
    createdAt: CREATED_AT,
    ...over,
  };
}

describe("encode/decode round trip", () => {
  it("round trips a full suggestion exactly, bigint size included", () => {
    const s = suggestion();
    const back = decodeSuggestion(encodeSuggestion(s));
    expect(back).toEqual(s);
    expect(back?.sizeLots).toBe(179n);
  });

  it("round trips a suggestion with no size", () => {
    const s = suggestion({ sizeLots: undefined });
    const back = decodeSuggestion(encodeSuggestion(s));
    expect(back).toEqual(s);
    expect(back?.sizeLots).toBeUndefined();
  });

  it("emits compact unpadded base64url", () => {
    const enc = encodeSuggestion(suggestion());
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(enc).not.toContain("=");
  });

  it("round trips without Node Buffer (browser)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = g["Buffer"];
    try {
      delete g["Buffer"];
      const s = suggestion();
      const enc = encodeSuggestion(s);
      expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeSuggestion(enc)).toEqual(s);
    } finally {
      g["Buffer"] = saved;
    }
  });
});

describe("decode rejects garbage with null, never throws", () => {
  const bad = [
    "",
    "!!!",
    "not a link at all!!",
    "null",
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from("[1,2,3]", "utf8").toString("base64url"),
    Buffer.from(JSON.stringify(["0xshort", 1, 2, 3, 4, 5, 6]), "utf8").toString("base64url"),
  ];
  for (const g of bad) {
    it(`null for ${JSON.stringify(g).slice(0, 40)}`, () => {
      expect(decodeSuggestion(g)).toBeNull();
    });
  }

  it("null for non-string input", () => {
    expect(decodeSuggestion(null as unknown as string)).toBeNull();
    expect(decodeSuggestion(undefined as unknown as string)).toBeNull();
    expect(decodeSuggestion(42 as unknown as string)).toBeNull();
  });

  it("null for a truncated or tampered link", () => {
    const enc = encodeSuggestion(suggestion());
    expect(decodeSuggestion(enc.slice(0, -2))).toBeNull();
    const last = enc[enc.length - 1];
    const tampered = enc.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(decodeSuggestion(tampered)).toBeNull();
  });

  it("null for each structurally wrong slot", () => {
    const good = suggestion();
    const variants: Suggestion[] = [
      { ...good, owner: "0x123" as Address },
      { ...good, market: 1.5 },
      { ...good, market: -1 },
      { ...good, side: "up" as unknown as "long" },
      { ...good, from: STRANGER.slice(0, 10) as Address },
      { ...good, createdAt: -1 },
    ];
    for (const v of variants) expect(decodeSuggestion(encodeSuggestion(v))).toBeNull();
    // Slots JSON cannot express: NaN/Infinity prices stringify to null.
    expect(decodeSuggestion(encodeSuggestion({ ...good, price: NaN })) ?? null).toBeNull();
    expect(decodeSuggestion(encodeSuggestion({ ...good, price: Infinity })) ?? null).toBeNull();
  });
});

describe("validateSuggestion", () => {
  it("accepts a good long take-profit", () => {
    expect(validateSuggestion(suggestion(), longPosition(), 5)).toEqual([]);
  });

  it("accepts a missing size as the whole position", () => {
    expect(validateSuggestion(suggestion({ sizeLots: undefined }), longPosition(), 5)).toEqual([]);
  });

  it("accepts an owner that only differs in casing", () => {
    const upper = suggestion({ owner: OWNER.toUpperCase().replace("0X", "0x") as Address });
    expect(validateSuggestion(upper, longPosition(), 5)).toEqual([]);
  });

  it("rejects a long take-profit at or below mark", () => {
    const below = validateSuggestion(suggestion({ price: 69000 }), longPosition(), 5);
    expect(below.length).toBeGreaterThan(0);
    expect(below.some((m) => /above/i.test(m))).toBe(true);
    const atMark = validateSuggestion(suggestion({ price: 70000 }), longPosition(), 5);
    expect(atMark.some((m) => /above/i.test(m))).toBe(true);
  });

  it("rejects a short take-profit at or above mark", () => {
    const pos = longPosition({ side: "short" });
    const ok = validateSuggestion(suggestion({ side: "short", price: 69000 }), pos, 5);
    expect(ok).toEqual([]);
    const above = validateSuggestion(suggestion({ side: "short", price: 71000 }), pos, 5);
    expect(above.some((m) => /below/i.test(m))).toBe(true);
    const atMark = validateSuggestion(suggestion({ side: "short", price: 70000 }), pos, 5);
    expect(atMark.some((m) => /below/i.test(m))).toBe(true);
  });

  it("rejects a wrong owner, market, or side", () => {
    const owner = validateSuggestion(suggestion({ owner: STRANGER }), longPosition(), 5);
    expect(owner.some((m) => /does not match/.test(m))).toBe(true);
    const market = validateSuggestion(suggestion({ market: 17 }), longPosition(), 5);
    expect(market.some((m) => /market/.test(m))).toBe(true);
    const side = validateSuggestion(suggestion({ side: "short", price: 69000 }), longPosition(), 5);
    expect(side.some((m) => /position is long/.test(m))).toBe(true);
  });

  it("rejects an oversized suggestion but holds the exact boundary", () => {
    // 0.00179 BTC at 5 lot decimals is exactly 179 lots.
    expect(validateSuggestion(suggestion({ sizeLots: 179n }), longPosition(), 5)).toEqual([]);
    const over = validateSuggestion(suggestion({ sizeLots: 180n }), longPosition(), 5);
    expect(over.some((m) => /exceeds/.test(m))).toBe(true);
    const zero = validateSuggestion(suggestion({ sizeLots: 0n }), longPosition(), 5);
    expect(zero.some((m) => /positive/.test(m))).toBe(true);
  });

  it("rejects non-positive or non-finite prices", () => {
    for (const price of [0, -10, NaN, Infinity]) {
      const problems = validateSuggestion(suggestion({ price }), longPosition(), 5);
      expect(problems.some((m) => /positive/.test(m))).toBe(true);
    }
  });
});

describe("toCloseOrder", () => {
  const meta = { symbol: "BTC", priceDecimals: 1n, lotDecimals: 5n };

  it("builds the exact resting CloseLong trade.ts places", () => {
    // Hand computed: 73229.31 at 1 price decimal floors to 732293 ticks;
    // 0.00179 BTC at 5 lot decimals is 179 lots. The order id packs the
    // suggester (FRIEND) into the top 160 bits and CREATED_AT below.
    expect(toCloseOrder(suggestion(), meta)).toEqual({
      orderDescId: suggestionDescId(FRIEND, CREATED_AT),
      perpId: 16n,
      orderType: CLOSE_LONG,
      orderId: 0n,
      pricePNS: 732293n,
      lotLNS: 179n,
      expiryBlock: 0n,
      postOnly: true,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: 300n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxNegPnlCollatBPS: 1000n,
    });
  });

  it("builds a CloseShort that ceils the same price", () => {
    const order = toCloseOrder(suggestion({ side: "short", price: 73229.31 }), meta);
    expect(order.orderType).toBe(CLOSE_SHORT);
    expect(order.pricePNS).toBe(732294n);
    expect(order.postOnly).toBe(true);
    expect(order.maxNegPnlCollatBPS).toBe(1000n);
  });

  it("rounds toward the conservative side for the owner on both sides", () => {
    // 73229.35 falls between ticks at 1 decimal: longs floor, shorts ceil.
    expect(priceToPNS(73229.35, 1n, "long")).toBe(732293n);
    expect(priceToPNS(73229.35, 1n, "short")).toBe(732294n);
    // An exact tick is untouched for both sides.
    expect(priceToPNS(73229.3, 1n, "long")).toBe(732293n);
    expect(priceToPNS(73229.3, 1n, "short")).toBe(732293n);
  });

  it("scales exactly where float math drifts", () => {
    // 73229.35 * 1e5 is 7322935000.000001 in doubles, so a naive ceil gives
    // 7322935001; the true decimal value is exactly 7322935000.
    expect(priceToPNS(73229.35, 5n, "short")).toBe(7322935000n);
    expect(priceToPNS(73229.35, 5n, "long")).toBe(7322935000n);
    expect(sizeToLots(0.00179, 5n)).toBe(179n);
  });

  it("falls back to fullSizeLots and honors an explicit order id", () => {
    const order = toCloseOrder(suggestion({ sizeLots: undefined }), meta, {
      fullSizeLots: 179n,
      orderDescId: 99n,
    });
    expect(order.lotLNS).toBe(179n);
    expect(order.orderDescId).toBe(99n);
  });

  it("throws when there is no size or no usable price", () => {
    expect(() => toCloseOrder(suggestion({ sizeLots: undefined }), meta)).toThrow(/no size/);
    expect(() => toCloseOrder(suggestion({ price: 0 }), meta)).toThrow(/price/);
  });

  it("round trips through execOrder calldata against the Exchange ABI", () => {
    const order = toCloseOrder(suggestion(), meta);
    const back = decodeCloseOrder(encodeCloseOrder(order));
    expect(back).toEqual(order);
  });
});

describe("stop-loss calls", () => {
  const sl = (over: Partial<Suggestion> = {}) => suggestion({ kind: "sl", price: 68000, sizeLots: undefined, ...over });

  it("round trips as an 8 slot link, and a take-profit link stays 7 slots", () => {
    expect(decodeSuggestion(encodeSuggestion(sl()))).toEqual(sl());
    expect(decodeSuggestion(encodeSuggestion(suggestion()))?.kind).toBeUndefined();
    expect(JSON.parse(Buffer.from(encodeSuggestion(suggestion()), "base64url").toString())).toHaveLength(7);
    expect(JSON.parse(Buffer.from(encodeSuggestion(sl()), "base64url").toString())).toHaveLength(8);
  });

  it("rejects an 8th slot that is not sl", () => {
    const bad = Buffer.from(JSON.stringify([OWNER, MARKET, "long", 68000, null, FRIEND, CREATED_AT, "tp"])).toString("base64url");
    expect(decodeSuggestion(bad)).toBeNull();
  });

  it("accepts a long stop below mark and a short stop above it", () => {
    expect(validateSuggestion(sl(), longPosition(), 5)).toEqual([]);
    expect(validateSuggestion(sl({ side: "short", price: 72000 }), longPosition({ side: "short" }), 5)).toEqual([]);
  });

  it("rejects a long stop above mark and a short stop below it, which a take-profit would accept", () => {
    expect(validateSuggestion(sl({ price: 72000 }), longPosition(), 5)[0]).toMatch(/stop-loss for a long must be below/);
    expect(validateSuggestion(sl({ side: "short", price: 68000 }), longPosition({ side: "short" }), 5)[0]).toMatch(/stop-loss for a short must be above/);
    expect(validateSuggestion(suggestion({ price: 72000 }), longPosition(), 5)).toEqual([]);
  });
});
