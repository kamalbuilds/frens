// Suggester callbook: puts the suggester on chain via OrderRequest.orderDescId.
//
// Perpl's Exchange emits OrderRequest(perpId, accountId, orderDescId, orderId,
// orderType, pricePNS, lotLNS, ...) for every order, and orderDescId is a free
// uint256 chosen by the caller (see src/exchange.abi.json). Suggestion orders
// pack the suggester address into the top 160 bits and the suggestion
// createdAt timestamp (ms) into the low 96 bits, so anyone can rebuild a
// suggester's record of accepted calls and fills from logs alone. Ordinary
// orders use small ids whose top 160 bits are zero and decode to null.
import {
  decodeEventLog,
  getAddress,
  getEventSelector,
  type Address,
  type Hex,
} from "viem";
import { exchangeAbi, NETWORKS } from "./perpl";

export const EXCHANGE_ADDRESS = NETWORKS.mainnet.exchange;

export const ORDER_REQUEST_TOPIC0 = getEventSelector(
  (exchangeAbi as readonly unknown[]).find(
    (e) => typeof e === "object" && e !== null && (e as { type?: string }).type === "event" && (e as { name?: string }).name === "OrderRequest",
  ) as never,
) as Hex;

export const MAKER_ORDER_FILLED_TOPIC0 = getEventSelector(
  (exchangeAbi as readonly unknown[]).find(
    (e) => typeof e === "object" && e !== null && (e as { type?: string }).type === "event" && (e as { name?: string }).name === "MakerOrderFilled",
  ) as never,
) as Hex;

export const HYPERSYNC_DEFAULT_URL = "https://monad.hypersync.xyz";

const LOW_MASK = (1n << 96n) - 1n;

// Pack a suggestion (suggester + createdAt ms) into a caller-chosen
// orderDescId. BigInt(Address) parses the hex address into its 160-bit value.
export function suggestionDescId(suggester: Address, createdAtMs: number): bigint {
  return (BigInt(suggester) << 96n) | (BigInt(createdAtMs) & LOW_MASK);
}

// Split an orderDescId back into suggester + createdAt. Returns null for
// ordinary orders whose top 160 bits are zero.
export function decodeDescId(id: bigint): { suggester: Address; createdAtMs: number } | null {
  const top = id >> 96n;
  if (top === 0n) return null;
  const suggester = getAddress(`0x${top.toString(16).padStart(40, "0")}`);
  return { suggester, createdAtMs: Number(id & LOW_MASK) };
}

export type CallEntry = {
  orderId: string;
  perpId: string;
  pricePNS: string;
  txHash: Hex;
  block: number;
  hit: boolean;
};

export type CallRecord = {
  accepted: number;
  hit: number;
  calls: CallEntry[];
};

// Raw HyperSync log row with the field_selection this module queries:
// block_number, transaction_hash, data. Both events keep every argument
// non-indexed, so topics are always exactly [topic0] and decodeEventLog only
// needs the per-query topic0 plus the returned data.
export type HyperSyncLog = {
  block_number: number;
  transaction_hash: Hex;
  data: Hex;
  [k: string]: unknown;
};

export type HyperSyncResponse = {
  data?: { logs?: HyperSyncLog[] };
  logs?: HyperSyncLog[];
  next_block?: number | string;
  nextBlock?: number | string;
};

// Pure parser over recorded HyperSync responses: keep the OrderRequest logs
// whose orderDescId decodes to this suggester, then mark each "hit" when a
// MakerOrderFilled with the same orderId exists in range, else it stays
// "open/cancelled" (hit: false).
export function parseCallRecord(
  suggester: Address,
  orderResponses: HyperSyncResponse[],
  fillResponses: HyperSyncResponse[],
): CallRecord {
  const want = suggester.toLowerCase();
  const orderLogs = orderResponses.flatMap((r) => r.data?.logs ?? r.logs ?? []);
  const fillLogs = fillResponses.flatMap((r) => r.data?.logs ?? r.logs ?? []);

  const filled = new Set<string>();
  for (const log of fillLogs) {
    try {
      const ev = decodeEventLog({
        abi: exchangeAbi,
        data: log.data,
        topics: [MAKER_ORDER_FILLED_TOPIC0],
      });
      if (ev.eventName !== "MakerOrderFilled") continue;
      const args = ev.args as unknown as { orderId: bigint };
      filled.add(args.orderId.toString());
    } catch {
      continue;
    }
  }

  const calls: CallEntry[] = [];
  for (const log of orderLogs) {
    try {
      const ev = decodeEventLog({ abi: exchangeAbi, data: log.data, topics: [ORDER_REQUEST_TOPIC0] });
      if (ev.eventName !== "OrderRequest") continue;
      const args = ev.args as unknown as {
        perpId: bigint;
        orderDescId: bigint;
        orderId: bigint;
        pricePNS: bigint;
      };
      const decoded = decodeDescId(args.orderDescId);
      if (!decoded || decoded.suggester.toLowerCase() !== want) continue;
      const orderId = args.orderId.toString();
      calls.push({
        orderId,
        perpId: args.perpId.toString(),
        pricePNS: args.pricePNS.toString(),
        txHash: log.transaction_hash,
        block: log.block_number,
        hit: filled.has(orderId),
      });
    } catch {
      continue;
    }
  }
  calls.sort((a, b) => a.block - b.block);
  return { accepted: calls.length, hit: calls.filter((c) => c.hit).length, calls };
}

// Page one HyperSync logs query from cursor to toBlock, following the
// response's next_block until it reaches toBlock.
async function queryLogs(
  hypersyncUrl: string,
  token: string,
  fromBlock: bigint,
  toBlock: bigint,
  topic0: Hex,
): Promise<HyperSyncResponse[]> {
  const pages: HyperSyncResponse[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const res = await fetch(`${hypersyncUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from_block: Number(cursor),
        to_block: Number(toBlock),
        logs: [{ address: [EXCHANGE_ADDRESS], topics: [[topic0]] }],
        field_selection: { log: ["block_number", "transaction_hash", "data"] },
      }),
    });
    if (!res.ok) throw new Error(`HyperSync query returned ${res.status}`);
    const page = (await res.json()) as HyperSyncResponse;
    pages.push(page);
    const raw = page.next_block ?? page.nextBlock;
    if (raw === undefined || raw === null) break;
    const next = BigInt(raw);
    if (next <= cursor || next > toBlock) break;
    cursor = next;
  }
  return pages;
}

export async function fetchCallRecord(
  suggester: Address,
  opts: { fromBlock: bigint; toBlock: bigint; hypersyncUrl?: string; token: string },
): Promise<CallRecord> {
  if (!opts.token) throw new Error("ENVIO_API_TOKEN missing");
  const url = opts.hypersyncUrl ?? HYPERSYNC_DEFAULT_URL;
  const [orderPages, fillPages] = await Promise.all([
    queryLogs(url, opts.token, opts.fromBlock, opts.toBlock, ORDER_REQUEST_TOPIC0),
    queryLogs(url, opts.token, opts.fromBlock, opts.toBlock, MAKER_ORDER_FILLED_TOPIC0),
  ]);
  return parseCallRecord(suggester, orderPages, fillPages);
}
