import { describe, expect, it } from "bun:test";
import { DOWN_WASH, FRIEND_HUES, UP_WASH, assignColours, avatarLabel, avatarTime, byPnl, candleChange, chipFor, colourFor, entryLinePoints, formatPrice, formatUsd, placeAvatar, scaleCandle, sideCounts, stackChips, visiblePriceRange, volumeColorFor, type Friend } from "./chart";

describe("scaleCandle", () => {
  it("divides by the market's price decimals and converts ms to seconds", () => {
    const c = scaleCandle({ t: 1790136000000, o: 866780, c: 871326, h: 872572, l: 866089, v: "12.5", n: 1 }, 1);
    expect(c).toEqual({ time: 1790136000, open: 86678, high: 87257.2, low: 86608.9, close: 87132.6, volume: 12.5 });
  });

  it("carries the candle volume through for the footer strip", () => {
    expect(scaleCandle({ t: 0, o: 1, c: 2, h: 3, l: 0, v: "0", n: 1 }, 0).volume).toBe(0);
    expect(scaleCandle({ t: 0, o: 1, c: 2, h: 3, l: 0, v: "1048576", n: 1 }, 0).volume).toBe(1048576);
  });

  it("coerces an unparseable volume to zero instead of dropping the candle", () => {
    expect(scaleCandle({ t: 0, o: 1, c: 2, h: 3, l: 0, v: "", n: 1 }, 0).volume).toBe(0);
    expect(scaleCandle({ t: 0, o: 1, c: 2, h: 3, l: 0, v: "nan-volume", n: 1 }, 0).volume).toBe(0);
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

describe("assignColours", () => {  const room = [
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
  it("never hands out the viewer accent to a trader", () => {
    expect(FRIEND_HUES as readonly string[]).not.toContain("#2F5BEA");
    for (let i = 0; i < 50; i++) {
      expect(colourFor(`0x${i.toString(16).padStart(40, "0")}`)).not.toBe("#2F5BEA");
    }
  });
});

describe("volumeColorFor", () => {
  it("paints an up candle's bar in the up wash and a down candle's in the down wash", () => {
    expect(volumeColorFor({ open: 100, close: 101 })).toBe(UP_WASH);
    expect(volumeColorFor({ open: 101, close: 100 })).toBe(DOWN_WASH);
    expect(volumeColorFor({ open: 100, close: 100 })).toBe(UP_WASH);
  });
  it("uses concrete fills the chart library can parse", () => {
    expect(UP_WASH).toBe("#2BD67B");
    expect(DOWN_WASH).toBe("#FF6B57");
  });
});

describe("avatarLabel", () => {
  it("prints two letters for the on-chart avatar", () => {
    expect(avatarLabel("0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b")).toBe("F9");
    expect(avatarLabel("0x4981053aC0000000000000000000000000000001")).toBe("49");
  });
});

describe("avatarTime", () => {
  it("sits the avatar at the entry time when the position data has one", () => {
    expect(avatarTime(1790136000, 1790139600)).toBe(1790136000);
  });
  it("falls back to the last candle when entry time is null", () => {
    expect(avatarTime(null, 1790139600)).toBe(1790139600);
  });
});

describe("sideCounts", () => {
  it("splits the room into longs and shorts for the summary bar", () => {
    expect(sideCounts([{ side: "long" }, { side: "long" }, { side: "short" }])).toEqual({ long: 2, short: 1 });
    expect(sideCounts([])).toEqual({ long: 0, short: 0 });
  });
});

describe("candleChange", () => {
  it("measures against the previous close", () => {
    expect(candleChange({ open: 100, close: 102 }, 100)).toEqual({ change: 2, pct: 2 });
    expect(candleChange({ open: 100, close: 98 }, 100)).toEqual({ change: -2, pct: -2 });
  });
  it("falls back to the candle open on the first candle", () => {
    expect(candleChange({ open: 100, close: 102 }, null)).toEqual({ change: 2, pct: 2 });
  });
});

describe("visiblePriceRange", () => {
  const base = { min: 82800, max: 84500 };
  it("fits the candles when no TP or SL is selected", () => {
    expect(visiblePriceRange(base, null, null)).toEqual({ min: 82800, max: 84500 });
  });
  it("stretches to include the selected TP and SL only", () => {
    expect(visiblePriceRange(base, 86000, 81000)).toEqual({ min: 81000, max: 86000 });
    expect(visiblePriceRange(base, 83500, null)).toEqual({ min: 82800, max: 84500 });
  });
  it("ignores friends entries far outside the candles", () => {
    // Entries at 64,022 to 69,742 must not move the range for candles near 84,014.
    const range = visiblePriceRange(base, null, null);
    expect(range!.min).toBeGreaterThan(64022);
    expect(range!.min).toBeGreaterThan(69742);
  });
  it("returns null with no candles and no lines", () => {
    expect(visiblePriceRange(null, null, null)).toBeNull();
  });
  it("fits TP/SL alone when the library has no visible range", () => {
    expect(visiblePriceRange(null, 86000, 81000)).toEqual({ min: 81000, max: 86000 });
  });
});

describe("placeAvatar", () => {

  it("snaps an entry inside the newest, still-open candle onto that candle", () => {
    const first = 1000 * 3600, last = first + 10 * 3600;
    const entry = last + 1800; // half way through the open candle
    const timeToX = (t: number) => (t >= first && t <= last && (t - first) % 3600 === 0 ? (t - first) / 3600 * 10 : null);
    const out = placeAvatar({ entryTime: entry, entryPrice: 100, firstTime: first, lastTime: last, viewMin: 90, viewMax: 110, timeToX, priceToY: () => 50, height: 200, barSeconds: 3600 });
    expect(out.mode).toBe("candle");
    expect(out.x).toBe(100);
  });
  const ctx = {
    firstTime: 1000,
    lastTime: 2000,
    viewMin: 82000,
    viewMax: 85000,
    height: 400,
    timeToX: (t: number) => (t >= 1000 && t <= 2000 ? t - 1000 : null),
    priceToY: (p: number) => (p >= 82000 && p <= 85000 ? ((85000 - p) / 3000) * 400 : p > 85000 ? -20 : 420),
  };
  it("sits on the candle when time and price are both inside the visible range", () => {
    const r = placeAvatar({ entryTime: 1500, entryPrice: 84014, ...ctx });
    expect(r.mode).toBe("candle");
    expect(r.x).toBe(500);
    expect(r.y).toBeCloseTo(((85000 - 84014) / 3000) * 400, 10);
  });
  it("pins to the bottom edge when the entry price is below the visible range", () => {
    const r = placeAvatar({ entryTime: 1500, entryPrice: 69742, ...ctx });
    expect(r.mode).toBe("bottom");
    expect(r.y).toBe(400 - 11);
  });
  it("pins to the top edge when the entry price is above the visible range", () => {
    const r = placeAvatar({ entryTime: 1500, entryPrice: 90000, ...ctx });
    expect(r.mode).toBe("top");
    expect(r.y).toBe(11);
  });
  it("pins to an edge when entryTime is null or outside the range", () => {
    const a = placeAvatar({ entryTime: null, entryPrice: 84014, ...ctx });
    expect(a.mode === "top" || a.mode === "bottom").toBe(true);
    const b = placeAvatar({ entryTime: 500, entryPrice: 84014, ...ctx });
    expect(b.mode === "top" || b.mode === "bottom").toBe(true);
  });
});

describe("entryLinePoints", () => {
  it("draws a hairline from the entry candle to the latest one", () => {
    expect(entryLinePoints(100, 300, 84000)).toEqual([{ time: 100, value: 84000 }, { time: 300, value: 84000 }]);
  });

  it("is a single point when the position opened on the latest candle, never two points with one time", () => {
    const pts = entryLinePoints(300, 300, 84000);
    expect(pts).toEqual([{ time: 300, value: 84000 }]);
    expect(new Set(pts.map((p) => p.time)).size).toBe(pts.length);
  });
});
