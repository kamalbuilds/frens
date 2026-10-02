import { describe, expect, it } from "bun:test";
import { decodeFunctionData, erc20Abi } from "viem";
import { CALL_STAKE, CALL_STAKE_READ, callStakeAbi, stakeCalls, stakeId, stakeView } from "./callstake";
import { NETWORKS } from "./perpl";

const CY = "0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD" as const;
// The first real stake (tx 0xc6913d2e): cy's call on bo, id read back from chain.
const DESC = 0x4eb664f1e9b7c812ddfbc4118326fe3e23b7dced00000000000001a0fc2741f3n;

describe("callstake", () => {
  it("keys a stake by the call's orderDescId, as the deployed stake shows", () => {
    expect(stakeId(DESC)).toBe("0x4eb664f1e9b7c812ddfbc4118326fe3e23b7dced00000000000001a0fc2741f3");
  });
  it("approves exactly the stake to CallStake, then stakes the resting order", () => {
    const [approve, stake] = stakeCalls("testnet", { orderDescId: DESC, caller: CY, market: 16, orderId: "138" }, 2, 1_800_000_000);
    expect(approve!.to).toBe(NETWORKS.testnet.collateral);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([CALL_STAKE.testnet!, 2_000_000n]);
    const d = decodeFunctionData({ abi: callStakeAbi, data: stake!.data });
    expect(d.functionName).toBe("stake");
    expect(d.args).toEqual([stakeId(DESC), CY, 2_000_000n, 16n, 138n, 1_800_000_000n]);
  });
  it("refuses mainnet and empty stakes", () => {
    expect(() => stakeCalls("mainnet", { orderDescId: DESC, caller: CY, market: 1, orderId: "1" }, 2, 1)).toThrow();
    expect(() => stakeCalls("testnet", { orderDescId: DESC, caller: CY, market: 16, orderId: "1" }, 0, 1)).toThrow();
  });
  it("writes to v2 and reads v2 then v1, so v1 stakes keep showing", () => {
    expect(CALL_STAKE_READ.testnet![0]).toBe(CALL_STAKE.testnet!);
    expect(CALL_STAKE_READ.testnet!.length).toBe(2);
  });
  it("reads the stakes tuple", () => {
    expect(stakeView(["0x0", CY, 2_000_000n, 1_800_000_000n, 16, false, 2, 861170n])).toEqual({ state: "paid", amount: 2, caller: CY, expiry: 1_800_000_000 });
  });
});
