// Suggester callbook: puts the suggester on chain via OrderRequestV2.orderDescId.
//
// Verified on the live Perpl testnet on 2026-10-01 (spike/descid.test.ts,
// tx 0xfc48d1f8e6805b4cc02f9b0975024af3e435194932bcb18e66bf19b1f982e45b):
// the deployed Exchange emits OrderRequestV2, never OrderRequest (V1), and
// the V2 log carries orderId 0. The real orderId is emitted in the same
// transaction by OrderPlaced. So a call is rebuilt by joining V2 and Placed
// logs on transaction_hash, then marked "hit" when a MakerOrderFilled with
// that orderId exists in range.
//
// Suggestion orders pack the suggester address into the top 160 bits and the
// suggestion createdAt timestamp (ms) into the low 96 bits of the
// caller-chosen orderDescId, so anyone can rebuild a suggester's record of
// accepted calls and fills from logs alone. Ordinary orders use small ids
// whose top 160 bits are zero and decode to null.
import {
  decodeEventLog,
  getAddress,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import officialAbi from "./exchange-official.abi.json";
import { NETWORKS, type Network } from "./perpl";
import type { AbiEvent } from "viem";

const exchangeOfficialAbi = officialAbi as readonly AbiEvent[];

function eventAbi(name: string): AbiEvent {
  const found = exchangeOfficialAbi.find(
    (e) => e.type === "event" && e.name === name,
  );
  if (!found) throw new Error(`official Exchange ABI has no event ${name}`);
  return found;
}

export const ORDER_REQUEST_V2_TOPIC0 = toEventSelector(
  eventAbi("OrderRequestV2"),
) as Hex;

export const ORDER_PLACED_TOPIC0 = toEventSelector(
  eventAbi("OrderPlaced"),
) as Hex;

export const MAKER_ORDER_FILLED_TOPIC0 = toEventSelector(
  eventAbi("MakerOrderFilled"),
) as Hex;

export const HYPERSYNC_DEFAULT_URL = "https://monad.hypersync.xyz";

/// HyperSync base per network. Mainnet has a known endpoint; testnet goes
/// through HYPERSYNC_TESTNET_URL when set (server only), falling back to the
/// same default host so a missing override still queries real logs.
export function hypersyncUrlFor(network: Network): string {
  if (network === "mainnet") return HYPERSYNC_DEFAULT_URL;
  const override = process.env.HYPERSYNC_TESTNET_URL;
  return override && override.length > 0 ? override : HYPERSYNC_DEFAULT_URL;
}

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
// block_number, transaction_hash, data. All three events keep every argument
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

// Pure parser over recorded HyperSync responses: keep the OrderRequestV2 logs
// whose orderDescId decodes to this suggester, join each to the OrderPlaced
// log in the same transaction (the V2 log carries orderId 0; the Placed log
// carries the real orderId), then mark each "hit" when a MakerOrderFilled
// with the same orderId exists in range, else it stays "open/cancelled"
// (hit: false). OrderRequest (V1) logs are ignored: the deployed Exchange
// never emits them.
export function parseCallRecord(
  suggester: Address,
  orderResponses: HyperSyncResponse[],
  placedResponses: HyperSyncResponse[],
  fillResponses: HyperSyncResponse[],
): CallRecord {
  const want = suggester.toLowerCase();
  const orderLogs = orderResponses.flatMap((r) => r.data?.logs ?? r.logs ?? []);
  const placedLogs = placedResponses.flatMap((r) => r.data?.logs ?? r.logs ?? []);
  const fillLogs = fillResponses.flatMap((r) => r.data?.logs ?? r.logs ?? []);

  const filled = new Set<string>();
  for (const log of fillLogs) {
    try {
      const ev = decodeEventLog({
        abi: exchangeOfficialAbi,
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

  const orderIdByTx = new Map<string, bigint>();
  for (const log of placedLogs) {
    try {
      const ev = decodeEventLog({
        abi: exchangeOfficialAbi,
        data: log.data,
        topics: [ORDER_PLACED_TOPIC0],
      });
      if (ev.eventName !== "OrderPlaced") continue;
      const args = ev.args as unknown as { orderId: bigint };
      orderIdByTx.set(String(log.transaction_hash).toLowerCase(), args.orderId);
    } catch {
      continue;
    }
  }

  const calls: CallEntry[] = [];
  for (const log of orderLogs) {
    try {
      const ev = decodeEventLog({
        abi: exchangeOfficialAbi,
        data: log.data,
        topics: [ORDER_REQUEST_V2_TOPIC0],
      });
      if (ev.eventName !== "OrderRequestV2") continue;
      const args = ev.args as unknown as {
        perpId: bigint;
        orderDescId: bigint;
        pricePNS: bigint;
      };
      const decoded = decodeDescId(args.orderDescId);
      if (!decoded || decoded.suggester.toLowerCase() !== want) continue;
      const orderId = orderIdByTx.get(String(log.transaction_hash).toLowerCase());
      if (orderId === undefined) continue;
      const orderIdStr = orderId.toString();
      calls.push({
        orderId: orderIdStr,
        perpId: args.perpId.toString(),
        pricePNS: args.pricePNS.toString(),
        txHash: log.transaction_hash,
        block: log.block_number,
        hit: filled.has(orderIdStr),
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
  exchange: Address,
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
        logs: [{ address: [exchange], topics: [[topic0]] }],
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
  opts: { fromBlock: bigint; toBlock: bigint; hypersyncUrl?: string; token: string; network?: Network; exchange?: Address },
): Promise<CallRecord> {
  if (!opts.token) throw new Error("ENVIO_API_TOKEN missing");
  const network = opts.network ?? "testnet";
  const exchange = opts.exchange ?? NETWORKS[network].exchange;
  const url = opts.hypersyncUrl ?? hypersyncUrlFor(network);
  const [orderPages, placedPages, fillPages] = await Promise.all([
    queryLogs(url, opts.token, opts.fromBlock, opts.toBlock, ORDER_REQUEST_V2_TOPIC0, exchange),
    queryLogs(url, opts.token, opts.fromBlock, opts.toBlock, ORDER_PLACED_TOPIC0, exchange),
    queryLogs(url, opts.token, opts.fromBlock, opts.toBlock, MAKER_ORDER_FILLED_TOPIC0, exchange),
  ]);
  return parseCallRecord(suggester, orderPages, placedPages, fillPages);
}
