import type { Hex } from "viem";
import { parseCallsParam, verifyCallReceipts, type VerifiedCall } from "@/lib/receipts";
import { parseNetParam } from "@/lib/network";
import { clientFor } from "@/lib/server";

type Cached = { at: number; call: VerifiedCall | null };

const cache = new Map<string, Cached>();

// 10-minute cache, one entry per network and hash.
const TTL_MS = 600_000;

function keyFor(net: string, hash: string): string {
  return `${net}:${hash.toLowerCase()}`;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const net = parseNetParam(u.searchParams);
  const hashes = parseCallsParam(u.searchParams.get("c"));
  const now = Date.now();

  const fresh = new Map<string, VerifiedCall>();
  const missing: Hex[] = [];
  for (const h of hashes) {
    const hit = cache.get(keyFor(net, h));
    if (hit && now - hit.at < TTL_MS) {
      if (hit.call) fresh.set(h.toLowerCase(), hit.call);
    } else {
      missing.push(h);
    }
  }

  try {
    if (missing.length > 0) {
      const client = clientFor(net);
      const verified = await verifyCallReceipts(net, missing, client);
      const byHash = new Map(verified.map((v) => [v.hash.toLowerCase(), v]));
      for (const h of missing) {
        const v = byHash.get(h.toLowerCase()) ?? null;
        cache.set(keyFor(net, h), { at: now, call: v });
        if (v) fresh.set(h.toLowerCase(), v);
      }
    }
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }

  // Verified calls only, in link order. Hit detection is out of scope: every
  // entry is an accepted call whose fill state is unknown.
  const calls = hashes
    .map((h) => fresh.get(h.toLowerCase()))
    .filter((c): c is VerifiedCall => c !== undefined);
  return Response.json({ net, calls });
}
