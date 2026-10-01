import { describe, expect, it } from "bun:test";
import {
  backoffFor,
  connect,
  MAX_SUBS,
  MARKET_WS_URL,
  mergeCandle,
  parseFrame,
  parseMessage,
  scaleBatch,
  streamFor,
  subscribeMessage,
} from "./marketws";
import type { Candle } from "./chart";

describe("marketws subscription", () => {
  it("targets the Perpl market-data socket per network", () => {
    expect(MARKET_WS_URL.testnet).toBe("wss://testnet.perpl.xyz/ws/v1/market-data");
    expect(MARKET_WS_URL.mainnet).toBe("wss://app.perpl.xyz/ws/v1/market-data");
  });

  it("builds the candles stream and subscribe frame", () => {
    expect(streamFor(16, 3600)).toBe("candles@16*3600");
    const msg = JSON.parse(subscribeMessage(16, 3600)) as { mt: number; subs: { stream: string; subscribe: boolean }[] };
    expect(msg.mt).toBe(5);
    expect(msg.subs).toEqual([{ stream: "candles@16*3600", subscribe: true }]);
  });

  it("stays under the 16 sub socket cap", () => {
    expect(MAX_SUBS).toBe(16);
  });
});

describe("marketws ack frames", () => {
  it("marks code 0 ok", () => {
    const frame = parseMessage(
      JSON.stringify({ mt: 6, subs: [{ stream: "candles@16*3600", status: { code: 0 } }] }),
    );
    expect(frame.kind).toBe("ack");
    if (frame.kind !== "ack") throw new Error("expected ack");
    expect(frame.results).toEqual([{ stream: "candles@16*3600", code: 0, ok: true, message: null }]);
  });

  it("surfaces 404 and 429 statuses as not ok", () => {
    const frame = parseMessage(
      JSON.stringify({
        mt: 6,
        subs: [
          { stream: "candles@999*3600", status: { code: 404, message: "unknown market" } },
          { stream: "candles@16*3600", status: { code: 429, message: "rate limited" } },
        ],
      }),
    );
    expect(frame.kind).toBe("ack");
    if (frame.kind !== "ack") throw new Error("expected ack");
    expect(frame.results[0]).toMatchObject({ code: 404, ok: false });
    expect(frame.results[1]).toMatchObject({ code: 429, ok: false });
    expect(frame.results[1]?.message).toBe("rate limited");
  });
});

describe("marketws candle frames", () => {
  const d = [
    { t: 1758638400000, o: 732293, c: 732500, h: 732600, l: 732000, v: "12.5", n: 7 },
    { t: 1758642000000, o: 732500, c: 732100, h: 732700, l: 732050, v: "3", n: 2 },
  ];

  it("separates snapshot (mt 11) from update (mt 12)", () => {
    const snap = parseMessage(JSON.stringify({ mt: 11, d }));
    const update = parseMessage(JSON.stringify({ mt: 12, d: [d[1]] }));
    expect(snap.kind).toBe("snapshot");
    expect(update.kind).toBe("update");
    if (snap.kind !== "snapshot" || update.kind !== "update") throw new Error("bad kinds");
    expect(snap.raw).toHaveLength(2);
    expect(update.raw).toHaveLength(1);
  });

  it("scales pushed candles like the REST route", () => {
    const snap = parseFrame({ mt: 11, d });
    if (snap.kind !== "snapshot") throw new Error("expected snapshot");
    const scaled = scaleBatch(snap.raw, 5);
    expect(scaled[0]?.open).toBeCloseTo(7.32293, 8);
    expect(scaled[0]?.time).toBe(Math.floor(1758638400000 / 1000));
    expect(scaled[0]?.volume).toBe(12.5);
  });

  it("ignores unknown frames without throwing", () => {
    expect(parseMessage("not json").kind).toBe("unknown");
    expect(parseFrame({ mt: 999 }).kind).toBe("unknown");
    expect(parseFrame(null).kind).toBe("unknown");
  });
});

describe("mergeCandle", () => {
  const base: Candle[] = [
    { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 },
  ];

  it("replaces the last candle on the same time", () => {
    const next: Candle = { time: 1000, open: 1, high: 2.5, low: 0.5, close: 2, volume: 4 };
    expect(mergeCandle(base, next)).toEqual([next]);
  });

  it("appends a newer candle", () => {
    const next: Candle = { time: 2000, open: 2, high: 3, low: 1.5, close: 2.5, volume: 1 };
    expect(mergeCandle(base, next)).toHaveLength(2);
  });

  it("ignores an older candle", () => {
    const next: Candle = { time: 500, open: 2, high: 3, low: 1.5, close: 2.5, volume: 1 };
    expect(mergeCandle(base, next)).toEqual(base);
  });
});

describe("backoffFor", () => {
  it("starts at 1 s and caps at 15 s", () => {
    expect(backoffFor(0)).toBe(1000);
    expect(backoffFor(1)).toBe(2000);
    expect(backoffFor(4)).toBe(15000);
    expect(backoffFor(99)).toBe(15000);
  });
});

describe("connect without network", () => {
  it("sends the subscribe frame on open and closes cleanly", () => {
    const sent: string[] = [];
    let closed = false;
    const fake = {
      send: (s: string) => void sent.push(s),
      close: () => void (closed = true),
      onopen: null as null | (() => void),
      onmessage: null as null | ((ev: MessageEvent) => void),
      onclose: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    const pushes: { snapshot: boolean; candles: Candle[] }[] = [];
    const close = connect({
      net: "testnet",
      market: 16,
      res: 3600,
      priceDecimals: 5,
      onPush: (p) => void pushes.push(p),
      createSocket: () => fake as unknown as WebSocket,
    });
    fake.onopen?.();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] as string)).toMatchObject({ mt: 5 });
    fake.onmessage?.({
      data: JSON.stringify({
        mt: 12,
        d: [{ t: 1758638400000, o: 732293, c: 732500, h: 732600, l: 732000, v: "1", n: 1 }],
      }),
    } as MessageEvent);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.snapshot).toBe(false);
    close();
    expect(closed).toBe(true);
  });
});
