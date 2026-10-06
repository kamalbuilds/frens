// First trade from a wallet Perpl has never seen: Perpl needs an exchange account funded with aUSD before any
// order. Same two calls the demo seed makes: approve the Exchange, then createAccount with the deposit.
import { type Abi, BaseError, ContractFunctionRevertedError, encodeFunctionData, erc20Abi, type Address, type Hex, type PublicClient } from "viem";
import { NETWORKS, exchangeAbi, type Network } from "./perpl";
import officialAbi from "./exchange-official.abi.json";

export const AUSD_DECIMALS = 6;

export function toAusdUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`deposit must be a positive aUSD amount, got ${String(amount)}`);
  return BigInt(Math.round(amount * 10 ** AUSD_DECIMALS));
}

export function depositCalls(net: Network, units: bigint): { to: Address; data: Hex }[] {
  const { exchange, collateral } = NETWORKS[net];
  return [
    { to: collateral, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [exchange, units] }) },
    { to: exchange, data: encodeFunctionData({ abi: exchangeAbi, functionName: "createAccount", args: [units] }) },
  ];
}

// Perpl reverts getAccountByAddr (selector 0x03a0e277) for an address it has never seen, rather than
// returning id 0. That revert means "no account"; an RPC failure still throws.
export async function hasPerplAccount(client: PublicClient, net: Network, addr: Address): Promise<boolean> {
  try {
    const a = (await client.readContract({ address: NETWORKS[net].exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [addr] })) as { accountId: bigint };
    return BigInt(a.accountId) > 0n;
  } catch (e) {
    if (e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError)) return false;
    throw e;
  }
}

// Testnet only: Agora's aUSD faucet sends 10,000 test aUSD to any address per call (requestFunds, selector
// 0x544c7cf9). The caller pays gas, so a wallet needs a little MON first (faucet.monad.xyz).
export const TESTNET_AUSD_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Address;
export const TESTNET_MON_FAUCET_URL = "https://faucet.monad.xyz";
export const FAUCET_AUSD = 10_000;
const faucetAbi = [{ type: "function", name: "requestFunds", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] }] as const;

export function faucetCall(net: Network, to: Address): { to: Address; data: Hex } {
  if (net !== "testnet") throw new Error("test aUSD exists only on Monad testnet");
  return { to: TESTNET_AUSD_FAUCET, data: encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [to] }) };
}

export async function ausdBalance(client: PublicClient, net: Network, addr: Address): Promise<bigint> {
  return client.readContract({ address: NETWORKS[net].collateral, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
}

// Perpl's own floor for opening an account (InsufficentAmountToOpenAccount below it): 100 aUSD on testnet,
// 10 on mainnet when read on 2026-10-02. Read live, never hardcoded.
export async function minAccountOpen(client: PublicClient, net: Network): Promise<bigint> {
  return (await client.readContract({
    address: NETWORKS[net].exchange,
    abi: officialAbi as Abi,
    functionName: "getMinAccountOpenCNS",
  })) as bigint;
}
