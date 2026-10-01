import { describe, expect, it } from "bun:test";
import {
  encodeAbiParameters,
  getAddress,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { decodeDescId, suggestionDescId } from "./callbook";
import { NETWORKS } from "./perpl";
import { roomLink } from "./network";
import {
  encodeCallsParam,
  parseCallsParam,
  priceCalls,
  priceInMarketUnits,
  verifyCallReceipts,
  type VerifiedCall,
} from "./receipts";
import officialAbi from "./exchange-official.abi.json";

const FRIEND = "0x4981053aC0000000000000000000000000000001" as Address;
const OWNER = "0x073f475a00ec54172f38864b12b32e7f481607e9" as Address;
const CREATED_AT = 1758638400000;
const EXCHANGE = NETWORKS.testnet.exchange;

const H1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const H2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const H3 = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex;
const H4 = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hex;

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

// Receipt-log fixture for one OrderRequestV2 emission: viem 2.56 no longer
// ships the combined encodeEventLog helper, so topics come from
// toEventSelector and data from encodeAbiParameters, the same encoding the
// node itself produces (all OrderRequestV2 args are non-indexed, so topics
// are exactly [topic0]).
function v2Log(orderDescId: bigint, pricePNS: bigint, orderType = 2): { topics: Hex[]; data: Hex } {
  const data = encodeAbiParameters(eventInputs("OrderRequestV2"), [
    16n,
    7n,
    orderDescId,
    0n,
    orderType,
    pricePNS,
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
  return { topics: [toEventSelector(eventAbi("OrderRequestV2"))], data };
}

type FixtureReceipt = {
  status: "success" | "reverted";
  from: Address;
  blockNumber: bigint;
  logs: { address: Address; topics: Hex[]; data: Hex }[];
};

function fakeClient(byHash: Record<string, FixtureReceipt>) {
  return {
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      const r = byHash[hash.toLowerCase()];
      if (!r) throw new Error(`unknown hash ${hash}`);
      return r;
    },
  } as unknown as PublicClient;
}

describe("parseCallsParam", () => {
  it("splits ?c= into hashes", () => {
    expect(parseCallsParam(`${H1},${H2}`)).toEqual([H1, H2]);
  });

  it("trims slots and drops anything that is not a 32-byte hash", () => {
    expect(parseCallsParam(` ${H1} ,,0xabc,zzz,${H2.slice(0, 10)},${H2} `)).toEqual([H1, H2]);
  });

  it("parses missing or empty input to []", () => {
    expect(parseCallsParam(null)).toEqual([]);
    expect(parseCallsParam(undefined)).toEqual([]);
    expect(parseCallsParam("")).toEqual([]);
  });

  it("dedupes case-insensitively and caps at 50", () => {
    const hashes = Array.from({ length: 60 }, (_, i) => `0x${i.toString(16).padStart(64, "0")}` as Hex);
    const out = parseCallsParam([H1, H1.toUpperCase(), ...hashes].join(","));
    expect(out.length).toBe(50);
    expect(out[0]).toBe(H1);
    expect(new Set(out.map((h) => h.toLowerCase())).size).toBe(out.length);
  });
});

describe("encodeCallsParam", () => {
  it("round trips through parseCallsParam", () => {
    const hashes = [H1, H2, H3];
    expect(parseCallsParam(encodeCallsParam(hashes))).toEqual(hashes);
  });

  it("encodes an empty list to an empty string", () => {
    expect(encodeCallsParam([])).toBe("");
  });
});

describe("verifyCallReceipts", () => {
  const mine = suggestionDescId(FRIEND, CREATED_AT);
  const call = v2Log(mine, 732293n);
  const self = v2Log(7n, 700000n);
  const failed = v2Log(mine, 710000n);

  const byHash: Record<string, FixtureReceipt> = {
    [H1.toLowerCase()]: {
      status: "success",
      from: OWNER,
      blockNumber: 100n,
      logs: [{ address: EXCHANGE, topics: call.topics, data: call.data }],
    },
    // A self order: the V2 orderDescId decodes to no caller.
    [H2.toLowerCase()]: {
      status: "success",
      from: OWNER,
      blockNumber: 101n,
      logs: [{ address: EXCHANGE, topics: self.topics, data: self.data }],
    },
    // A failed transaction: the V2 log decodes but the tx reverted.
    [H3.toLowerCase()]: {
      status: "reverted",
      from: OWNER,
      blockNumber: 102n,
      logs: [{ address: EXCHANGE, topics: failed.topics, data: failed.data }],
    },
    // A receipt with no OrderRequestV2 logs at all.
    [H4.toLowerCase()]: { status: "success", from: OWNER, blockNumber: 103n, logs: [] },
  };

  it("keeps the call and drops the self order, the failed tx and the empty receipt", async () => {
    const out = await verifyCallReceipts("testnet", [H1, H2, H3, H4], fakeClient(byHash));
    expect(out).toEqual([
      { hash: H1, caller: getAddress(FRIEND), owner: OWNER, market: 16, orderType: 2, pricePNS: "732293", block: 100 },
    ] satisfies VerifiedCall[]);
  });

  it("takes the close, not the cancel, from a replace batch whose cancel carries the same caller", async () => {
    const cancel = v2Log(mine, 0n, 4);
    const replace = {
      [H1.toLowerCase()]: {
        status: "success" as const,
        from: OWNER,
        blockNumber: 100n,
        logs: [
          { address: EXCHANGE, topics: cancel.topics, data: cancel.data },
          { address: EXCHANGE, topics: call.topics, data: call.data },
        ],
      },
    };
    const out = await verifyCallReceipts("testnet", [H1], fakeClient(replace));
    expect(out.map((c) => [c.orderType, c.pricePNS])).toEqual([[2, "732293"]]);
  });

  it("reads the caller out of the receipt log, not the log scanner", () => {
    const decoded = decodeDescId(mine);
    expect(decoded?.suggester.toLowerCase()).toBe(FRIEND.toLowerCase());
  });

  it("drops unknown hashes without throwing and returns [] for empty input", async () => {
    const out = await verifyCallReceipts(
      "testnet",
      ["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Hex],
      fakeClient(byHash),
    );
    expect(out).toEqual([]);
    expect(await verifyCallReceipts("testnet", [], fakeClient(byHash))).toEqual([]);
  });

  it("ignores V2 logs from another exchange contract", async () => {
    const other = {
      status: "success" as const,
      from: OWNER,
      blockNumber: 104n,
      logs: [{ address: NETWORKS.mainnet.exchange, topics: call.topics, data: call.data }],
    };
    const out = await verifyCallReceipts(
      "testnet",
      [H1],
      fakeClient({ ...byHash, [H1.toLowerCase()]: other }),
    );
    expect(out).toEqual([]);
  });
});

describe("room link with calls", () => {
  it("round trips addresses, names and call hashes through the link", () => {
    const code = "abc123";
    const link = roomLink(code, "testnet", "ana,bo", encodeCallsParam([H1, H2]));
    const q = new URLSearchParams(link.split("?")[1] as string);
    expect(q.get("net")).toBe("testnet");
    expect(q.get("n")).toBe("ana,bo");
    expect(parseCallsParam(q.get("c"))).toEqual([H1, H2]);
  });

  it("omits ?c= when no call hashes are attached", () => {
    expect(roomLink("abc123", "testnet")).toBe("/r/abc123?net=testnet");
    expect(roomLink("abc123", "testnet", "", "")).toBe("/r/abc123?net=testnet");
  });
});

describe("priceInMarketUnits", () => {
  it("divides the raw PNS value by 10^priceDecimals", () => {
    expect(priceInMarketUnits("866780", 1)).toBe(86678);
    expect(priceInMarketUnits("732293", 4)).toBeCloseTo(73.2293, 10);
    expect(priceInMarketUnits(175000n, 4n)).toBe(17.5);
  });

  it("keeps zero and sub-unit prices exact", () => {
    expect(priceInMarketUnits("0", 4)).toBe(0);
    expect(priceInMarketUnits("204", 4)).toBeCloseTo(0.0204, 10);
  });
});

describe("priceCalls", () => {
  // readPerpMeta caches decimals by exchange and market for the life of the
  // process, so every case gets its own exchange address: a shared one would
  // make the read counts below meaningless.
  let seq = 0;
  const freshExchange = (): Address => `0x${(seq += 1).toString(16).padStart(40, "0")}` as Address;

  function metaClient(decimals: Record<number, number>, reads: number[]): PublicClient {
    return {
      readContract: (async ({ args }: { args: readonly unknown[] }) => {
        const market = Number(args?.[0]);
        reads.push(market);
        const d = decimals[market];
        if (d === undefined) throw new Error(`no market ${market}`);
        return { symbol: `M${market}`, priceDecimals: BigInt(d), lotDecimals: 4n };
      }),
    } as unknown as PublicClient;
  }

  function call(market: number, pricePNS: string, hash: Hex): VerifiedCall {
    return { hash, caller: FRIEND, owner: OWNER, market, orderType: 2, pricePNS, block: 1 };
  }

  it("prices each call in its own market's units", async () => {
    const reads: number[] = [];
    const calls = [call(16, "732293", H1), call(32, "204", H2)];
    const out = await priceCalls(calls, metaClient({ 16: 4, 32: 6 }, reads), freshExchange());
    expect(out[0]?.price).toBeCloseTo(73.2293, 10);
    expect(out[1]?.price).toBeCloseTo(0.000204, 12);
  });

  it("keeps the raw PNS value next to the scaled price", async () => {
    const reads: number[] = [];
    const out = await priceCalls([call(16, "732293", H1)], metaClient({ 16: 4 }, reads), freshExchange());
    expect(out[0]).toMatchObject({ pricePNS: "732293", price: 73.2293 });
  });

  it("reads each market's decimals once, however many calls it carries", async () => {
    const reads: number[] = [];
    const calls = [call(16, "1", H1), call(16, "2", H2), call(32, "3", H3), call(16, "4", H4)];
    const out = await priceCalls(calls, metaClient({ 16: 4, 32: 4 }, reads), freshExchange());
    expect(reads).toEqual([16, 32]);
    expect(out.length).toBe(4);
  });

  it("leaves price null when a market's decimals cannot be read", async () => {
    const reads: number[] = [];
    const calls = [call(16, "732293", H1), call(999, "1", H2)];
    const out = await priceCalls(calls, metaClient({ 16: 4 }, reads), freshExchange());
    expect(out[0]?.price).toBeCloseTo(73.2293, 10);
    expect(out[1]?.price).toBeNull();
  });

  it("prices nothing when there are no calls", async () => {
    const reads: number[] = [];
    expect(await priceCalls([], metaClient({}, reads), freshExchange())).toEqual([]);
    expect(reads).toEqual([]);
  });
});
