import { describe, expect, it } from "bun:test";
import { FRIEND_HUES, assignColours, byPnl, chipFor, colourFor, formatPrice, formatUsd, scaleCandle, stackChips, type Friend } from "./chart";

describe("scaleCandle", () => {
  it("divides by the market's price decimals and converts ms to seconds", () => {
    const c = scaleCandle({ t: 1790136000000, o: 866780, c: 871326, h: 872572, l: 866089, v: "1", n: 1 }, 1);
    expect(c).toEqual({ time: 1790136000, open: 86678, high: 87257.2, low: 86608.9, close: 87132.6 });
  });

  it("handles a market quoted to many decimals", () => {
    expect(scaleCandle({ t: 0, o: 204, c: 241, h: 250, l: 200, v: "1", n: 1 }, 4).close).toBeCloseTo(0.0241, 10);
  });

  it("refuses a nonsense decimals value instead of drawing a wrong chart", () => {
    expect(() => scaleCandle({ t: 0, o: 1, c: 1, h: 1, l: 1, v: "1", n: 1 }, -1)).toThrow();
    expect(() => scaleCandle({ t: 0, o: 1, c: 1, h: 1, l: 1, v: "1", n: 1 }, 1.5)).toThrow();
  });
});

describe("colourFor", () => {
  const a = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b";
  it("is stable across calls and across address casing", () => {
    expect(colourFor(a)).toBe(colourFor(a));
    expect(colourFor(a.toLowerCase())).toBe(colourFor(a.toUpperCase().replace("0X", "0x")));
  });
  it("only ever returns a DESIGN.md friend hue", () => {
    for (let i = 0; i < 50; i++) expect(FRIEND_HUES as readonly string[]).toContain(colourFor(`0x${i.toString(16).padStart(40, "0")}`));
  });
});

describe("chipFor", () => {
  const base: Friend = {
    account: "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b",
    side: "long", size: 0.00179, entryPrice: 69742.2, markPrice: 83840.1,
    unrealizedPnl: 31.736342, fundingPnl: 6.5, entryBlock: "55355560", entryTime: null,
  };
  it("marks a profitable long as in profit with a signed dollar PnL", () => {
    const c = chipFor(base, 1);
    expect(c.inProfit).toBe(true);
    expect(c.pnl).toBe("+$31.74");
    expect(c.side).toBe("LONG");
    expect(c.entry).toBe("69,742.2");
  });
  it("marks an underwater short as not in profit", () => {
    const c = chipFor({ ...base, side: "short", unrealizedPnl: -3761.39 }, 1);
    expect(c.inProfit).toBe(false);
    expect(c.pnl).toBe("-$3,761.39");
    expect(c.side).toBe("SHORT");
  });
});

describe("formatting", () => {
  it("keeps market precision on small prices", () => {
    expect(formatPrice(0.0204, 4)).toBe("0.0204");
  });
  it("renders zero PnL without a sign", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("stackChips", () => {
  it("leaves well separated chips where they are", () => {
    expect(stackChips([100, 200, 300], 20)).toEqual([100, 200, 300]);
  });
  it("pushes colliding chips apart by at least the gap, in price order", () => {
    const out = stackChips([100, 105, 102], 20);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(20);
    expect(out[0]).toBe(100);
  });
  it("keeps each chip's index even though it sorts internally", () => {
    const out = stackChips([300, 100], 20);
    expect(out).toEqual([300, 100]);
  });
});

describe("byPnl", () => {
  it("puts the strongest position first without mutating the input", () => {
    const f = (p: number) => ({ unrealizedPnl: p } as Friend);
    const input = [f(-5), f(20), f(3)];
    expect(byPnl(input).map((x) => x.unrealizedPnl)).toEqual([20, 3, -5]);
    expect(input.map((x) => x.unrealizedPnl)).toEqual([-5, 20, 3]);
  });
});

describe("assignColours", () => {
  const room = [
    "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b",
    "0x4981053aC0000000000000000000000000000001",
    "0x782a74e700000000000000000000000000000002",
    "0xe40825b200000000000000000000000000000003",
  ];
  it("gives every trader in a room of up to five a different colour", () => {
    const c = assignColours(room);
    expect(new Set(c.values()).size).toBe(room.length);
  });
  it("does not depend on list order or address casing", () => {
    const a = assignColours(room);
    const b = assignColours([...room].reverse().map((x) => x.toUpperCase().replace("0X", "0x")));
    for (const r of room) expect(b.get(r.toLowerCase())).toBe(a.get(r.toLowerCase()));
  });
  it("still returns a hue for everyone when the room is bigger than the palette", () => {
    const big = Array.from({ length: 8 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
    const c = assignColours(big);
    expect(c.size).toBe(8);
    for (const v of c.values()) expect(FRIEND_HUES as readonly string[]).toContain(v);
  });
});
