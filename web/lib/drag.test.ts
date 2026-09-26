import { describe, expect, it } from "bun:test";
import { initialTpSl, nudgePrice, pnlAtPrice, priceFromY, tickSize } from "./drag";

describe("initialTpSl", () => {
  it("places TP above and SL below entry for a long", () => {
    const { tp, sl } = initialTpSl(1000, "long");
    expect(tp).toBeCloseTo(1020, 10);
    expect(sl).toBeCloseTo(980, 10);
    expect(tp).toBeGreaterThan(1000);
    expect(sl).toBeLessThan(1000);
  });

  it("places TP below and SL above entry for a short", () => {
    const { tp, sl } = initialTpSl(1000, "short");
    expect(tp).toBeCloseTo(980, 10);
    expect(sl).toBeCloseTo(1020, 10);
    expect(tp).toBeLessThan(1000);
    expect(sl).toBeGreaterThan(1000);
  });

  it("rejects bad entries", () => {
    expect(() => initialTpSl(0, "long")).toThrow(/bad entry/);
    expect(() => initialTpSl(NaN, "short")).toThrow(/bad entry/);
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
