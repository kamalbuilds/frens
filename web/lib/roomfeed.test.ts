import { describe, expect, it } from "bun:test";
import { encodeAbiParameters, type AbiParameter, type Address, type Hex } from "viem";
import officialAbi from "./exchange-official.abi.json";
import { suggestionDescId } from "./callbook";
import {
  buildRoomEvent,
  decideRoomKind,
  decodeRoomLog,
  extractRoomLog,
  orderRequestV2Topic,
  roomSubscribeMessage,
  sideOf,
} from "./roomfeed";

const MEMBER_A = "0x1111111111111111111111111111111111111111" as Address;
const MEMBER_B = "0x2222222222222222222222222222222222222222" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const MEMBERS = [MEMBER_A, MEMBER_B];

const abi = officialAbi as never;

function eventInputs(name: string) {
  const found = (officialAbi as unknown[]).find(
    (x) => typeof x === "object" && x !== null && (x as { type?: string }).type === "event" && (x as { name?: string }).name === name,
  ) as { inputs: never } | undefined;
  if (!found) throw new Error(`event ${name} missing from official ABI`);
  return found.inputs as unknown as readonly AbiParameter[];
}

/// Recorded-log fixture builder on viem primitives (this viem release ships
/// encodeAbiParameters plus the topic selector, the same pair
/// encodeEventLog wraps upstream): all OrderRequestV2 args are non-indexed,
/// so topics is exactly [topic0] and data carries the encoded args.
function v2Log(args: { accountId: bigint; orderDescId: bigint; orderType: number; pricePNS: bigint }): {
  data: Hex;
  topics: Hex[];
} {
  const data = encodeAbiParameters(eventInputs("OrderRequestV2"), [
    16n,
    args.accountId,
    args.orderDescId,
    0n,
    args.orderType,
    args.pricePNS,
    10n,
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
  return { data, topics: [orderRequestV2Topic()] };
}

describe("roomfeed topic", () => {
  it("uses the OrderRequestV2 selector from the official ABI", () => {
    expect(orderRequestV2Topic()).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("subscribes with monadLogs for the network exchange", () => {
    const msg = JSON.parse(roomSubscribeMessage(1, "0x1964C32f0bE608E7D29302AFF5E61268E72080cc")) as {
      method: string;
      params: [string, { address: string; topics: string[][] }];
    };
    expect(msg.method).toBe("eth_subscribe");
    expect(msg.params[0]).toBe("monadLogs");
    expect(msg.params[1].address).toBe("0x1964C32f0bE608E7D29302AFF5E61268E72080cc");
    expect(msg.params[1].topics[0]).toEqual([orderRequestV2Topic()]);
  });
});

describe("decodeRoomLog over recorded fixtures", () => {
  it("round trips an encoded OrderRequestV2 log", () => {
    const { data, topics } = v2Log({ accountId: 7n, orderDescId: 1n, orderType: 0, pricePNS: 732293n });
    const decoded = decodeRoomLog(data, topics);
    expect(decoded).not.toBeNull();
    expect(decoded?.accountId).toBe(7n);
    expect(decoded?.orderType).toBe(0);
    expect(decoded?.pricePNS).toBe(732293n);
  });

  it("returns null for garbage", () => {
    expect(decodeRoomLog("0x1234" as Hex, [])).toBeNull();
  });
});

describe("sideOf", () => {
  it("maps even order types to long and odd to short", () => {
    expect(sideOf(0)).toBe("long");
    expect(sideOf(2)).toBe("long");
    expect(sideOf(1)).toBe("short");
    expect(sideOf(3)).toBe("short");
  });
});

describe("roomfeed filtering", () => {
  it("keeps a member account order", () => {
    const { data, topics } = v2Log({ accountId: 7n, orderDescId: 1n, orderType: 0, pricePNS: 732293n });
    const decoded = decodeRoomLog(data, topics);
    if (!decoded) throw new Error("fixture did not decode");
    const event = buildRoomEvent({
      decoded,
      owner: MEMBER_A,
      members: MEMBERS,
      priceDecimals: 5,
      txHash: "0xabc" as Hex,
      blockNumber: "0x10",
    });
    expect(event?.kind).toBe("order");
    expect(event?.owner).toBe(MEMBER_A);
    expect(event?.caller).toBeUndefined();
    expect(event?.price).toBeCloseTo(7.32293, 8);
    expect(event?.side).toBe("long");
  });

  it("marks a member caller as call-accepted", () => {
    const desc = suggestionDescId(MEMBER_B, 1758638400000);
    const { data, topics } = v2Log({ accountId: 9n, orderDescId: desc, orderType: 2, pricePNS: 700000n });
    const decoded = decodeRoomLog(data, topics);
    if (!decoded) throw new Error("fixture did not decode");
    const event = buildRoomEvent({
      decoded,
      owner: STRANGER,
      members: MEMBERS,
      priceDecimals: 5,
    });
    expect(event?.kind).toBe("call-accepted");
    expect(event?.caller?.toLowerCase()).toBe(MEMBER_B.toLowerCase());
    expect(event?.owner).toBe(STRANGER);
  });

  it("ignores a stranger with an ordinary descId", () => {
    const { data, topics } = v2Log({ accountId: 9n, orderDescId: 5n, orderType: 1, pricePNS: 100n });
    const decoded = decodeRoomLog(data, topics);
    if (!decoded) throw new Error("fixture did not decode");
    const event = buildRoomEvent({ decoded, owner: STRANGER, members: MEMBERS, priceDecimals: 5 });
    expect(event).toBeNull();
  });

  it("decides kinds without decoding", () => {
    expect(decideRoomKind({ owner: MEMBER_A, caller: null, members: MEMBERS })).toBe("order");
    expect(decideRoomKind({ owner: MEMBER_A, caller: MEMBER_B, members: MEMBERS })).toBe("call-accepted");
    expect(decideRoomKind({ owner: STRANGER, caller: MEMBER_B, members: MEMBERS })).toBe("call-accepted");
    expect(decideRoomKind({ owner: STRANGER, caller: null, members: MEMBERS })).toBeNull();
    expect(decideRoomKind({ owner: STRANGER, caller: STRANGER, members: MEMBERS })).toBeNull();
  });
});

describe("extractRoomLog", () => {
  it("pulls the log out of a subscription notification", () => {
    const { data, topics } = v2Log({ accountId: 7n, orderDescId: 1n, orderType: 0, pricePNS: 1n });
    const log = extractRoomLog({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: {
        subscription: "0x1",
        result: { data, topics, transactionHash: "0xabc", blockNumber: "0x10" },
      },
    });
    expect(log?.data).toBe(data);
    expect(log?.txHash).toBe("0xabc");
  });

  it("returns null for acks", () => {
    expect(extractRoomLog({ jsonrpc: "2.0", id: 1, result: "0x1" })).toBeNull();
  });
});
