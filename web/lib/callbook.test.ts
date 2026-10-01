import { describe, expect, it } from "bun:test";
import { encodeAbiParameters, type Abi, type Address, type Hex } from "viem";
import {
  decodeDescId,
  MAKER_ORDER_FILLED_TOPIC0,
  ORDER_REQUEST_TOPIC0,
  parseCallRecord,
  suggestionDescId,
  type HyperSyncLog,
  type HyperSyncResponse,
} from "./callbook";
import { exchangeAbi } from "./perpl";

const FRIEND = "0x4981053aC0000000000000000000000000000001" as Address;
const STRANGER = "0xe40825b200000000000000000000000000000003" as Address;
const CREATED_AT = 1758638400000;

// Both events keep every argument non-indexed, so the log data is exactly
// the ABI encoding of the inputs in order (topics are always just [topic0]).
// This is byte-identical to viem encodeEventLog's `data` output; the fixture
// uses encodeAbiParameters directly because this viem build does not export
// encodeEventLog while decodeEventLog is present.
function eventInputs(name: string) {
  const e = (exchangeAbi as Abi).find((x) => x.type === "event" && x.name === name);
  if (!e || e.type !== "event") throw new Error(`event ${name} missing from ABI`);
  return e.inputs;
}

function orderLog(args: {
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

  it("uses the on-chain OrderRequest topic0", () => {
    expect(ORDER_REQUEST_TOPIC0).toBe(
      "0x02d2bf39d2355aaa5486487e934403fd3ba3f88c73ab71938cee11931fddeb7b",
    );
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
          orderLog({ perpId: 16n, accountId: 7n, orderDescId: mine, orderId: 11n, orderType: 2, pricePNS: 732293n, block: 100, tx: "0xaaa" as Hex }),
          orderLog({ perpId: 16n, accountId: 7n, orderDescId: mine, orderId: 12n, orderType: 2, pricePNS: 732293n, block: 101, tx: "0xbbb" as Hex }),
          orderLog({ perpId: 16n, accountId: 9n, orderDescId: other, orderId: 13n, orderType: 2, pricePNS: 700000n, block: 102, tx: "0xccc" as Hex }),
        ],
      },
      next_block: 103,
    };
    const fills: HyperSyncResponse = {
      data: { logs: [fillLog(11n, 104, "0xddd" as Hex)] },
      next_block: 105,
    };
    const record = parseCallRecord(FRIEND, [orders], [fills]);
    expect(record.accepted).toBe(2);
    expect(record.hit).toBe(1);
    expect(record.calls.map((c) => c.orderId)).toEqual(["11", "12"]);
    expect(record.calls[0]!.hit).toBe(true);
    expect(record.calls[1]!.hit).toBe(false);
  });
});
