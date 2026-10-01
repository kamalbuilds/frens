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
  type PublicClient,
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

// RPC fallback when HyperSync has no token: the same three events read with
// eth_getLogs in 1,000-block chunks. Server clients go through QuickNode,
// which caps a single eth_getLogs call at a 1,000-block range, so the range
// is split first and chunks run 4 at a time. 429s retry with backoff; any
// other error throws immediately. Parsing reuses parseCallRecord: each
// chunk's viem logs are reshaped into the HyperSync row shape (block_number,
// transaction_hash, data) and the join/fill logic is identical.
// 200 blocks: Perpl testnet emits enough OrderRequestV2 that 1,000 blocks exceeded viem's 10 MB response cap (measured 2026-10-02).
export const RPC_CHUNK_BLOCKS = 200n;
export const RPC_CONCURRENCY = 10;
// The RPC fallback only covers recent calls: Perpl logs are unindexed, so a wide window means downloading
// every order on the venue (40,000 testnet blocks did not finish in 280 s). Full history is HyperSync's job.
export const RPC_LOOKBACK_BLOCKS = 2_000n;

type RpcLog = { blockNumber: bigint; transactionHash: Hex; data: Hex };

function chunkRanges(fromBlock: bigint, toBlock: bigint): Array<{ from: bigint; to: bigint }> {
  const out: Array<{ from: bigint; to: bigint }> = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + RPC_CHUNK_BLOCKS - 1n > toBlock ? toBlock : start + RPC_CHUNK_BLOCKS - 1n;
    out.push({ from: start, to: end });
    start = end + 1n;
  }
  return out;
}

function isRateLimited(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === 429) return true;
  const msg = String(e instanceof Error ? `${e.message} ${(e as Error & { cause?: unknown }).cause ?? ""}` : e);
  return /429|rate.?limit|too many requests/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getLogsChunk(
  client: PublicClient,
  args: { address: Address; event: AbiEvent; fromBlock: bigint; toBlock: bigint },
  attempts = 5,
): Promise<RpcLog[]> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const logs = await client.getLogs({
        address: args.address,
        event: args.event,
        fromBlock: args.fromBlock,
        toBlock: args.toBlock,
      });
      return (logs ?? []).map((l) => ({
        blockNumber: BigInt(l.blockNumber),
        transactionHash: l.transactionHash as Hex,
        data: (l as { data: Hex }).data,
      }));
    } catch (e) {
      last = e;
      if (!isRateLimited(e) || i === attempts - 1) throw e;
      await sleep(250 * 2 ** i);
    }
  }
  throw last;
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

async function fetchTopicRpc(
  client: PublicClient,
  exchange: Address,
  name: "OrderRequestV2" | "OrderPlaced" | "MakerOrderFilled",
  fromBlock: bigint,
  toBlock: bigint,
): Promise<HyperSyncResponse[]> {
  const event = eventAbi(name);
  const ranges = chunkRanges(fromBlock, toBlock);
  if (ranges.length === 0) return [];
  const pages = await mapPool(ranges, RPC_CONCURRENCY, async (r) => {
    const logs = await getLogsChunk(client, { address: exchange, event, fromBlock: r.from, toBlock: r.to });
    return logs.map((l) => ({
      block_number: Number(l.blockNumber),
      transaction_hash: l.transactionHash,
      data: l.data,
    }));
  });
  const all = pages.flat();
  return all.length > 0 ? [{ data: { logs: all } }] : [];
}

export async function fetchCallRecordRpc(
  suggester: Address,
  opts: { network?: Network; client: PublicClient; fromBlock: bigint; toBlock: bigint; exchange?: Address },
): Promise<CallRecord> {
  const network = opts.network ?? "testnet";
  const exchange = opts.exchange ?? NETWORKS[network].exchange;
  if (opts.fromBlock > opts.toBlock) return { accepted: 0, hit: 0, calls: [] };
  const [orders, placed, fills] = await Promise.all([
    fetchTopicRpc(opts.client, exchange, "OrderRequestV2", opts.fromBlock, opts.toBlock),
    fetchTopicRpc(opts.client, exchange, "OrderPlaced", opts.fromBlock, opts.toBlock),
    fetchTopicRpc(opts.client, exchange, "MakerOrderFilled", opts.fromBlock, opts.toBlock),
  ]);
  return parseCallRecord(suggester, orders, placed, fills);
}
