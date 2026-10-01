import { isAddress, type Address } from "viem";
import { fetchCallRecord, type CallRecord } from "@/lib/callbook";
import { client } from "@/lib/server";

// Monad produces a block every 0.3 s: 288_000 blocks per day.
const BLOCKS_PER_DAY = 288_000;

type Cached = { at: number; body: CallRecord & { suggester: string; fromBlock: string; toBlock: string } };

const cache = new Map<string, Cached>();

export async function GET(req: Request) {
  const u = new URL(req.url);
  const suggester = u.searchParams.get("suggester") ?? "";
  const days = Number(u.searchParams.get("days") ?? 30);
  if (!isAddress(suggester)) return Response.json({ error: `not an address: ${suggester}` }, { status: 400 });
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return Response.json({ error: `bad days param: ${u.searchParams.get("days")}` }, { status: 400 });
  }
  const token = process.env.ENVIO_API_TOKEN;
  if (!token) return Response.json({ error: "ENVIO_API_TOKEN missing" }, { status: 503 });

  const key = `${suggester.toLowerCase()}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.body);

  try {
    const latest = await client.getBlockNumber();
    const span = BigInt(Math.ceil(days * BLOCKS_PER_DAY));
    const fromBlock = latest > span ? latest - span : 0n;
    const record = await fetchCallRecord(suggester as Address, { fromBlock, toBlock: latest, token });
    const body = { suggester, fromBlock: fromBlock.toString(), toBlock: latest.toString(), ...record };
    cache.set(key, { at: Date.now(), body });
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
