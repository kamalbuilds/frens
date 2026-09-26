import { describe, expect, it } from "bun:test";
import type { Address } from "viem";
import type { Position } from "./readPosition";
import { encodeSuggestion, type Suggestion } from "./suggest";
import { acceptOwnerCheck, bannerText, evaluateSuggestion, suggestionKind } from "./acceptance";

const OWNER = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b" as Address;
const FROM = "0x4981053aA266D74f9914a74Ad8ED79014846Ace9" as Address;
const STRANGER = "0xE40825B2Aab7FfD3f1B6Ff18e7E2ACDAC1F8fd5D" as Address;
const MARKET = 1;
const CREATED_AT = 1758638400000;

function longPosition(over: Partial<Position> = {}): Position {
  return {
    account: OWNER,
    accountId: 6n,
    market: MARKET,
    symbol: "BTC",
    side: "long",
    size: 0.00179,
    entryPrice: 69742.2,
    markPrice: 83840.1,
    markValid: true,
    deposit: 41.6,
    deltaPnl: 25.2,
    fundingPnl: 0,
    unrealizedPnl: 25.2,
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
    price: 85000,
    sizeLots: undefined,
    from: FROM,
    createdAt: CREATED_AT,
    ...over,
  };
}

describe("evaluateSuggestion", () => {
  it("accepts a valid TP on a long with banner text", () => {
    const raw = encodeSuggestion(suggestion({ price: 85000 }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition(),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("valid");
    if (out.status !== "valid") throw new Error("expected valid");
    expect(out.kind).toBe("TP");
    expect(out.text).toContain("suggests a TP at");
    expect(out.text).toContain("long");
    // Signed PnL in parens: (price - entry) * size is positive here.
    expect(out.text).toMatch(/\(\+\$/);
  });

  it("rejects a TP below mark on a long with a reason", () => {
    const raw = encodeSuggestion(suggestion({ price: 80000 }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition(),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("stale");
    if (out.status !== "stale") throw new Error("expected stale");
    expect(out.reason).toMatch(/above/i);
    expect(suggestionKind(suggestion({ price: 80000 }), 83840.1)).toBe("SL");
  });

  it("rejects an owner mismatch with a reason", () => {
    const raw = encodeSuggestion(suggestion({ owner: STRANGER }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition(),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("stale");
    if (out.status !== "stale") throw new Error("expected stale");
    expect(out.reason).toMatch(/does not match/);
  });

  it("rejects a malformed payload without throwing", () => {
    for (const raw of ["", "!!!", "not-a-link!!", "null"]) {
      const out =
        raw === ""
          ? evaluateSuggestion(raw, { positionFor: () => longPosition(), priceDecimals: 1 })
          : evaluateSuggestion(raw, { positionFor: () => longPosition(), priceDecimals: 1 });
      if (raw === "") {
        expect(out.status).toBe("empty");
      } else {
        expect(out.status).toBe("malformed");
        if (out.status !== "malformed") throw new Error("expected malformed");
        expect(out.reason.length).toBeGreaterThan(0);
      }
    }
    expect(evaluateSuggestion(null, { positionFor: () => longPosition(), priceDecimals: 1 }).status).toBe("empty");
  });
});

describe("bannerText", () => {
  it("names the suggester, the owner, the side, and the signed PnL", () => {
    const text = bannerText(suggestion({ price: 85000 }), longPosition(), 1);
    expect(text).toContain("suggests a TP at");
    expect(text).toContain("long");
    expect(text).toMatch(/\(\+\$/);
  });
});

describe("acceptOwnerCheck", () => {
  it("only the owner can accept", () => {
    const s = suggestion();
    expect(acceptOwnerCheck(OWNER, s)).toEqual({ ok: true });
    const upper = acceptOwnerCheck(OWNER.toUpperCase().replace("0X", "0x"), s);
    expect(upper).toEqual({ ok: true });
    const other = acceptOwnerCheck(STRANGER, s);
    expect(other.ok).toBe(false);
    if (other.ok === false) expect(other.reason).toMatch(/Only .* can accept this/);
    const none = acceptOwnerCheck("", s);
    expect(none.ok).toBe(false);
  });
});
