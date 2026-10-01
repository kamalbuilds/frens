import { describe, expect, it } from "bun:test";
import {
  encodeAbiParameters,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  decodeDescId,
  fetchCallRecordRpc,
  MAKER_ORDER_FILLED_TOPIC0,
  ORDER_PLACED_TOPIC0,
  ORDER_REQUEST_V2_TOPIC0,
  parseCallRecord,
  suggestionDescId,
  type HyperSyncLog,
  type HyperSyncResponse,
  RPC_CHUNK_BLOCKS,
} from "./callbook";
import officialAbi from "./exchange-official.abi.json";

const FRIEND = "0x4981053aC0000000000000000000000000000001" as Address;
const STRANGER = "0xe40825b200000000000000000000000000000003" as Address;
const CREATED_AT = 1758638400000;

const official = officialAbi as Abi;

function eventInputs(name: string) {
  const e = official.find((x) => x.type === "event" && x.name === name);
  if (!e || e.type !== "event") throw new Error(`event ${name} missing from official ABI`);
  return e.inputs;
}

function eventAbi(name: string): AbiEvent {
  const e = official.find((x) => x.type === "event" && x.name === name);
  if (!e || e.type !== "event") throw new Error(`event ${name} missing from official ABI`);
  return e as AbiEvent;
}

// The deployed Exchange emits OrderRequestV2 with orderId 0; the real orderId
// arrives in the same transaction via OrderPlaced. Both logs share the
// transaction hash, which is what parseCallRecord joins on.
function orderV2Log(args: {
  perpId: bigint;
  accountId: bigint;
  orderDescId: bigint;
  orderType: number;
  pricePNS: bigint;
  block: number;
  tx: Hex;
}): HyperSyncLog {
  const data = encodeAbiParameters(eventInputs("OrderRequestV2"), [
    args.perpId,
    args.accountId,
    args.orderDescId,
    0n,
    args.orderType,
    args.pricePNS,
    179n,
    0n,
    true,
    false,
    false,
    0n,
    300n,
    0n,
    0n,
    1000n,
    0n,
    "0x" as Hex,
  ]);
  return { block_number: args.block, transaction_hash: args.tx, data };
}

function placedLog(orderId: bigint, block: number, tx: Hex): HyperSyncLog {
  const data = encodeAbiParameters(eventInputs("OrderPlaced"), [
    orderId,
    179n,
    0n,
    0n,
    0n,
  ]);
  return { block_number: block, transaction_hash: tx, data };
}

function orderV1Log(args: {
  perpId: bigint;
  accountId: bigint;
  orderDescId: bigint;
  orderId: bigint;
  orderType: number;
  pricePNS: bigint;
  block: number;
  tx: Hex;
}): HyperSyncLog {
  const data = encodeAbiParameters(eventInputs("OrderRequest"), [
    args.perpId,
    args.accountId,
    args.orderDescId,
    args.orderId,
    args.orderType,
    args.pricePNS,
    179n,
    0n,
    true,
    false,
    false,
    0n,
    300n,
    0n,
    0n,
    1000n,
    0n,
  ]);
  return { block_number: args.block, transaction_hash: args.tx, data };
}

function fillLog(orderId: bigint, block: number, tx: Hex): HyperSyncLog {
  const data = encodeAbiParameters(eventInputs("MakerOrderFilled"), [
    16n,
    7n,
    orderId,
    732293n,
    179n,
    0n,
    0n,
    0n,
    0n,
  ]);
  return { block_number: block, transaction_hash: tx, data };
}

