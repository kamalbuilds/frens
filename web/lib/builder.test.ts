import { describe, expect, it } from "bun:test";
import { decodeAbiParameters } from "viem";
import { builderExtension, FRENS_BUILDER_ID } from "./builder";

describe("builderExtension", () => {
  it("is abi.encode(uint16 1, abi.encode(uint256 id, uint256 fee)), as the dex-sdk encodes it", () => {
    const [version, payload] = decodeAbiParameters([{ type: "uint16" }, { type: "bytes" }], builderExtension(FRENS_BUILDER_ID, 50));
    expect(version).toBe(1);
    expect(decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], payload)).toEqual([23n, 50n]);
  });
  it("stays under the decoder's 256-byte cap", () => {
    expect((builderExtension(23, 1000).length - 2) / 2).toBeLessThanOrEqual(256);
  });
  it("refuses an id or fee the contract would reject", () => {
    expect(() => builderExtension(0, 0)).toThrow();
    expect(() => builderExtension(256, 0)).toThrow();
    expect(() => builderExtension(23, 1001)).toThrow();
  });
});
