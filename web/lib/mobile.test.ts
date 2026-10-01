import { describe, expect, it } from "bun:test";
import { shortMarketLabel } from "./mobile";

describe("shortMarketLabel", () => {
  it("cuts the venue suffix off a perp name", () => {
    expect(shortMarketLabel("BTC Perp")).toBe("BTC");
    expect(shortMarketLabel("ETH Perp")).toBe("ETH");
    expect(shortMarketLabel("MONAD100 Perp")).toBe("MONAD100");
    expect(shortMarketLabel("A B C Perp")).toBe("A B C");
  });

  it("hands back a name without the suffix untouched", () => {
    expect(shortMarketLabel("BTC")).toBe("BTC");
    expect(shortMarketLabel("BTCUSD")).toBe("BTCUSD");
    expect(shortMarketLabel("MONAD Perp Perp")).toBe("MONAD Perp");
    expect(shortMarketLabel("")).toBe("");
  });

  it("only cuts the suffix at the end, never inside the name", () => {
    expect(shortMarketLabel("Perp Coin")).toBe("Perp Coin");
    expect(shortMarketLabel("A Perp B")).toBe("A Perp B");
    expect(shortMarketLabel(" Perp")).toBe("");
  });

  it("matches the suffix exactly, so a name that only looks like one survives", () => {
    expect(shortMarketLabel("Perp")).toBe("Perp");
    expect(shortMarketLabel("perp")).toBe("perp");
    expect(shortMarketLabel("BTC perp")).toBe("BTC perp");
  });
});
