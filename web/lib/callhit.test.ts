import { describe, expect, test } from "bun:test";
import { callHit } from "./callhit";
import { CLOSE_LONG, CLOSE_SHORT } from "./suggest";

const BAR = 900;
const SINCE = 1_000_000;

describe("callHit", () => {
  test("long hit", () => {
    const candles = [{ time: SINCE, high: 110, low: 90 }];
    expect(callHit(CLOSE_LONG, 100, candles, SINCE, BAR)).toBe(true);
  });
  test("long miss", () => {
    const candles = [{ time: SINCE, high: 99, low: 90 }];
    expect(callHit(CLOSE_LONG, 100, candles, SINCE, BAR)).toBe(false);
  });
  test("short hit", () => {
    const candles = [{ time: SINCE, high: 110, low: 90 }];
    expect(callHit(CLOSE_SHORT, 100, candles, SINCE, BAR)).toBe(true);
  });
  test("short miss", () => {
    const candles = [{ time: SINCE, high: 110, low: 101 }];
    expect(callHit(CLOSE_SHORT, 100, candles, SINCE, BAR)).toBe(false);
  });
  test("candle ending before sinceSec is ignored", () => {
    const candles = [{ time: SINCE - BAR - 1, high: 200, low: 1 }];
    expect(callHit(CLOSE_LONG, 100, candles, SINCE, BAR)).toBe(false);
    expect(callHit(CLOSE_SHORT, 100, candles, SINCE, BAR)).toBe(false);
  });
  test("unknown orderType returns false", () => {
    const candles = [{ time: SINCE, high: 200, low: 1 }];
    expect(callHit(0, 100, candles, SINCE, BAR)).toBe(false);
    expect(callHit(4, 100, candles, SINCE, BAR)).toBe(false);
  });
});
