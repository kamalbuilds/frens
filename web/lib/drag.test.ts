import { describe, expect, it } from "bun:test";
import { clampTpSl, initialTpSl, nudgePrice, pnlAtPrice, priceFromY, tickSize, validTpSl } from "./drag";

describe("initialTpSl", () => {
  it("starts from the mark: TP above and SL below mark for a long", () => {
    const { tp, sl } = initialTpSl(1000, "long");
    expect(tp).toBeCloseTo(1020, 10);
    expect(sl).toBeCloseTo(980, 10);
    expect(tp).toBeGreaterThan(1000);
    expect(sl).toBeLessThan(1000);
  });

  it("starts from the mark: TP below and SL above mark for a short", () => {
    const { tp, sl } = initialTpSl(1000, "short");
    expect(tp).toBeCloseTo(980, 10);
    expect(sl).toBeCloseTo(1020, 10);
    expect(tp).toBeLessThan(1000);
    expect(sl).toBeGreaterThan(1000);
  });

  it("keeps a long TP above the mark even when entry is far below", () => {
    // Trader F91B: long, entry 69,742.2, BTC mark 83,955.9. From the mark,
    // TP must clear the mark instead of filling immediately.
    const { tp, sl } = initialTpSl(83955.9, "long");
    expect(tp).toBeCloseTo(83955.9 * 1.02, 6);
    expect(sl).toBeCloseTo(83955.9 * 0.98, 6);
    expect(tp).toBeGreaterThan(83955.9);
    expect(sl).toBeLessThan(83955.9);
  });

  it("rejects bad marks", () => {
    expect(() => initialTpSl(0, "long")).toThrow(/bad entry/);
    expect(() => initialTpSl(NaN, "short")).toThrow(/bad entry/);
  });
});

describe("validTpSl", () => {
  it("long TP must stay above mark, SL below", () => {
    expect(validTpSl("tp", 1020, 1000, "long")).toBe(true);
    expect(validTpSl("tp", 1000, 1000, "long")).toBe(false);
    expect(validTpSl("tp", 980, 1000, "long")).toBe(false);
    expect(validTpSl("sl", 980, 1000, "long")).toBe(true);
    expect(validTpSl("sl", 1000, 1000, "long")).toBe(false);
    expect(validTpSl("sl", 1020, 1000, "long")).toBe(false);
  });

  it("short TP must stay below mark, SL above", () => {
    expect(validTpSl("tp", 980, 1000, "short")).toBe(true);
    expect(validTpSl("tp", 1000, 1000, "short")).toBe(false);
    expect(validTpSl("tp", 1020, 1000, "short")).toBe(false);
    expect(validTpSl("sl", 1020, 1000, "short")).toBe(true);
    expect(validTpSl("sl", 1000, 1000, "short")).toBe(false);
    expect(validTpSl("sl", 980, 1000, "short")).toBe(false);
  });

  it("rejects non-finite inputs", () => {
    expect(validTpSl("tp", NaN, 1000, "long")).toBe(false);
    expect(validTpSl("tp", 1020, NaN, "long")).toBe(false);
    expect(validTpSl("sl", -5, 1000, "long")).toBe(false);
  });
});

describe("clampTpSl", () => {
  it("passes valid prices through untouched", () => {
    expect(clampTpSl("tp", 1020, 1000, "long", 2)).toBe(1020);
    expect(clampTpSl("sl", 980, 1000, "long", 2)).toBe(980);
    expect(clampTpSl("tp", 980, 1000, "short", 2)).toBe(980);
    expect(clampTpSl("sl", 1020, 1000, "short", 2)).toBe(1020);
  });

  it("clamps a long TP dragged to or below the mark to one tick above", () => {
    expect(clampTpSl("tp", 1000, 1000, "long", 2)).toBeCloseTo(1000.01, 10);
    expect(clampTpSl("tp", 900, 1000, "long", 2)).toBeCloseTo(1000.01, 10);
  });

  it("clamps a long SL dragged to or above the mark to one tick below", () => {
    expect(clampTpSl("sl", 1000, 1000, "long", 2)).toBeCloseTo(999.99, 10);
    expect(clampTpSl("sl", 1100, 1000, "long", 2)).toBeCloseTo(999.99, 10);
  });

  it("clamps short lines to the mirrored ticks", () => {
    expect(clampTpSl("tp", 1000, 1000, "short", 2)).toBeCloseTo(999.99, 10);
    expect(clampTpSl("tp", 1100, 1000, "short", 2)).toBeCloseTo(999.99, 10);
    expect(clampTpSl("sl", 1000, 1000, "short", 2)).toBeCloseTo(1000.01, 10);
    expect(clampTpSl("sl", 900, 1000, "short", 2)).toBeCloseTo(1000.01, 10);
  });
});

describe("pnlAtPrice", () => {
  it("long gains above entry and loses below", () => {
    expect(pnlAtPrice(1100, 1000, 2, "long")).toBeCloseTo(200, 10);
    expect(pnlAtPrice(900, 1000, 2, "long")).toBeCloseTo(-200, 10);
    expect(pnlAtPrice(1000, 1000, 2, "long")).toBe(0);
  });

  it("short gains below entry and loses above", () => {
    expect(pnlAtPrice(900, 1000, 2, "short")).toBeCloseTo(200, 10);
    expect(pnlAtPrice(1100, 1000, 2, "short")).toBeCloseTo(-200, 10);
    expect(pnlAtPrice(1000, 1000, 2, "short")).toBe(0);
  });
});

describe("tick and nudge", () => {
  it("tickSize follows price decimals", () => {
    expect(tickSize(2)).toBe(0.01);
    expect(tickSize(1)).toBe(0.1);
    expect(tickSize(0)).toBe(1);
  });

  it("nudges a long line by exactly one tick without float drift", () => {
    expect(nudgePrice(100, 2, 1)).toBeCloseTo(100.01, 10);
    expect(nudgePrice(100, 2, -1)).toBeCloseTo(99.99, 10);
    let p = 100;
    for (let i = 0; i < 10; i++) p = nudgePrice(p, 1, 1);
    expect(p).toBeCloseTo(101, 10);
  });

  it("nudges a short line by exactly one tick", () => {
    expect(nudgePrice(980, 2, 1)).toBeCloseTo(980.01, 10);
    expect(nudgePrice(1020, 2, -1)).toBeCloseTo(1019.99, 10);
  });
});

describe("priceFromY", () => {
  it("passes through a valid price", () => {
    expect(priceFromY(120, () => 1020)).toBe(1020);
  });

  it("nulls null, non-positive and non-finite converter output", () => {
    expect(priceFromY(0, () => null)).toBeNull();
    expect(priceFromY(0, () => 0)).toBeNull();
    expect(priceFromY(0, () => -5)).toBeNull();
    expect(priceFromY(0, () => NaN)).toBeNull();
    expect(priceFromY(0, () => Infinity)).toBeNull();
  });
});
