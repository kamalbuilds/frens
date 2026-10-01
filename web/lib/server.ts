import { NETWORKS, publicClient, type Network } from "./perpl";
import { API_BASES } from "./network";
import { readPerpMeta } from "./readPosition";
import type { PublicClient } from "viem";

/// One server client per network. Mainnet uses MONAD_RPC_URL when set
/// (QuickNode, server only, never NEXT_PUBLIC); testnet uses the public
/// testnet RPC. No module-level client: every caller names its network.
export function clientFor(network: Network): PublicClient {
  // Private endpoints (QuickNode), server only: MONAD_RPC_URL for mainnet, MONAD_TESTNET_RPC_URL for testnet.
  const rpc = (network === "mainnet" ? process.env.MONAD_RPC_URL : process.env.MONAD_TESTNET_RPC_URL) || undefined;
  return publicClient(network, rpc);
}

export function apiBaseFor(network: Network): string {
  return API_BASES[network];
}

export type Market = { id: number; name: string; priceDecimals: number; lotDecimals: number };

/// Markets are the intersection of what that network's Perpl API lists and
/// what our reader knows, with decimals read from that network's Exchange
/// contract itself so candles and positions are scaled by the same number.
export async function markets(network: Network): Promise<Market[]> {
  const net = NETWORKS[network];
  const client = clientFor(network);
  const r = await fetch(`${API_BASES[network]}/pub/context`, { next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`Perpl context returned ${r.status}`);
  const ctx = (await r.json()) as { markets: { id: number; name: string }[] };
  const known = new Set<number>(net.markets);
  const listed = ctx.markets.filter((m) => known.has(m.id));
  return Promise.all(
    listed.map(async (m) => {
      const meta = await readPerpMeta(client, net.exchange, m.id);
      return { id: m.id, name: m.name, priceDecimals: Number(meta.priceDecimals), lotDecimals: Number(meta.lotDecimals) };
    }),
  );
}

const blockTimes = new Map<string, number>();

/// Entry blocks are fixed history, so their timestamps are cached forever.
/// The cache key includes the network: block N on testnet is not block N on
/// mainnet.
export async function blockTime(network: Network, block: bigint): Promise<number | null> {
  const k = `${network}:${block.toString()}`;
  const hit = blockTimes.get(k);
  if (hit) return hit;
  try {
    const b = await clientFor(network).getBlock({ blockNumber: block });
    const t = Number(b.timestamp);
    blockTimes.set(k, t);
    return t;
  } catch {
    return null;
  }
}
