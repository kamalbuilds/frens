import { describe, expect, it } from "bun:test";
import { decodeFunctionData, erc20Abi } from "viem";
import { TESTNET_AUSD_FAUCET, depositCalls, faucetCall, toAusdUnits } from "./onboard";
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

describe("faucetCall", () => {
  it("asks Agora's testnet faucet to fund exactly the given address", () => {
    const to = "0x93D456d73dDfC64fA8dCAb7e78a13Fd19ae1750a";
    const call = faucetCall("testnet", to);
    expect(call.to).toBe(TESTNET_AUSD_FAUCET);
    expect(call.data.slice(0, 10)).toBe("0x544c7cf9");
    expect(`0x${call.data.slice(-40)}`.toLowerCase()).toBe(to.toLowerCase());
  });
  it("refuses mainnet, where aUSD is real money", () => {
    expect(() => faucetCall("mainnet", "0x93D456d73dDfC64fA8dCAb7e78a13Fd19ae1750a")).toThrow(/only on Monad testnet/);
  });
});
