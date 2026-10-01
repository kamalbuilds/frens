import { isAddress, type Address } from "viem";
import { fetchCallRecord, fetchCallRecordRpc, RPC_LOOKBACK_BLOCKS, type CallRecord } from "@/lib/callbook";
import { parseNetParam } from "@/lib/network";
import { clientFor } from "@/lib/server";

// Monad produces a block every 0.3 s: 288_000 blocks per day.
const BLOCKS_PER_DAY = 288_000;

type Cached = { at: number; body: CallRecord & { suggester: string; fromBlock: string; toBlock: string; source: "hypersync" | "rpc" } };

const cache = new Map<string, Cached>();

export async function GET(req: Request) {
  const u = new URL(req.url);
  const suggester = u.searchParams.get("suggester") ?? "";
  const days = Number(u.searchParams.get("days") ?? 30);
  const net = parseNetParam(u.searchParams);
  if (!isAddress(suggester)) return Response.json({ error: `not an address: ${suggester}` }, { status: 400 });
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return Response.json({ error: `bad days param: ${u.searchParams.get("days")}` }, { status: 400 });
  }

  const key = `${net}:${suggester.toLowerCase()}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.body);

  // HyperSync first when a token is configured; a missing or rejected token
  // falls through to the RPC path so the callbook works without Envio.
  const token = process.env.ENVIO_API_TOKEN;
  if (token) {
    try {
      const client = clientFor(net);
      const latest = await client.getBlockNumber();
      const span = BigInt(Math.ceil(days * BLOCKS_PER_DAY));
      const fromBlock = latest > span ? latest - span : 0n;
      const record = await fetchCallRecord(suggester as Address, { fromBlock, toBlock: latest, token, network: net });
      const body = { suggester, fromBlock: fromBlock.toString(), toBlock: latest.toString(), source: "hypersync" as const, ...record };
      cache.set(key, { at: Date.now(), body });
      return Response.json(body);
    } catch {
      // Fall through to the RPC path below.
    }
  }

  try {
    const client = clientFor(net);
    const latest = await client.getBlockNumber();
    const fromBlock = latest > RPC_LOOKBACK_BLOCKS ? latest - RPC_LOOKBACK_BLOCKS : 0n;
    const record = await fetchCallRecordRpc(suggester as Address, { network: net, client, fromBlock, toBlock: latest });
    const body = { suggester, fromBlock: fromBlock.toString(), toBlock: latest.toString(), source: "rpc" as const, ...record };
    cache.set(key, { at: Date.now(), body });
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
