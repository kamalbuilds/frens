import type { Hex } from "viem";
import { isCallsOrder, parseCallsParam, priceCalls, verifyCallReceipts, type PricedCall, type VerifiedCall } from "@/lib/receipts";
import { parseNetParam } from "@/lib/network";
import { NETWORKS, exchangeAbi } from "@/lib/perpl";
import { apiBaseFor, clientFor, markets } from "@/lib/server";
import { scaleCandle, type RawCandle } from "@/lib/chart";
import { callHit } from "@/lib/callhit";
import { CALL_STAKE, callStakeAbi, stakeId, stakeView } from "@/lib/callstake";

export const maxDuration = 30;

type Cached = { at: number; call: VerifiedCall | null };

const cache = new Map<string, Cached>();

// 10-minute cache, one entry per network and hash.
const TTL_MS = 600_000;

// True hits cached forever: a hit never un-hits.
const hitCache = new Map<string, true>();

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

  const client = clientFor(net);
  try {
    if (missing.length > 0) {
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

  // Verified calls only, in link order. "price" is the pricePNS scaled
  // into that market's own units, "pricePNS" the raw value. "hit" is true
  // when 15m candles after the accept block reached the call's TP price.
  const verifiedInOrder = hashes
    .map((h) => fresh.get(h.toLowerCase()))
    .filter((c): c is VerifiedCall => c !== undefined);
  const calls: PricedCall[] = await priceCalls(verifiedInOrder, client, NETWORKS[net].exchange);

  let decimals = new Map<number, number>();
  try {
    const listed = await markets(net);
    decimals = new Map(listed.map((m) => [m.id, m.priceDecimals]));
  } catch {
    decimals = new Map();
  }

  // Still on Perpl's book: same order id, same close type, lots left. A filled or cancelled TP reads false.
  // Still on Perpl's book as THIS call's order: Perpl recycles order ids, so type, price and owner account must
  // match too (isCallsOrder). A filled, cancelled or recycled id reads false.
  const bases = new Map<number, Promise<bigint>>();
  const baseOf = (market: number) => {
    if (!bases.has(market)) {
      bases.set(market, client
        .readContract({ address: NETWORKS[net].exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(market)] })
        .then((p) => BigInt((p as { basePricePNS: bigint }).basePricePNS)));
    }
    return bases.get(market)!;
  };
  const restingOf = async (c: PricedCall): Promise<boolean> => {
    if (c.orderId === null) return false;
    try {
      const [o, base, acct] = await Promise.all([
        client.readContract({ address: NETWORKS[net].exchange, abi: exchangeAbi, functionName: "getOrderV2", args: [BigInt(c.market), BigInt(c.orderId)] }),
        baseOf(c.market),
        client
          .readContract({ address: NETWORKS[net].exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [c.owner] })
          .then((a) => BigInt((a as { accountId: bigint }).accountId), () => 0n),
      ]);
      return isCallsOrder(o as Parameters<typeof isCallsOrder>[0], c, base, acct);
    } catch {
      return false;
    }
  };

  const withHits = await Promise.all(
    calls.map(async (c) => {
      const key = keyFor(net, c.hash);
      if (hitCache.get(key)) return { ...c, hit: true };
      if (c.price === null) return { ...c, hit: false };
      try {
        const block = await client.getBlock({ blockNumber: BigInt(c.block) });
        const blockSec = Number(block.timestamp);
        const priceDecimals = decimals.get(c.market);
        if (priceDecimals === undefined) return { ...c, hit: false };
        const blockMs = blockSec * 1000;
        const r = await fetch(`${apiBaseFor(net)}/market-data/${c.market}/candles/900/${blockMs}-${Date.now()}`, {
          cache: "no-store",
        });
        if (!r.ok) return { ...c, hit: false };
        const body = (await r.json()) as { d: RawCandle[] };
        const candles = body.d.map((raw) => scaleCandle(raw, priceDecimals));
        const hit = callHit(c.orderType, c.price as number, candles, blockSec, 900);
        if (hit) hitCache.set(key, true);
        return { ...c, hit };
      } catch {
        return { ...c, hit: false };
      }
    }),
  );
  // The call's stake, if its owner backed it in CallStake (testnet): staked, paid to the caller, or refunded.
  const stakeOf = async (c: PricedCall) => {
    const addr = CALL_STAKE[net];
    if (!addr) return null;
    try {
      const v = stakeView((await client.readContract({ address: addr, abi: callStakeAbi, functionName: "stakes", args: [stakeId(c.orderDescId)] })) as unknown[]);
      return v.state === "none" ? null : v;
    } catch {
      return null;
    }
  };
  const out = await Promise.all(withHits.map(async (c) => ({ ...c, resting: await restingOf(c), stake: await stakeOf(c) })));
  return Response.json({ net, calls: out });
}
