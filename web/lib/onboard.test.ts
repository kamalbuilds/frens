import { describe, expect, it } from "bun:test";
import { decodeFunctionData, erc20Abi } from "viem";
import { depositCalls, toAusdUnits } from "./onboard";
import { NETWORKS, exchangeAbi } from "./perpl";

describe("depositCalls", () => {
  it("approves the Exchange for the deposit, then creates the account with it, in that order", () => {
    const [approve, create] = depositCalls("testnet", toAusdUnits(50));
    expect(approve!.to).toBe(NETWORKS.testnet.collateral);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([NETWORKS.testnet.exchange, 50_000_000n]);
    expect(create!.to).toBe(NETWORKS.testnet.exchange);
    const c = decodeFunctionData({ abi: exchangeAbi, data: create!.data });
    expect(c.functionName).toBe("createAccount");
    expect(c.args).toEqual([50_000_000n]);
  });
  it("targets mainnet's own token and Exchange on mainnet", () => {
    const [approve, create] = depositCalls("mainnet", 1n);
    expect(approve!.to).toBe(NETWORKS.mainnet.collateral);
    expect(create!.to).toBe(NETWORKS.mainnet.exchange);
  });
  it("refuses a zero or negative deposit", () => {
    expect(() => toAusdUnits(0)).toThrow();
    expect(() => toAusdUnits(-5)).toThrow();
    expect(toAusdUnits(12.5)).toBe(12_500_000n);
  });
});
