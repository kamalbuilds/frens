import { describe, expect, it } from "bun:test";
import { callBoard } from "./callboard";

const ANA = "0xb3790F7EBa6bd875714bBeD7e3f9F303871F0CCC";
const CY = "0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD";
const BO = "0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244";

describe("callBoard", () => {
  it("groups by caller case-insensitively and ranks hits before calls taken", () => {
    const rows = callBoard([
      { caller: ANA, hit: false },
      { caller: ANA.toLowerCase(), hit: false },
      { caller: CY, hit: false },
      { caller: CY, hit: true },
      { caller: BO },
    ]);
    expect(rows.map((r) => [r.caller, r.taken, r.hit])).toEqual([
      [CY, 2, 1],
      [ANA, 2, 0],
      [BO, 1, 0],
    ]);
  });
  it("is empty for a room with no verified calls", () => {
    expect(callBoard([])).toEqual([]);
  });
});
