/// Live candles over the Perpl market-data WebSocket.
////
//// Verified on testnet 2026-10-02 (spikes/perpl-market-ws FINDINGS):
//// subscribe with {"mt":5,"subs":[{"stream":"candles@<market>*<resSeconds>",
//// "subscribe":true}]}; mt 6 acks with subs[].status.code (0 ok), mt 11 is the
//// snapshot and mt 12 the update, both with d as an array of candles
//// {t,o,c,h,l,v,n} scaled exactly like the REST route (scaleCandle).
////
//// The socket caps at 16 subscriptions; the chart needs one, so this module
//// opens one socket per market/resolution and resubscribes by reconnecting.
import { scaleCandle, type Candle, type RawCandle } from "./chart";
import type { Network } from "./perpl";

export const MARKET_WS_URL: Record<Network, string> = {
  mainnet: "wss://app.perpl.xyz/ws/v1/market-data",
  testnet: "wss://testnet.perpl.xyz/ws/v1/market-data",
};

/// The socket accepts at most 16 subscriptions. The chart holds one.
export const MAX_SUBS = 16;

export const MT_SUBSCRIBE = 5;
export const MT_ACK = 6;
export const MT_SNAPSHOT = 11;
export const MT_UPDATE = 12;

/// One subscription stream for a market and resolution in seconds.
export function streamFor(market: number, resSeconds: number): string {
  if (!Number.isInteger(market) || market < 0) throw new Error(`bad market ${String(market)}`);
  if (!Number.isInteger(resSeconds) || resSeconds <= 0) throw new Error(`bad resSeconds ${String(resSeconds)}`);
  return `candles@${market}*${resSeconds}`;
}

/// The subscribe frame the socket expects.
export function subscribeMessage(market: number, resSeconds: number): string {
  return JSON.stringify({
    mt: MT_SUBSCRIBE,
    subs: [{ stream: streamFor(market, resSeconds), subscribe: true }],
  });
}

export type AckResult = { stream: string; code: number; ok: boolean; message: string | null };

export type CandleFrame =
  | { kind: "ack"; results: AckResult[] }
  | { kind: "snapshot"; raw: RawCandle[] }
  | { kind: "update"; raw: RawCandle[] }
  | { kind: "unknown" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asRawCandle(v: unknown): RawCandle | null {
  if (!isRecord(v)) return null;
  const { t, o, c, h, l, v: vol, n } = v;
  if (
    typeof t !== "number" ||
    typeof o !== "number" ||
    typeof c !== "number" ||
    typeof h !== "number" ||
    typeof l !== "number" ||
    typeof n !== "number"
  )
    return null;
  if (typeof vol !== "string" && typeof vol !== "number") return null;
  return { t, o, c, h, l, v: String(vol), n };
}

function rawArray(v: unknown): RawCandle[] | null {
  if (!Array.isArray(v)) return null;
  const out: RawCandle[] = [];
  for (const item of v) {
    const c = asRawCandle(item);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

/// Parse one decoded JSON frame. Never throws: anything unrecognised is
/// {kind:"unknown"} so a new server message cannot crash the chart.
export function parseFrame(msg: unknown): CandleFrame {
  if (!isRecord(msg)) return { kind: "unknown" };
  const mt = msg.mt;
  if (mt === MT_ACK) {
    const subs = Array.isArray(msg.subs) ? msg.subs : [];
    const results: AckResult[] = [];
    for (const s of subs) {
      if (!isRecord(s)) continue;
      const stream = typeof s.stream === "string" ? s.stream : "";
      const status = isRecord(s.status) ? s.status : {};
      const code = typeof status.code === "number" ? status.code : -1;
      const message = typeof status.message === "string" ? status.message : null;
      results.push({ stream, code, ok: code === 0, message });
    }
    return { kind: "ack", results };
  }
  if (mt === MT_SNAPSHOT || mt === MT_UPDATE) {
    const raw = rawArray(msg.d);
    if (!raw) return { kind: "unknown" };
    return mt === MT_SNAPSHOT ? { kind: "snapshot", raw } : { kind: "update", raw };
  }
  return { kind: "unknown" };
}

/// Parse one raw socket payload (string or pre-decoded JSON). Returns unknown
/// on invalid JSON so the caller can ignore it.
export function parseMessage(data: string): CandleFrame {
  try {
    return parseFrame(JSON.parse(data) as unknown);
  } catch {
    return { kind: "unknown" };
  }
}

/// Scale one pushed batch the same way the REST route does.
export function scaleBatch(raw: RawCandle[], priceDecimals: number): Candle[] {
  return raw.map((c) => scaleCandle(c, priceDecimals));
}

/// Merge one pushed candle into history: same time replaces the last candle,
/// a newer time appends, anything older is ignored.
export function mergeCandle(history: Candle[], next: Candle): Candle[] {
  if (!history.length) return [next];
  const last = history[history.length - 1] as Candle;
  if (next.time === last.time) return [...history.slice(0, -1), next];
  if (next.time > last.time) return [...history, next];
  return history;
}

export type CandlePush = { snapshot: boolean; candles: Candle[] };

export type ConnectOpts = {
  net: Network;
  market: number;
  res: number;
  priceDecimals: number;
  onPush: (push: CandlePush) => void;
  /// Override the socket constructor in tests or runtimes without WebSocket.
  createSocket?: (url: string) => WebSocket;
};

/// Backoff for reconnects: 1 s doubling to a 15 s cap.
export function backoffFor(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(15_000, 1000 * 2 ** Math.min(n, 4));
}

/// Open the market-data socket for one market/resolution, resubscribing on
/// every (re)connect. Reconnects with backoff until closed. Returns a close
/// function for unmount or for market/res change (the caller reconnects).
export function connect(opts: ConnectOpts): () => void {
  const { net, market, res, priceDecimals, onPush } = opts;
  const create = opts.createSocket ?? ((url: string) => new WebSocket(url));
  let closed = false;
  let attempt = 0;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = create(MARKET_WS_URL[net]);
    } catch {
      schedule();
      return;
    }
    ws = socket;
    try {
      socket.onopen = () => {
        if (closed) return;
        attempt = 0;
        try {
          socket.send(subscribeMessage(market, res));
        } catch {
          // A failed send drops to onclose/onerror and the backoff path.
        }
      };
      socket.onmessage = (ev: MessageEvent) => {
        if (closed) return;
        const data = typeof ev.data === "string" ? ev.data : null;
        if (data === null) return;
        const frame = parseMessage(data);
        if (frame.kind === "snapshot") {
          onPush({ snapshot: true, candles: scaleBatch(frame.raw, priceDecimals) });
        } else if (frame.kind === "update") {
          onPush({ snapshot: false, candles: scaleBatch(frame.raw, priceDecimals) });
        }
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
    const wait = backoffFor(attempt);
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
