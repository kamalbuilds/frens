import type { Hex } from "viem";
import { explorerTxUrl, type Network } from "./network";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function isOnchainTxHash(hash: string | null | undefined): hash is Hex {
  return typeof hash === "string" && TX_HASH_RE.test(hash.trim());
}

export function acceptTxExplorerHref(network: Network, hash: string | null | undefined): string | null {
  if (!isOnchainTxHash(hash)) return null;
  return explorerTxUrl(network, hash.trim() as Hex);
}
