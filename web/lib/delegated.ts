import { parseAbi, type Address, type PublicClient } from "viem";
import { NETWORKS, type Network } from "./perpl";

export const DELEGATED_FACTORY: Record<Network, Address> = {
  testnet: "0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209",
  mainnet: "0xc535276e3e446e4f28d95ed27ccd5c32e4c8907a",
};

export const delegatedAccountAbi = parseAbi([
  "function owner() view returns (address)",
  "function isOperator(address operator) view returns (bool)",
  "function accountId() view returns (uint256)",
  "function exchange() view returns (address)",
  "function operatorAllowlist(bytes4 selector) view returns (bool)",
  "function setOperatorAllowlist(bytes4 selector, bool allowed) external",
]);

/** Current Perpl Exchange execOrder / execOrders selectors (OrderDesc with maxNegPnlCollatBPS). */
export const DELEGATED_OPERATOR_GRANT_SELECTORS = ["0x4d8dc985", "0x39435dac"] as const;

/** Stale selectors from pre-maxNegPnlCollatBPS Exchange ABI; revoke after upgrade. */
export const DELEGATED_OPERATOR_REVOKE_SELECTORS = ["0x6b69ebbe", "0xaf3176da"] as const;

export async function delegatedExecOrderAllowedForOperator(client: PublicClient, proxy: Address): Promise<boolean> {
  return (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "operatorAllowlist",
    args: [DELEGATED_OPERATOR_GRANT_SELECTORS[0]],
  })) as boolean;
}

const REGISTRY_PREFIX = "chartroom:delegated:v1";

function registryKey(network: Network, owner: Address): string {
  return `${REGISTRY_PREFIX}:${network}:${owner.toLowerCase()}`;
}

export function readDelegatedProxyFromRegistry(network: Network, owner: Address): Address | null {
  const fromEnv = process.env.CHARTROOM_DELEGATED_PROXY?.trim();
  const envOwner = process.env.CHARTROOM_DELEGATED_OWNER?.trim().toLowerCase();
  if (fromEnv && /^0x[0-9a-fA-F]{40}$/.test(fromEnv) && envOwner === owner.toLowerCase()) {
    return fromEnv as Address;
  }
  if (typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(registryKey(network, owner));
    return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;
  } catch {
    return null;
  }
}

export function writeDelegatedProxyToRegistry(network: Network, owner: Address, proxy: Address): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(registryKey(network, owner), proxy);
}

export async function readDelegatedAccountOwner(client: PublicClient, proxy: Address): Promise<Address> {
  return (await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "owner" })) as Address;
}

export async function readIsDelegatedOperator(client: PublicClient, proxy: Address, operator: Address): Promise<boolean> {
  return (await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "isOperator", args: [operator] })) as boolean;
}

export async function validateDelegatedProxyForOwner(
  client: PublicClient,
  network: Network,
  owner: Address,
  proxy: Address,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const onChainOwner = await readDelegatedAccountOwner(client, proxy);
    if (onChainOwner.toLowerCase() !== owner.toLowerCase()) {
      return { ok: false, reason: "That delegated account does not belong to the suggestion owner." };
    }
    const ex = (await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "exchange" })) as Address;
    if (ex.toLowerCase() !== NETWORKS[network].exchange.toLowerCase()) {
      return { ok: false, reason: "That delegated account is wired to a different Perpl exchange." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not read that delegated account on chain." };
  }
}
