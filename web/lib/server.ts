import { NETWORKS, publicClient } from "./perpl";
import { readPerpMeta } from "./readPosition";

export const net = NETWORKS.mainnet;
// MONAD_RPC_URL (server only, never NEXT_PUBLIC): a private endpoint such as QuickNode; the public RPC otherwise.
export const client = publicClient("mainnet", process.env.MONAD_RPC_URL || undefined);

export type Market = { id: number; name: string; priceDecimals: number; lotDecimals: number };

/// Markets are the intersection of what Perpl's API lists and what our reader knows,
/// with decimals read from the Exchange contract itself so candles and positions
/// are scaled by the same number.
export async function markets(): Promise<Market[]> {
  const r = await fetch("https://app.perpl.xyz/api/v1/pub/context", { next: { revalidate: 3600 } });
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
export async function blockTime(block: bigint): Promise<number | null> {
  const k = block.toString();
  const hit = blockTimes.get(k);
  if (hit) return hit;
  try {
    const b = await client.getBlock({ blockNumber: block });
    const t = Number(b.timestamp);
    blockTimes.set(k, t);
    return t;
  } catch {
    return null;
  }
}
