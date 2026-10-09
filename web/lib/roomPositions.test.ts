import { describe, expect, it } from "bun:test";
import {
  normalizeRoomAccounts,
  roomPositionsKey,
  roomPositionsUrl,
  shouldFetchRoomPositions,
} from "./roomPositions";

describe("shouldFetchRoomPositions", () => {
  it("fetches for frens view with a positive market id even if the catalog is still loading", () => {
    expect(shouldFetchRoomPositions("frens", 16)).toBe(true);
    expect(shouldFetchRoomPositions("live", 16)).toBe(false);
    expect(shouldFetchRoomPositions("frens", 0)).toBe(false);
  });
});

describe("roomPositionsKey", () => {
  it("lowercases addresses so checksum changes do not retrigger a foreground load", () => {
    const a = "0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244";
    const b = "0x91427a5de167e2fc7693ce4f0f0784a5695b6244";
    expect(roomPositionsKey(16, [a], "testnet")).toBe(roomPositionsKey(16, [b], "testnet"));
  });
});

describe("roomPositionsUrl", () => {
  it("includes normalized accounts", () => {
    const u = roomPositionsUrl(16, ["0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244"], "testnet");
    expect(u).toContain("market=16");
    expect(u).toContain("0x91427a5de167e2fc7693ce4f0f0784a5695b6244");
  });
});

describe("normalizeRoomAccounts", () => {
  it("drops empty strings", () => {
    expect(normalizeRoomAccounts([" 0xabc ", ""])).toEqual(["0xabc"]);
  });
});
