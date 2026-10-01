/// Room activity over Monad monadLogs push.
////
//// Verified on testnet 2026-10-02 (spikes/perpl-call-feed FINDINGS):
//// subscribe with eth_subscribe ["monadLogs", {address: <net exchange>,
//// topics: [[OrderRequestV2 topic0]]}] and decode each log with
//// decodeEventLog against web/lib/exchange-official.abi.json. Keep a log when
//// its accountId resolves to a room member, or when its orderDescId decodes
//// (decodeDescId) to a room member as caller.
////
//// accountId resolves to an address through getAccountById, once per id and
//// cached, so a busy room does not fan out one RPC call per log.
import {
  decodeEventLog,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import officialAbiJson from "./exchange-official.abi.json";
import { decodeDescId } from "./callbook";
import { NETWORKS, publicClient, type Network } from "./perpl";
import type { Abi } from "viem";

const officialAbi = officialAbiJson as unknown as Abi;
const officialEvents = officialAbi as unknown as AbiEvent[];

function eventAbi(name: string): AbiEvent {
  const found = officialEvents.find((e) => e.type === "event" && e.name === name);
  if (!found) throw new Error(`official Exchange ABI has no event ${name}`);
  return found;
}

export const ORDER_REQUEST_V2_ABI = eventAbi("OrderRequestV2");

export function orderRequestV2Topic(): Hex {
  return toEventSelector(ORDER_REQUEST_V2_ABI) as Hex;
}

export const ROOM_WS_URL: Record<Network, string> = {
  mainnet: "wss://rpc.monad.xyz",
  testnet: "wss://testnet-rpc.monad.xyz",
};

export type RoomSide = "long" | "short";

export type RoomFeedEvent = {
  kind: "call-accepted" | "order";
  /// The suggester packed into orderDescId, when it is a room member.
  caller?: Address;
  owner: Address;
  price: number;
  side: RoomSide;
  /// Commit identity of the log that produced the event.
  txHash: Hex | null;
  blockNumber: string | null;
  accountId: string;
};

export type DecodedOrder = {
  perpId: bigint;
  accountId: bigint;
  orderDescId: bigint;
  orderId: bigint;
  orderType: number;
  pricePNS: bigint;
};

/// Even order types are long (OPEN_LONG 0, CLOSE_LONG 2), odd are short
/// (OPEN_SHORT 1, CLOSE_SHORT 3), matching lib/suggest.ts.
export function sideOf(orderType: number): RoomSide {
  return orderType % 2 === 0 ? "long" : "short";
}

/// Decode one OrderRequestV2 log. Returns null for anything else, never
/// throws, so a foreign log on the same socket cannot break the feed.
export function decodeRoomLog(data: Hex, topics: Hex[]): DecodedOrder | null {
  try {
    const ev = decodeEventLog({
      abi: [ORDER_REQUEST_V2_ABI],
      data,
      topics: topics as [`0x${string}`, ...`0x${string}`[]],
    });
    if (ev.eventName !== "OrderRequestV2") return null;
    const a = ev.args as unknown as {
      perpId: bigint;
      accountId: bigint;
      orderDescId: bigint;
      orderId: bigint;
      orderType: number;
      pricePNS: bigint;
    };
    if (
      typeof a.perpId !== "bigint" ||
      typeof a.accountId !== "bigint" ||
      typeof a.orderDescId !== "bigint" ||
      typeof a.orderType !== "number" ||
      typeof a.pricePNS !== "bigint"
    )
      return null;
    return {
      perpId: a.perpId,
      accountId: a.accountId,
      orderDescId: a.orderDescId,
      orderId: typeof a.orderId === "bigint" ? a.orderId : 0n,
      orderType: a.orderType,
      pricePNS: a.pricePNS,
    };
  } catch {
    return null;
  }
}

function memberSet(members: readonly string[]): Set<string> {
  return new Set(members.map((m) => m.toLowerCase()));
}

/// Pure membership decision: the owner's account against the room list, or
/// the descId caller against it. Returns the event kind or null to ignore.
export function decideRoomKind(opts: {
  owner: Address;
  caller: Address | null;
  members: readonly string[];
}): "call-accepted" | "order" | null {
  const set = memberSet(opts.members);
  const ownerIn = set.has(opts.owner.toLowerCase());
  // A caller equal to the owner is the trader's own order (copy orders carry the copied fren, own opens
  // carry the trader), not a call someone else made.
  const selfCall = opts.caller !== null && opts.caller.toLowerCase() === opts.owner.toLowerCase();
  const callerIn = !selfCall && opts.caller !== null && set.has(opts.caller.toLowerCase());
  if (ownerIn && callerIn) return "call-accepted";
  if (ownerIn) return "order";
  if (callerIn) return "call-accepted";
  return null;
}

/// Build the feed event for one decoded log with its resolved owner. Null
/// when neither the owner nor the descId caller is a room member.
export function buildRoomEvent(opts: {
  decoded: DecodedOrder;
  owner: Address;
  members: readonly string[];
  priceDecimals: number;
  txHash?: Hex | null;
  blockNumber?: string | null;
}): RoomFeedEvent | null {
  const caller = decodeDescId(opts.decoded.orderDescId)?.suggester ?? null;
  const kind = decideRoomKind({ owner: opts.owner, caller, members: opts.members });
  if (!kind) return null;
  const scale = 10 ** opts.priceDecimals;
  return {
    kind,
    ...(caller && kind === "call-accepted" ? { caller } : {}),
    owner: opts.owner,
    price: Number(opts.decoded.pricePNS) / scale,
    side: sideOf(opts.decoded.orderType),
    txHash: opts.txHash ?? null,
    blockNumber: opts.blockNumber ?? null,
    accountId: opts.decoded.accountId.toString(),
  };
}

/// Subscribe frame for the room feed.
export function roomSubscribeMessage(id: number, exchange: Address): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "eth_subscribe",
    params: ["monadLogs", { address: exchange, topics: [[orderRequestV2Topic()]] }],
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type RoomLog = {
  data: Hex;
  topics: Hex[];
  txHash: Hex | null;
  blockNumber: string | null;
};

/// Pull the log out of an eth_subscription notification. Null for acks and
/// anything that is not a log notification.
export function extractRoomLog(msg: unknown): RoomLog | null {
  if (!isRecord(msg)) return null;
  const params = msg.params;
  if (!isRecord(params)) return null;
  const result = params.result;
  if (!isRecord(result)) return null;
  const data = typeof result.data === "string" ? (result.data as Hex) : null;
  const topics = Array.isArray(result.topics)
    ? (result.topics.filter((t) => typeof t === "string") as Hex[])
    : null;
  if (!data || !topics || topics.length === 0) return null;
  const txHash =
    typeof result.transactionHash === "string" ? (result.transactionHash as Hex) : null;
  const blockNumber =
    typeof result.blockNumber === "string" ? (result.blockNumber as string) : null;
  return { data, topics, txHash, blockNumber };
}

/// Backoff for reconnects: 1 s doubling to a 15 s cap.
export function roomBackoffFor(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(15_000, 1000 * 2 ** Math.min(n, 4));
}

export type RoomFeedOpts = {
  net: Network;
  /// Room members, or a getter returning them so the socket need not
  /// reconnect when the room list changes.
  members: readonly string[] | (() => readonly string[]);
  priceDecimals: number;
  onEvent: (event: RoomFeedEvent) => void;
  /// Override account resolution in tests.
  resolveAccount?: (accountId: bigint) => Promise<Address | null>;
  createSocket?: (url: string) => WebSocket;
};

/// accountId -> address for the room members, one getAccountByAddr per member. Members without a Perpl
/// account are left out; a failed read is retried on the next members change instead of being cached.
async function resolveMemberIds(net: Network, members: Address[]): Promise<Map<string, Address>> {
  const client = publicClient(net);
  const out = new Map<string, Address>();
  await Promise.all(
    members.map(async (addr) => {
      try {
        const acc = (await client.readContract({
          address: NETWORKS[net].exchange,
          abi: officialAbi,
          functionName: "getAccountByAddr",
          args: [addr],
        })) as unknown as { accountId?: bigint };
        if (acc?.accountId && acc.accountId > 0n) out.set(acc.accountId.toString(), addr);
      } catch {
        // no Perpl account yet
      }
    }),
  );
  return out;
}

const accountCache = new Map<string, Address | null>();

export function clearRoomAccountCache(): void {
  accountCache.clear();
}

async function defaultResolveAccount(net: Network, accountId: bigint): Promise<Address | null> {
  const key = `${net}:${accountId.toString()}`;
  if (accountCache.has(key)) return accountCache.get(key) ?? null;
  try {
    const client = publicClient(net);
    const info = (await client.readContract({
      address: NETWORKS[net].exchange,
      abi: officialAbi,
      functionName: "getAccountById",
      args: [accountId],
    })) as unknown as { accountAddr?: Address };
    const addr = info?.accountAddr ?? null;
    const out = addr && !/^0x0{40}$/i.test(addr) ? addr : null;
    accountCache.set(key, out);
    return out;
  } catch {
    accountCache.set(key, null);
    return null;
  }
}

/// Open the monadLogs socket for OrderRequestV2 on this network's Exchange.
/// Resolves each accountId once (cached), filters to room members and calls
/// onEvent. Reconnects with backoff until closed. Returns a close function.
export function subscribeRoomFeed(opts: RoomFeedOpts): () => void {
  const create = opts.createSocket ?? ((url: string) => new WebSocket(url));
  let closed = false;
  let attempt = 0;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let subId = 0;

  const membersOf = (): readonly string[] =>
    typeof opts.members === "function" ? opts.members() : opts.members;

  let idsKey = "";
  let ids: Promise<Map<string, Address>> = Promise.resolve(new Map());
  const memberIds = (): Promise<Map<string, Address>> => {
    const members = membersOf().map((m) => m.toLowerCase()).sort();
    const key = members.join(",");
    if (key !== idsKey) {
      idsKey = key;
      ids = resolveMemberIds(opts.net, members as Address[]);
    }
    return ids;
  };

  // monadLogs pushes each log once per commit stage (Proposed, Voted, Finalized): emit it once.
  const seen = new Set<string>();
  const handleLog = async (log: RoomLog) => {
    if (closed) return;
    const key = `${log.txHash ?? ""}:${log.data.slice(0, 200)}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 5000) seen.clear();
    const decoded = decodeRoomLog(log.data, log.topics);
    if (!decoded) return;
    // Match against the room's own account ids, resolved once per member. Resolving every log's account
    // over RPC (about 70 logs a second on testnet) got rate-limited and cached the failures as "no owner",
    // so no room event ever matched (browser test 2026-10-02).
    let owner: Address | null;
    try {
      owner = opts.resolveAccount
        ? await opts.resolveAccount(decoded.accountId)
        : (await memberIds()).get(decoded.accountId.toString()) ?? null;
    } catch {
      return;
    }
    if (!owner || closed) return;
    const event = buildRoomEvent({
      decoded,
      owner,
      members: membersOf(),
      priceDecimals: opts.priceDecimals,
      txHash: log.txHash,
      blockNumber: log.blockNumber,
    });
    if (event) opts.onEvent(event);
  };

  const open = () => {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = create(ROOM_WS_URL[opts.net]);
    } catch {
      schedule();
      return;
    }
    ws = socket;
    try {
      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        subId += 1;
        try {
          socket.send(roomSubscribeMessage(subId, NETWORKS[opts.net].exchange));
        } catch {
          // A failed send drops to onclose/onerror and the backoff path.
        }
      };
      socket.onmessage = (ev: MessageEvent) => {
        if (closed) return;
        const raw = typeof ev.data === "string" ? ev.data : null;
        if (!raw) return;
        let msg: unknown;
        try {
          msg = JSON.parse(raw) as unknown;
        } catch {
          return;
        }
        const log = extractRoomLog(msg);
        if (log) void handleLog(log);
      };
      const down = () => {
        if (closed) return;
        try {
          socket.close();
        } catch {
          // Already down.
        }
        schedule();
      };
      socket.onclose = down;
      socket.onerror = down;
    } catch {
      schedule();
    }
  };

  const schedule = () => {
    if (closed) return;
    const wait = roomBackoffFor(attempt);
    attempt += 1;
    if (timer) clearTimeout(timer);
    timer = setTimeout(open, wait);
  };

  open();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      // Closing a dead socket is fine.
    }
    ws = null;
  };
}
