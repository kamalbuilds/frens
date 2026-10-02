import { describe, expect, it } from "bun:test";
import type { Address } from "viem";
import type { Suggestion } from "./suggest";
import { buildCounterSuggestion, ghostColorFor, ghostLabelText, hexWithAlpha } from "./ghost";

const OWNER = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b" as Address;
const FROM = "0x4981053aA266D74f9914a74Ad8ED79014846Ace9" as Address;

function suggestion(over: Partial<Suggestion> = {}): Suggestion {
  return {
    owner: OWNER,
    market: 1,
    side: "long",
    price: 86500,
    sizeLots: undefined,
    from: FROM,
    createdAt: 1758638400000,
    ...over,
  };
}

describe("buildCounterSuggestion", () => {
  it("keeps the owner and the caller: a counter is the same call at a new price", () => {
    const original = suggestion({ market: 3, side: "short", price: 80000 });
    const counter = buildCounterSuggestion(original, 81000, 1758638500000);
    expect(counter.owner).toBe(original.owner);
    expect(counter.from).toBe(original.from);
    expect(counter.market).toBe(3);
    expect(counter.side).toBe("short");
    expect(counter.price).toBe(81000);
    expect(counter.createdAt).toBe(1758638500000);
  });

  it("carries the size over", () => {
    const original = suggestion({ sizeLots: 179n });
    expect(buildCounterSuggestion(original, 86600, 1).sizeLots).toBe(179n);
  });

  it("rejects a non-positive counter price", () => {
    expect(() => buildCounterSuggestion(suggestion(), 0)).toThrow(/non-positive/);
  });
});

describe("ghostLabelText", () => {
  it("formats price and signed PnL like the axis pill", () => {
    const label = ghostLabelText({ from: FROM, price: 86500, pnl: 30, priceDecimals: 1 });
    expect(label).toBe("4981 · TP 86,500.0 · +$30.00");
  });

  it("keeps the sign on losses", () => {
    const label = ghostLabelText({ from: FROM, price: 86000, pnl: -12.5, priceDecimals: 1 });
    expect(label).toContain("TP 86,000.0");
    expect(label).toContain("-$12.50");
  });
});

describe("ghostColorFor", () => {
  it("is a side colour at 60 percent opacity, never color-mix", () => {
    expect(ghostColorFor("long")).toMatch(/^#[0-9a-fA-F]{6}99$/);
    expect(ghostColorFor("short")).toMatch(/^#[0-9a-fA-F]{6}99$/);
    expect(ghostColorFor("long").toLowerCase()).toBe("#2bd67b99");
    expect(ghostColorFor("short").toLowerCase()).toBe("#ff6b5799");
    expect(hexWithAlpha("#2BD67B", 0.6).toLowerCase()).toBe("#2bd67b99");
  });
});
