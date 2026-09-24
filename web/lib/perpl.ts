import { createPublicClient, http, type Abi, type Address, type PublicClient } from "viem";
import abi from "./exchange.abi.json";

export const exchangeAbi = abi as Abi;

// Values from docs.perpl.xyz/resources/for-developers/networks-and-configuration.md
export const NETWORKS = {
  mainnet: {
    chainId: 143,
    rpc: "https://rpc.monad.xyz",
    exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F" as Address,
    collateral: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" as Address,
    markets: [1, 10, 20, 31, 40, 50],
  },
  testnet: {
    chainId: 10143,
    rpc: "https://testnet-rpc.monad.xyz",
    exchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc" as Address,
    collateral: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Address,
    markets: [16, 32, 48, 64, 256],
  },
} as const;

export type Network = keyof typeof NETWORKS;

export const COLLATERAL_DECIMALS = 6;

export function publicClient(network: Network, rpc?: string): PublicClient {
  return createPublicClient({
    transport: http(rpc ?? NETWORKS[network].rpc, { retryCount: 5, retryDelay: 400 }),
  }) as PublicClient;
}
