import { describe, expect, it } from "bun:test";
import { decodeRoom, encodeRoom } from "./roomlink";

const ONE = ["0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b"];
const FIVE = [
  "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b",
  "0x4981053aA266D74f9914a74Ad8ED79014846Ace9",
  "0x782a74e7f4ECF8dBE322A12009E71406512F8545",
  "0x6e02B9B38Fa8190C77d7B465eD224556f4fd5162",
  "0x356F12D80Cb7cfae58a6CDA6CEF62BECacD4aE85",
];
const TWENTY = Array.from({ length: 20 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);

describe("encodeRoom round trip", () => {
  it("round trips 1 address", () => {
    const code = encodeRoom(ONE);
    expect(code.length).toBeGreaterThan(0);
    expect(decodeRoom(code)).toEqual([ONE[0].toLowerCase()]);
  });
  it("round trips 5 addresses", () => {
    const code = encodeRoom(FIVE);
    expect(decodeRoom(code)).toEqual([...FIVE.map((a) => a.toLowerCase())].sort());
  });
  it("round trips 20 addresses", () => {
    const code = encodeRoom(TWENTY);
    expect(decodeRoom(code)).toEqual([...TWENTY].sort());
  });
});

describe("encodeRoom canonical form", () => {
  it("order and case do not change the code", () => {
    const a = encodeRoom(FIVE);
    const b = encodeRoom([...FIVE].reverse().map((x) => x.toUpperCase().replace("0X", "0x")));
    expect(b).toBe(a);
  });
  it("duplicates collapse", () => {
    expect(encodeRoom([FIVE[0], FIVE[0].toLowerCase(), FIVE[1]])).toBe(encodeRoom([FIVE[0], FIVE[1]]));
    expect(decodeRoom(encodeRoom([FIVE[0], FIVE[0], FIVE[1]]))).toEqual(
      [FIVE[0].toLowerCase(), FIVE[1].toLowerCase()].sort(),
    );
  });
  it("output is URL-safe with no padding or hex prefix", () => {
    const code = encodeRoom(TWENTY);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code).not.toContain("=");
    expect(code).not.toContain("+");
    expect(code).not.toContain("/");
  });
});

describe("decodeRoom rejects", () => {
  it("garbage decodes to []", () => {
    expect(decodeRoom("!!!not-a-room!!!")).toEqual([]);
    expect(decodeRoom("hello world")).toEqual([]);
    expect(decodeRoom("")).toEqual([]);
  });
  it("a 19-byte address payload decodes to []", () => {
    const nineteen = new Uint8Array(19);
    for (let i = 0; i < 19; i++) nineteen[i] = i + 1;
    const hex19 = `0x${Array.from(nineteen, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    expect(hex19.slice(2).length).toBe(38);
    expect(decodeRoom(hex19)).toEqual([]);
    const raw = Buffer.from(hex19.slice(2), "hex").toString("base64url");
    expect(decodeRoom(raw)).toEqual([]);
  });
  it("more than 20 is rejected", () => {
    const many = Array.from({ length: 21 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
    expect(() => encodeRoom(many)).toThrow();
    const raw = Buffer.from(many.map((a) => a.slice(2)).join(""), "hex").toString("base64url");
    expect(decodeRoom(raw)).toEqual([]);
  });
});
