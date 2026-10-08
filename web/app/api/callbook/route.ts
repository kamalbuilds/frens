import { isAddress, type Address } from "viem";
import { fetchCallRecord, type CallRecord } from "@/lib/callbook";
import { parseNetParam } from "@/lib/network";
import { clientFor } from "@/lib/server";

export const maxDuration = 30;

// Monad produces a block every 0.3 s: 288_000 blocks per day.
const BLOCKS_PER_DAY = 288_000;

type Cached = { at: number; body: CallRecord & { suggester: string; fromBlock: string; toBlock: string; source: "hypersync" } };

const cache = new Map<string, Cached>();
// Last HyperSync failure: a denied token is not retried for every face on every load.
let failedAt = 0;

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
  if (hit && Date.now() - hit.at < 600_000) return Response.json(hit.body);

  // Full call history needs HyperSync: Perpl logs are unindexed, and an RPC log scan took 35 s per
  // caller on mainnet for 13 minutes of history. Without it the room's ?c= receipts carry the record.
  const token = process.env.ENVIO_API_TOKEN;
  if (token && Date.now() - failedAt > 600_000) {
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
      failedAt = Date.now();
      return Response.json({ error: "call history unavailable" }, { status: 503 });
    }
  }
  return Response.json({ error: "no call index configured" }, { status: 503 });
}
