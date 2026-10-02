// Accept-path replace coverage: a resting full-size TP locks its lots, so
// accepting a friend's TP must cancel the old close and place the new one in
// a single execOrders batch. No network: the chain is a mocked client.
import { describe, expect, it } from "bun:test";
import { type Address, type PublicClient } from "viem";
import {
  ACCEPT_BATCH_SUPPORTED,
  buildAcceptOrders,
  CANCEL,
  CLOSE_LONG,
  CLOSE_SHORT,
  decodeAcceptBatch,
  encodeAcceptBatch,
  encodeCloseOrder,
  decodeCloseOrder,
  priceToPNS,
  sizeToLots,
  toCancelOrder,
  toCloseOrder,
  TWO_SIGNATURE_NOTICE,
  type Suggestion,
} from "./suggest";
import { replacementNotice } from "./acceptance";
import { findRestingCloses } from "./resting";

const OWNER = "0xf91b2eCb1cD59A36F3AED20B46943a75dB08795b" as Address;
const FRIEND = "0x4981053aC0000000000000000000000000000001" as Address;
const MARKET = 16;
const CREATED_AT = 1758638400000;
const META = { symbol: "BTC", priceDecimals: 1n, lotDecimals: 5n };
const BASE_PNS = 690000n;
const PRICE_ONS = 42293;
const PRICE_PNS = BASE_PNS + BigInt(PRICE_ONS);

function suggestion(): Suggestion {
  return { owner: OWNER, market: MARKET, side: "long", price: 73229.3, sizeLots: undefined, from: FRIEND, createdAt: CREATED_AT };
}

function closeForLots(lots: bigint) {
  return toCloseOrder(suggestion(), META, { fullSizeLots: lots });
}

// Minimal mocked chain: account 7 has three locks on market 16. Lock
// (1<<20)|41 is its resting CloseLong (order 41, 179 lots); (1<<20)|42 is an
// open order, not a close; (1<<20)|43 is a close lock whose order id Perpl has
// since recycled to another account. Only order 41 may come back.
function mockClient(locks: readonly { orderLockId: number; orderType: number }[] = [
  { orderLockId: (1 << 20) | 41, orderType: 2 },
  { orderLockId: (1 << 20) | 42, orderType: 0 },
  { orderLockId: (1 << 20) | 43, orderType: 2 },
]): PublicClient {
  return {
    readContract: async (args: { functionName?: string; args?: readonly unknown[] }) => {
      if (args.functionName === "getAccountByAddr") return { accountId: 7n };
      if (args.functionName === "getPerpetualInfoV2") return { basePricePNS: BASE_PNS, priceDecimals: 1n };
      if (args.functionName === "getPerpOrderLocks") return locks;
      if (args.functionName === "getOrderV2") {
        const id = (args.args as readonly bigint[])[1];
        if (id === 41n) return { accountId: 7, orderType: 2, lotLNS: 179, priceONS: PRICE_ONS };
        if (id === 42n) return { accountId: 7, orderType: 0, lotLNS: 50, priceONS: PRICE_ONS };
        if (id === 43n) return { accountId: 9, orderType: 2, lotLNS: 179, priceONS: PRICE_ONS };
        return { accountId: 0, orderType: 2, lotLNS: 0, priceONS: 0 };
      }
      throw new Error(`unexpected ${String(args.functionName)}`);
    },
  } as unknown as PublicClient;
}

describe("accept batch", () => {
  it("no resting order means a single close", () => {
    const close = closeForLots(179n);
    expect(buildAcceptOrders(close, [])).toEqual([close]);
    const back = decodeCloseOrder(encodeCloseOrder(close));
    expect(back).toEqual(close);
  });

  it("batch calldata decodes back to [cancel ids..., close]", () => {
    const close = closeForLots(179n);
    const orders = buildAcceptOrders(close, [41n]);
    expect(orders).toHaveLength(2);
    expect(orders[0]!.orderType).toBe(CANCEL);
    expect(orders[0]!.orderId).toBe(41n);
    expect(orders[1]!.orderType).toBe(CLOSE_LONG);
    expect(orders[1]!.lotLNS).toBe(179n);
    // Desc ids increase in execution order: cancel first, close last.
    expect(orders[1]!.orderDescId).toBeGreaterThan(orders[0]!.orderDescId);
    const back = decodeAcceptBatch(encodeAcceptBatch(orders, true));
    expect(back.revertOnFail).toBe(true);
    expect(back.orders).toHaveLength(2);
    expect(back.orders[0]!.orderId).toBe(41n);
    expect(back.orders[0]!.orderType).toBe(CANCEL);
    expect(back.orders[1]).toEqual(orders[1]);
  });

  it("dedupes and sorts cancel ids, and keeps short closes", () => {
    const close = closeForLots(179n);
    const orders = buildAcceptOrders(close, [9n, 9n, 3n]);
    expect(orders.map((o) => o.orderId)).toEqual([3n, 9n, orders[2]!.orderId]);
    expect(orders.slice(0, 2).every((o) => o.orderType === CANCEL)).toBe(true);
    const shortClose = { ...close, orderType: CLOSE_SHORT };
    expect(buildAcceptOrders(shortClose, [5n])[1]!.orderType).toBe(CLOSE_SHORT);
    expect(() => toCancelOrder(MARKET, 0n, 1n)).toThrow(/cancel/);
  });

  it("lot math floors partial lots and scales the proven case", () => {
    expect(sizeToLots(0.00179, 5n)).toBe(179n);
    expect(sizeToLots(0.001791, 5n)).toBe(179n);
    expect(priceToPNS(73229.3, 1n, "long")).toBe(732293n);
    expect(ACCEPT_BATCH_SUPPORTED).toBe(true);
    expect(TWO_SIGNATURE_NOTICE).toMatch(/2 signatures/);
  });

  it("banner replacing line names the old TP price", () => {
    expect(replacementNotice(72000, 1, "dee")).toBe("Replaces dee's TP at 72,000.0");
  });
});

describe("findRestingCloses", () => {
  it("reads the owner's resting close from its order locks, with lots and price", async () => {
    const out = await findRestingCloses("testnet", mockClient(), OWNER, MARKET);
    expect(out).toHaveLength(1);
    expect(out[0]!.orderId).toBe(41n);
    expect(out[0]!.side).toBe("close-long");
    expect(out[0]!.lots).toBe(179n);
    expect(out[0]!.pricePNS).toBe(PRICE_PNS);
    expect(out[0]!.price).toBeCloseTo(73229.3, 5);
  });

  it("returns [] when the owner has no locks", async () => {
    expect(await findRestingCloses("testnet", mockClient([]), OWNER, MARKET)).toEqual([]);
  });

  it("returns [] when the address has no account", async () => {
    const client = mockClient();
    const read = client.readContract;
    (client as unknown as Record<string, unknown>).readContract = async (args: { functionName?: string }) => {
      if (args.functionName === "getAccountByAddr") return { accountId: 0n };
      return (read as (a: never) => Promise<unknown>)({ functionName: args.functionName, args: [] } as never);
    };
    expect(await findRestingCloses("testnet", client, OWNER, MARKET)).toEqual([]);
  });
});
