import { describe, expect, it } from "bun:test";
import { decodeRoom, encodeRoom } from "./roomlink";
import { roomLink } from "./network";
import {
  callLine,
  displayName,
  encodeNamesParam,
  namesForAddresses,
  parseNamesParam,
  sanitizeName,
} from "./names";
import { shortName, subtitleForMarket } from "./chart";

const A = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b";
const B = "0x4981053aA266D74f9914a74Ad8ED79014846Ace9";

describe("parseNamesParam", () => {
  it("splits ?n= into slots", () => {
    expect(parseNamesParam("ana,bo,cy")).toEqual(["ana", "bo", "cy"]);
  });

  it("keeps empty slots so positions stay aligned", () => {
    expect(parseNamesParam("ana,,cy")).toEqual(["ana", "", "cy"]);
  });

  it("parses missing or empty input to []", () => {
    expect(parseNamesParam(null)).toEqual([]);
    expect(parseNamesParam(undefined)).toEqual([]);
    expect(parseNamesParam("")).toEqual([]);
  });
});

describe("encodeNamesParam", () => {
  it("joins slots back, preserving empty positions", () => {
    expect(encodeNamesParam(["ana", "bo", "cy"])).toBe("ana,bo,cy");
    expect(encodeNamesParam(["ana", "", "cy"])).toBe("ana,,cy");
    expect(encodeNamesParam(["ana", null, undefined])).toBe("ana,,");
  });
});

describe("sanitizeName", () => {
  it("accepts a plain nickname", () => {
    expect(sanitizeName("ana")).toBe("ana");
    expect(sanitizeName("  bo  ")).toBe("bo");
  });

  it("rejects empty, overlong and comma names", () => {
    expect(sanitizeName("")).toBeNull();
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName(null)).toBeNull();
    expect(sanitizeName("a".repeat(25))).toBeNull();
    expect(sanitizeName("a,b")).toBeNull();
  });
});

describe("room link with names", () => {
  it("round trips addresses and names through the link", () => {
    const sorted = [A.toLowerCase(), B.toLowerCase()].sort();
    const code = encodeRoom([A, B]);
    expect(decodeRoom(code)).toEqual(sorted);
    // Names align to the room addresses in the same (sorted) order.
    const names = ["ana", "bo"];
    const link = roomLink(code, "testnet", encodeNamesParam(names));
    expect(link.startsWith(`/r/${code}?net=testnet&n=`)).toBe(true);
    const q = new URLSearchParams(link.split("?")[1] as string);
    const back = namesForAddresses(decodeRoom(code), parseNamesParam(q.get("n")));
    expect(back.get(sorted[0])).toBe("ana");
    expect(back.get(sorted[1])).toBe("bo");
  });

  it("skips unnamed slots", () => {
    const sorted = [A.toLowerCase(), B.toLowerCase()].sort();
    const by = namesForAddresses(sorted, ["ana", ""]);
    expect(by.get(sorted[0])).toBe("ana");
    expect(by.has(sorted[1])).toBe(false);
  });
});

describe("displayName", () => {
  it("shows the nickname instead of the address", () => {
    const by = namesForAddresses([A], ["ana"]);
    expect(displayName(A, by)).toBe("ana");
  });

  it("falls back to the 4-char address without a nickname", () => {
    const by = namesForAddresses([A], ["ana"]);
    expect(displayName(B, by)).toBe(shortName(B));
    expect(displayName(B)).toBe(shortName(B));
  });
});

describe("callLine", () => {
  it("hides when the fren has no accepted calls", () => {
    expect(callLine(0, 0)).toBeNull();
  });

  it("formats accepted and hit counts", () => {
    expect(callLine(2, 1)).toBe("2 calls taken · 1 hit");
    expect(callLine(1, 0)).toBe("1 calls taken · 0 hit");
  });
});

describe("subtitleForMarket", () => {
  it("reads '<name> on Perpl' with no 'perpetual'", () => {
    expect(subtitleForMarket("BTC Perp")).toBe("BTC Perp on Perpl");
    expect(subtitleForMarket("BTC Perp")).not.toContain("perpetual");
  });
});