describe("suggestionDescId", () => {
  it("round trips a real address and timestamp", () => {
    const id = suggestionDescId(FRIEND, CREATED_AT);
    const back = decodeDescId(id);
    expect(back).not.toBeNull();
    expect(back!.suggester.toLowerCase()).toBe(FRIEND.toLowerCase());
    expect(back!.createdAtMs).toBe(CREATED_AT);
  });

  it("decodes an ordinary small orderDescId to null", () => {
    expect(decodeDescId(1n)).toBeNull();
    expect(decodeDescId(0n)).toBeNull();
    expect(decodeDescId(BigInt(CREATED_AT))).toBeNull();
  });

  it("uses the live OrderRequestV2 / OrderPlaced / MakerOrderFilled topic0s", () => {
    expect(ORDER_REQUEST_V2_TOPIC0).toBe(toEventSelector(eventAbi("OrderRequestV2")));
    expect(ORDER_PLACED_TOPIC0).toBe(toEventSelector(eventAbi("OrderPlaced")));
    expect(MAKER_ORDER_FILLED_TOPIC0).toBe(toEventSelector(eventAbi("MakerOrderFilled")));
    expect(ORDER_REQUEST_V2_TOPIC0.startsWith("0xb5858652")).toBe(true);
    expect(ORDER_PLACED_TOPIC0.startsWith("0x5d5d31f8")).toBe(true);
    // The old V1 topic is a different event the deployed Exchange never emits.
    expect(ORDER_REQUEST_V2_TOPIC0).not.toBe(toEventSelector(eventAbi("OrderRequest")));
    expect(toEventSelector(eventAbi("OrderRequest")).startsWith("0x02d2bf39")).toBe(true);
    expect(MAKER_ORDER_FILLED_TOPIC0).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("parseCallRecord", () => {
  it("counts 2 accepted calls with 1 hit over a recorded fixture", () => {
    const mine = suggestionDescId(FRIEND, CREATED_AT);
    const other = suggestionDescId(STRANGER, CREATED_AT);
    const orders: HyperSyncResponse = {
      data: {
        logs: [
          orderV2Log({ perpId: 16n, accountId: 7n, orderDescId: mine, orderType: 2, pricePNS: 732293n, block: 100, tx: "0xaaa" as Hex }),
          orderV2Log({ perpId: 16n, accountId: 7n, orderDescId: mine, orderType: 2, pricePNS: 732293n, block: 101, tx: "0xbbb" as Hex }),
          orderV2Log({ perpId: 16n, accountId: 9n, orderDescId: other, orderType: 2, pricePNS: 700000n, block: 102, tx: "0xccc" as Hex }),
        ],
      },
      next_block: 103,
    };
    const placed: HyperSyncResponse = {
      data: {
        logs: [
          placedLog(11n, 100, "0xaaa" as Hex),
          placedLog(12n, 101, "0xbbb" as Hex),
          placedLog(13n, 102, "0xccc" as Hex),
        ],
      },
      next_block: 103,
    };
    const fills: HyperSyncResponse = {
      data: { logs: [fillLog(11n, 104, "0xddd" as Hex)] },
      next_block: 105,
    };
    const record = parseCallRecord(FRIEND, [orders], [placed], [fills]);
    expect(record.accepted).toBe(2);
    expect(record.hit).toBe(1);
    expect(record.calls.map((c) => c.orderId)).toEqual(["11", "12"]);
    expect(record.calls[0]!.hit).toBe(true);
    expect(record.calls[1]!.hit).toBe(false);
  });

  it("ignores OrderRequest (V1) logs even with a matching Placed and fill", () => {
    const mine = suggestionDescId(FRIEND, CREATED_AT);
    const orders: HyperSyncResponse = {
      data: {
        logs: [
          orderV1Log({ perpId: 16n, accountId: 7n, orderDescId: mine, orderId: 99n, orderType: 2, pricePNS: 732293n, block: 100, tx: "0xeee" as Hex }),
        ],
      },
      next_block: 101,
    };
    const placed: HyperSyncResponse = {
      data: { logs: [placedLog(99n, 100, "0xeee" as Hex)] },
      next_block: 101,
    };
    const fills: HyperSyncResponse = {
      data: { logs: [fillLog(99n, 104, "0xfff" as Hex)] },
      next_block: 105,
    };
    const record = parseCallRecord(FRIEND, [orders], [placed], [fills]);
    expect(record.accepted).toBe(0);
    expect(record.hit).toBe(0);
    expect(record.calls).toEqual([]);
  });
});

describe("fetchCallRecordRpc", () => {
  type RpcRow = { name: string; block: number; tx: Hex; data: Hex };

  // Recorded logs reshaped as viem eth_getLogs rows, tagged by event so the
  // fake client can filter the way a node filters on topics.
  function rows(): RpcRow[] {
    const mine = suggestionDescId(FRIEND, CREATED_AT);
    const other = suggestionDescId(STRANGER, CREATED_AT);
    return [
      { name: "OrderRequestV2", block: 100, tx: "0xaaa" as Hex, data: orderV2Log({ perpId: 16n, accountId: 7n, orderDescId: mine, orderType: 2, pricePNS: 732293n, block: 100, tx: "0xaaa" as Hex }).data },
      { name: "OrderRequestV2", block: 101, tx: "0xbbb" as Hex, data: orderV2Log({ perpId: 16n, accountId: 7n, orderDescId: mine, orderType: 2, pricePNS: 732293n, block: 101, tx: "0xbbb" as Hex }).data },
      { name: "OrderRequestV2", block: 102, tx: "0xccc" as Hex, data: orderV2Log({ perpId: 16n, accountId: 9n, orderDescId: other, orderType: 2, pricePNS: 700000n, block: 102, tx: "0xccc" as Hex }).data },
      { name: "OrderPlaced", block: 100, tx: "0xaaa" as Hex, data: placedLog(11n, 100, "0xaaa" as Hex).data },
      { name: "OrderPlaced", block: 101, tx: "0xbbb" as Hex, data: placedLog(12n, 101, "0xbbb" as Hex).data },
      { name: "OrderPlaced", block: 102, tx: "0xccc" as Hex, data: placedLog(13n, 102, "0xccc" as Hex).data },
      { name: "MakerOrderFilled", block: 104, tx: "0xddd" as Hex, data: fillLog(11n, 104, "0xddd" as Hex).data },
    ];
  }

  function fakeClient(all: RpcRow[], onCall?: () => void) {
    return {
      async getLogs(args: { event: AbiEvent; fromBlock: bigint; toBlock: bigint }) {
        onCall?.();
        const name = (args.event as AbiEvent)?.name;
        return all
          .filter((r) => r.name === name && BigInt(r.block) >= args.fromBlock && BigInt(r.block) <= args.toBlock)
          .map((r) => ({ blockNumber: BigInt(r.block), transactionHash: r.tx, data: r.data }));
      },
    } as unknown as PublicClient;
  }

  it("counts 2 accepted calls with 1 hit over recorded logs", async () => {
    const record = await fetchCallRecordRpc(FRIEND, {
      network: "testnet",
      client: fakeClient(rows()),
      fromBlock: 90n,
      toBlock: 110n,
    });
    expect(record.accepted).toBe(2);
    expect(record.hit).toBe(1);
    expect(record.calls.map((c) => c.orderId)).toEqual(["11", "12"]);
    expect(record.calls[0]!.hit).toBe(true);
    expect(record.calls[1]!.hit).toBe(false);
  });

  it("pages in RPC_CHUNK_BLOCKS chunks across the 3 topics", async () => {
    let calls = 0;
    const record = await fetchCallRecordRpc(FRIEND, {
      network: "testnet",
      client: fakeClient(rows(), () => {
        calls++;
      }),
      fromBlock: 0n,
      toBlock: 2500n,
    });
    expect(calls).toBe(Math.ceil(2501 / Number(RPC_CHUNK_BLOCKS)) * 3);
    expect(record.accepted).toBe(2);
    expect(record.hit).toBe(1);
  });

  it("retries 429s instead of failing", async () => {
    let attempts = 0;
    const flaky = {
      async getLogs(_args: { event: AbiEvent; fromBlock: bigint; toBlock: bigint }) {
        attempts++;
        if (attempts <= 2) {
          const e = new Error("429 Too Many Requests") as Error & { status: number };
          e.status = 429;
          throw e;
        }
        return [] as { blockNumber: bigint; transactionHash: Hex; data: Hex }[];
      },
    } as unknown as PublicClient;
    const record = await fetchCallRecordRpc(FRIEND, {
      network: "testnet",
      client: flaky,
      fromBlock: 90n,
      toBlock: 110n,
    });
    expect(record.accepted).toBe(0);
    expect(attempts).toBeGreaterThan(3);
  });
});
