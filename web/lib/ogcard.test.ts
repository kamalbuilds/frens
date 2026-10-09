import { describe, expect, it } from "bun:test";
import type { Address } from "viem";
import { buildCardData, callsByCaller, MAX_CARD_ROWS, ogImagePath, type CardPosition } from "./ogcard";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const C = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
const D = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;

function pos(account: string, pnl: number, side: "long" | "short" = "long", symbol = "BTC Perp"): CardPosition {
  return { account, side, pnl, symbol, markPrice: 86_678 };
}

describe("buildCardData rows", () => {
  it("sorts the strongest PnL first", () => {
    const { rows } = buildCardData({ accounts: [A, B, C], positions: [pos(A, -5), pos(B, 12), pos(C, 3)] });
    expect(rows.map((r) => r.account)).toEqual([B, C, A]);
    expect(rows.map((r) => r.pnl)).toEqual([12, 3, -5]);
  });

  it("caps at six rows and drops the weakest", () => {
    const many = Array.from({ length: 9 }, (_, i) => pos(`0x${i.toString(16).padStart(40, "0")}` as Address, i));
    const { rows, open } = buildCardData({ accounts: many.map((p) => p.account), positions: many });
    expect(MAX_CARD_ROWS).toBe(6);
    expect(rows.length).toBe(6);
    expect(rows.map((r) => r.pnl)).toEqual([8, 7, 6, 5, 4, 3]);
    // The cap is a layout choice, never a claim that the room is this size.
    expect(open).toBe(9);
  });

  it("applies nicknames and falls back to the short address", () => {
    const { rows } = buildCardData({
      accounts: [A, B],
      positions: [pos(A, 1), pos(B, 2)],
      names: new Map([[A.toLowerCase(), "ana"]]),
    });
    expect(rows.find((r) => r.account === A)?.name).toBe("ana");
    expect(rows.find((r) => r.account === B)?.name).toBe("BBBB");
  });

  it("counts verified calls per fren, case-insensitively", () => {
    const { rows } = buildCardData({
      accounts: [A, B],
      positions: [pos(A, 1), pos(B, 2)],
      calls: [{ caller: A.toUpperCase() }, { caller: A.toLowerCase() }],
    });
    expect(rows.find((r) => r.account === A)?.calls).toBe(2);
    expect(rows.find((r) => r.account === B)?.calls).toBe(0);
  });

  it("carries the latest accept tx hash for the share card", () => {
    const tx = "0x8489b2c28bf9d9861dfbb3429e5dde3257054b99aab100c64fd59ec2e2bc089a";
    const card = buildCardData({
      accounts: [A, B],
      positions: [pos(A, 1), pos(B, 2)],
      latestAcceptTx: tx,
    });
    expect(card.acceptTx).toBe(tx);
  });

  it("keeps side, symbol and mark on each row", () => {
    const { rows } = buildCardData({ accounts: [A], positions: [{ ...pos(A, -1, "short", "ETH Perp"), markPrice: 0.0204 }] });
    expect(rows[0]).toMatchObject({ side: "short", symbol: "ETH Perp", markPrice: 0.0204 });
  });

  it("leaves the input array order alone", () => {
    const positions = [pos(A, 1), pos(B, 99)];
    buildCardData({ accounts: [A, B], positions });
    expect(positions.map((p) => p.account)).toEqual([A, B]);
  });
});

describe("buildCardData market", () => {
  it("leads with the market most of the shown rows trade", () => {
    const { market, mixed, markPrice } = buildCardData({
      accounts: [A, B, C, D],
      positions: [
        pos(A, 50, "long", "BTC Perp"),
        pos(B, 40, "long", "ETH Perp"),
        pos(C, 30, "long", "BTC Perp"),
        pos(D, 20, "long", "BTC Perp"),
      ],
    });
    expect(market).toBe("BTC Perp");
    expect(mixed).toBe(true);
    expect(markPrice).toBe(86_678);
  });

  it("names the off-market rows instead of borrowing the headline", () => {
    const { rows } = buildCardData({
      accounts: [A, B],
      positions: [pos(A, 10, "long", "BTC Perp"), pos(B, 5, "long", "ETH Perp")],
    });
    expect(rows.find((r) => r.account === B)?.offMarket).toBe(true);
    expect(rows.find((r) => r.account === A)?.offMarket).toBe(false);
  });

  it("has no market and no price when nobody holds a position", () => {
    const { market, markPrice, mixed, rows } = buildCardData({ accounts: [A, B], positions: [] });
    expect(market).toBeNull();
    expect(markPrice).toBeNull();
    expect(mixed).toBe(false);
    expect(rows).toEqual([]);
  });

  it("counts the room, not the rows the card has room for", () => {
    const positions = Array.from({ length: 8 }, (_, i) => pos(`0x${i.toString(16).padStart(40, "0")}` as Address, i));
    const { traders, open } = buildCardData({ accounts: [...positions.map((p) => p.account), D], positions });
    expect(traders).toBe(9);
    expect(open).toBe(8);
  });

  it("carries live: false when positions could not be read", () => {
    expect(buildCardData({ accounts: [A], positions: [], live: false }).live).toBe(false);
    expect(buildCardData({ accounts: [A], positions: [] }).live).toBe(true);
  });
});

describe("callsByCaller", () => {
  it("tallies one entry per verified receipt", () => {
    const counts = callsByCaller([{ caller: A.toUpperCase() }, { caller: A.toLowerCase() }, { caller: B }]);
    expect(counts.get(A.toLowerCase())).toBe(2);
    expect(counts.get(B.toLowerCase())).toBe(1);
  });
});

describe("ogImagePath", () => {
  it("carries the network, the names and the call hashes the room shows", () => {
    const path = ogImagePath("abc123", "mainnet", "b379:ana", "0xabc,0xdef");
    expect(path.startsWith("/api/og/abc123?")).toBe(true);
    const q = new URLSearchParams(path.split("?")[1] as string);
    expect(q.get("net")).toBe("mainnet");
    expect(q.get("n")).toBe("b379:ana");
    expect(q.get("c")).toBe("0xabc,0xdef");
  });

  it("omits names and calls the room does not have", () => {
    expect(ogImagePath("abc123", "testnet")).toBe("/api/og/abc123?net=testnet");
    expect(ogImagePath("abc123", "testnet", "", "")).toBe("/api/og/abc123?net=testnet");
  });

  it("encodes separators so the card reads whole slots", () => {
    const q = new URLSearchParams(ogImagePath("abc123", "testnet", "b379:ana,bo,cy").split("?")[1] as string);
    expect(q.get("n")).toBe("b379:ana,bo,cy");
    expect((q.get("n") ?? "").split(",").length).toBe(3);
  });
});
