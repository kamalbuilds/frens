import { describe, expect, it } from "bun:test";
import { decodeRoom } from "./roomlink";
import { parseNamesParam } from "./names";
import { namesForAddresses } from "./names";
import {
  MAX_BUILDER_ROWS,
  STARTER_BUILDER_ROWS,
  buildRoomFromRows,
  roomPathForRows,
} from "./roombuilder";

const A = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b";
const B = "0x4981053aA266D74f9914a74Ad8ED79014846Ace9";
const C = "0x782a74e7f4ECF8dBE322A12009E71406512F8545";

describe("buildRoomFromRows", () => {
  it("starts with 3 rows capped at 12", () => {
    expect(STARTER_BUILDER_ROWS).toBe(3);
    expect(MAX_BUILDER_ROWS).toBe(12);
  });

  it("skips invalid rows and keeps the usable ones", () => {
    const build = buildRoomFromRows([
      { address: A, name: "ana" },
      { address: "not an address", name: "bogus" },
      { address: "", name: "empty" },
      { address: "0x1234", name: "short" },
      { address: B, name: "" },
    ]);
    expect(build.addresses).toEqual([A.toLowerCase(), B.toLowerCase()].sort());
  });

  it("removes duplicates case-insensitively, first name wins", () => {
    const build = buildRoomFromRows([
      { address: A, name: "ana" },
      { address: A.toUpperCase().replace("0X", "0x"), name: "other" },
      { address: `  ${A}  `, name: "padded" },
    ]);
    expect(build.addresses).toEqual([A.toLowerCase()]);
    expect(build.namesQuery).toBe(`${A.toLowerCase().slice(2, 6)}:ana`);
  });

  it("keys names to addresses so they survive room sorting", () => {
    const build = buildRoomFromRows([
      { address: B, name: "bo" },
      { address: A, name: "ana" },
      { address: C, name: "cy" },
    ]);
    const sorted = [A, B, C].map((a) => a.toLowerCase()).sort();
    expect(build.addresses).toEqual(sorted);
    const back = namesForAddresses(sorted, parseNamesParam(build.namesQuery));
    expect(back.get(A.toLowerCase())).toBe("ana");
    expect(back.get(B.toLowerCase())).toBe("bo");
    expect(back.get(C.toLowerCase())).toBe("cy");
  });

  it("drops unusable names but keeps the address", () => {
    const build = buildRoomFromRows([
      { address: A, name: "has,comma" },
      { address: B, name: "x".repeat(25) },
      { address: C, name: "cy" },
    ]);
    expect(build.addresses).toEqual([A, B, C].map((a) => a.toLowerCase()).sort());
    const back = namesForAddresses(build.addresses, parseNamesParam(build.namesQuery));
    expect(back.has(A.toLowerCase())).toBe(false);
    expect(back.has(B.toLowerCase())).toBe(false);
    expect(back.get(C.toLowerCase())).toBe("cy");
  });

  it("caps at 12 addresses", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      name: `fren${i + 1}`,
    }));
    const build = buildRoomFromRows(rows);
    expect(build.addresses).toHaveLength(12);
  });

  it("builds nothing from empty rows", () => {
    expect(buildRoomFromRows([])).toEqual({ addresses: [], namesQuery: "" });
    expect(buildRoomFromRows([{ address: "", name: "" }])).toEqual({ addresses: [], namesQuery: "" });
  });
});

describe("roomPathForRows", () => {
  it("builds a room link on the current network", () => {
    const path = roomPathForRows(
      [
        { address: A, name: "ana" },
        { address: B, name: "" },
      ],
      "testnet",
    );
    expect(path).not.toBeNull();
    const url = new URL(path as string, "https://frens.test");
    expect(url.pathname.startsWith("/r/")).toBe(true);
    expect(url.searchParams.get("net")).toBe("testnet");
    const code = url.pathname.slice("/r/".length);
    expect(decodeRoom(code)).toEqual([A.toLowerCase(), B.toLowerCase()].sort());
    const back = namesForAddresses(decodeRoom(code), parseNamesParam(url.searchParams.get("n")));
    expect(back.get(A.toLowerCase())).toBe("ana");
    expect(back.get(B.toLowerCase())).toBeUndefined();
  });

  it("returns null when no row is usable", () => {
    expect(roomPathForRows([], "testnet")).toBeNull();
    expect(roomPathForRows([{ address: "nope", name: "x" }], "mainnet")).toBeNull();
  });
});
