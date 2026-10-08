import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import type { Position } from "./readPosition";
import { encodeSuggestion, type Suggestion } from "./suggest";
import { acceptOwnerCheck, alreadyTaken, bannerText, evaluateSuggestion, suggestionKind } from "./acceptance";

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

  it("rejects a TP below mark on a long with a plain sentence", () => {
    const raw = encodeSuggestion(suggestion({ price: 80000 }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition(),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("stale");
    if (out.status !== "stale") throw new Error("expected stale");
    expect(out.reason).toContain("80,000.0");
    expect(out.reason).toContain("83,840.1");
    expect(out.reason).toMatch(/below the current price/);
    expect(out.reason).toMatch(/right away at the current price/);
    expect(out.reason).not.toMatch(/must be above/);
    expect(out.reason).not.toMatch(/got 80000/);
    expect(suggestionKind(suggestion({ price: 80000 }), 83840.1)).toBe("SL");
  });

  it("words the browser case exactly: TP below mark closes the long right away", () => {
    const raw = encodeSuggestion(suggestion({ price: 70000 }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition({ markPrice: 84008.9 }),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("stale");
    if (out.status !== "stale") throw new Error("expected stale");
    expect(out.reason).toBe(
      "This take-profit (70,000.0) is below the current price (84,008.9), so it would close F91B's long right away at the current price instead of waiting for the target.",
    );
  });

  it("rejects a short TP above mark with formatted prices", () => {
    const raw = encodeSuggestion(suggestion({ side: "short", price: 85000 }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition({ side: "short", markPrice: 83840.1 }),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("stale");
    if (out.status !== "stale") throw new Error("expected stale");
    expect(out.reason).toContain("85,000.0");
    expect(out.reason).toContain("83,840.1");
    expect(out.reason).toMatch(/above the current price/);
    expect(out.reason).toMatch(/short right away at the current price/);
  });

  it("rejects an owner mismatch with a plain sentence", () => {
    const raw = encodeSuggestion(suggestion({ owner: STRANGER }));
    const out = evaluateSuggestion(raw, {
      positionFor: () => longPosition(),
      priceDecimals: 1,
      lotDecimals: 5,
    });
    expect(out.status).toBe("stale");
    if (out.status !== "stale") throw new Error("expected stale");
    expect(out.reason).toMatch(/cannot be applied here/);
    expect(out.reason).not.toMatch(/does not match/);
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

  it("shows room nicknames instead of the 4-char address", () => {
    const nameFor = (a: string) =>
      a.toLowerCase() === FROM.toLowerCase() ? "ana" : a.toLowerCase() === OWNER.toLowerCase() ? "cy" : a;
    const text = bannerText(suggestion({ price: 85000 }), longPosition(), 1, nameFor);
    expect(text).toContain("ana suggests a TP at");
    expect(text).toContain("cy's long");
    expect(evaluateSuggestion(encodeSuggestion(suggestion({ price: 85000 })), {
      positionFor: () => longPosition(),
      priceDecimals: 1,
      lotDecimals: 5,
      nameFor,
    }).status).toBe("valid");
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

describe("stop-loss wallet Accept dispatch", () => {
  it("uses the injected wallet enrollment and forwarding path instead of the TP close signer", () => {
    const source = readFileSync(new URL("../app/SuggestionBanner.tsx", import.meta.url), "utf8");
    const walletAccept = source.match(/async function doAccept\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    const stopLossAccept = source.match(/async function acceptStopLoss\(who: "wallet" \| "passkey"\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";

    expect(walletAccept).toMatch(/if \(suggestion\.kind === "sl"\) return acceptStopLoss\("wallet"\);/);
    expect(stopLossAccept).toContain("placeStopLossFor({");
    expect(stopLossAccept).toContain("signTypedDataInjected(owner as Address");
    expect(stopLossAccept).toContain("sendExecOrder(to, data, network)");
  });
});

describe("alreadyTaken", () => {
  it("a resting close at the call's price is the call already taken", () => {
    expect(alreadyTaken([{ price: 81765 }], 81765, 1)).toBe(true);
    expect(alreadyTaken([{ price: 81765.04 }], 81765, 1)).toBe(true);
  });
  it("a resting close one tick away, or none, is not", () => {
    expect(alreadyTaken([{ price: 81765.1 }], 81765, 1)).toBe(false);
    expect(alreadyTaken([], 81765, 1)).toBe(false);
  });
});
