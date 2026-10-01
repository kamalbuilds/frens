/// Trustless call records: room links carry accepted-call transaction hashes
/// in ?c=, and each hash is verified against its own transaction receipt
/// instead of scanning logs (Perpl logs are unindexed and the HyperSync
/// token lacks access). A hash counts as an accepted call when its receipt
/// shows a successful transaction containing an OrderRequestV2 log from this
/// network's Exchange whose orderDescId decodes (decodeDescId) to a caller.
/// Hit detection (a later MakerOrderFilled for that order id) is out of
/// scope: receipts report accepted calls only.
import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import officialAbi from "./exchange-official.abi.json";
import { decodeDescId, ORDER_REQUEST_V2_TOPIC0 } from "./callbook";
import { NETWORKS, type Network } from "./perpl";
import { readPerpMeta } from "./readPosition";
import type { AbiEvent } from "viem";

const exchangeOfficialAbi = officialAbi as readonly AbiEvent[];

export const MAX_CALLS = 50;

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/// Split ?c= on commas, keeping only valid 32-byte transaction hashes, first
/// 50, deduped case-insensitively. Never throws: missing, empty or garbage
/// input parses to [].
export function parseCallsParam(value: string | null | undefined): Hex[] {
  if (typeof value !== "string" || value.length === 0) return [];
  const out: Hex[] = [];
  const seen = new Set<string>();
  for (const slot of value.split(",")) {
    const t = slot.trim();
    if (!HASH_RE.test(t)) continue;
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t as Hex);
    if (out.length >= MAX_CALLS) break;
  }
  return out;
}

/// Join verified call hashes back into ?c= form.
export function encodeCallsParam(hashes: (Hex | string)[]): string {
  return hashes.map((h) => h.trim()).join(",");
}

export type VerifiedCall = {
  hash: Hex;
  /// Suggester address packed in the OrderRequestV2 orderDescId.
  caller: Address;
  /// Account that sent the accept transaction (receipt from).
  owner: Address;
  /// Market the call was placed in, the OrderRequestV2 perpId.
  market: number;
  /// pricePNS from the OrderRequestV2 log, as a decimal string: the raw
  /// on-chain value, unscaled.
  pricePNS: string;
  block: number;
};

/// A verified call with its price in the market's own units, ready to format
/// like every other price in the app. Null only when that market's
/// priceDecimals could not be read, which is never silently replaced by a
/// guess.
export type PricedCall = VerifiedCall & { price: number | null };

type ReceiptLike = {
  status: string;
  from: string;
  blockNumber: bigint | number | string;
  logs: ReceiptLikeLog[] | readonly ReceiptLikeLog[];
};

type ReceiptLikeLog = {
  address: string;
  topics: Hex[] | readonly Hex[];
  data: Hex;
};

type ReceiptClient = {
  getTransactionReceipt: (args: { hash: Hex }) => Promise<ReceiptLike>;
};

// One verified call per hash, or null when the receipt shows anything but a
// successful accept: failed transaction, no OrderRequestV2 log from this
// network's Exchange, or an orderDescId that decodes to no caller (an
// ordinary self order).
async function verifyOne(
  net: Network,
  client: ReceiptClient,
  hash: Hex,
): Promise<VerifiedCall | null> {
  let receipt: ReceiptLike;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch {
    return null;
  }
  if (!receipt || receipt.status !== "success") return null;
  const exchange = NETWORKS[net].exchange.toLowerCase();
  const logs = (receipt.logs ?? []) as readonly ReceiptLikeLog[];
  for (const log of logs) {
    try {
      if (String(log.address ?? "").toLowerCase() !== exchange) continue;
      const topics = log.topics as readonly Hex[] as [Hex, ...Hex[]];
      if (!topics || topics.length === 0 || topics[0].toLowerCase() !== ORDER_REQUEST_V2_TOPIC0.toLowerCase()) continue;
      const ev = decodeEventLog({
        abi: exchangeOfficialAbi,
        data: log.data as Hex,
        topics,
      });
      if (ev.eventName !== "OrderRequestV2") continue;
      const args = ev.args as unknown as { perpId: bigint; orderDescId: bigint; pricePNS: bigint };
      const decoded = decodeDescId(args.orderDescId);
      if (!decoded) continue;
      return {
        hash,
        caller: decoded.suggester,
        owner: getAddress(receipt.from),
        market: Number(args.perpId),
        pricePNS: args.pricePNS.toString(),
        block: Number(receipt.blockNumber),
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function mapPool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/// Verify each hash against its own receipt, 8 receipts at a time. Hashes
/// beyond MAX_CALLS are ignored. Order is preserved; unverified hashes are
/// dropped.
export async function verifyCallReceipts(
  net: Network,
  hashes: (Hex | string)[],
  client: PublicClient,
): Promise<VerifiedCall[]> {
  const valid = hashes
    .map((h) => String(h).trim())
    .filter((h) => HASH_RE.test(h))
    .slice(0, MAX_CALLS) as Hex[];
  if (valid.length === 0) return [];
  const typed = client as unknown as ReceiptClient;
  const results = await mapPool(valid, 8, (h) => verifyOne(net, typed, h));
  return results.filter((r): r is VerifiedCall => r !== null);
}

/// Market-unit price from a raw PNS price: pricePNS / 10^priceDecimals, the
/// same scaling readPosition applies to entry and mark prices, so a call
/// price reads the same as the chart.
export function priceInMarketUnits(pricePNS: string | bigint, priceDecimals: number | bigint): number {
  return Number(pricePNS) / 10 ** Number(priceDecimals);
}

/// Price every verified call in its own market's units. Each distinct market's
/// decimals are read once (readPerpMeta caches per exchange and market, so a
/// later render pays nothing), and a market whose decimals cannot be read
/// leaves price null: the call still counts, but nobody gets a wrong number.
export async function priceCalls(
  calls: VerifiedCall[],
  client: PublicClient,
  exchange: Address,
): Promise<PricedCall[]> {
  const decimals = new Map<number, number | null>();
  for (const market of new Set(calls.map((c) => c.market))) {
    try {
      const meta = await readPerpMeta(client, exchange, market);
      decimals.set(market, Number(meta.priceDecimals));
    } catch {
      decimals.set(market, null);
    }
  }
  return calls.map((c) => {
    const d = decimals.get(c.market) ?? null;
    return { ...c, price: d === null ? null : priceInMarketUnits(c.pricePNS, d) };
  });
}
