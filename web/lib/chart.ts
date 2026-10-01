/// Pure pieces of the chart, kept apart from the chart library so they can be tested.

/// Friend hues from DESIGN.md. One per trader, used only for their chip and line.
/// The viewer accent #2F5BEA is never in this list: it is reserved for the
/// viewer's own actions (last-price pill, focus rings).
export const FRIEND_HUES = ["#E8553D", "#D9A21B", "#149C8F", "#8B3F9E", "#5B7F2A"] as const;

/// Candle fills from the dark system: up filled #2BD67B, down filled
/// #FF6B57, bodies filled with wicks in the same hue. The volume strip
/// reuses the same fills.
export const UP_WASH = "#2BD67B";
export const DOWN_WASH = "#FF6B57";

export type RawCandle = { t: number; o: number; c: number; h: number; l: number; v: string; n: number };
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/// Perpl candles carry prices as integers scaled by the market's price decimals
/// (BTC has 1: 866780 is 86,678.0) and times in milliseconds. The chart wants
/// seconds and real prices. Volume arrives as a decimal string and is coerced
/// to a number, defaulting to 0 when Perpl sends nothing parseable rather than
/// dropping the candle.
export function scaleCandle(c: RawCandle, priceDecimals: number): Candle {
  if (!Number.isInteger(priceDecimals) || priceDecimals < 0) throw new Error(`bad priceDecimals ${priceDecimals}`);
  const f = 10 ** priceDecimals;
  const volume = Number(c.v);
  return {
    time: Math.floor(c.t / 1000),
    open: c.o / f,
    high: c.h / f,
    low: c.l / f,
    close: c.c / f,
    volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
  };
}

/// Volume bar colour: the same wash as the candle that printed it, so the
/// footer strip reads as an extension of the candles above it.
export function volumeColorFor(candle: Pick<Candle, "open" | "close">): string {
  return candle.close >= candle.open ? UP_WASH : DOWN_WASH;
}

/// A trader keeps the same colour on every market and every reload: the hue is a
/// hash of their address, not their position in a list that reorders by PnL.
export function colourFor(address: string): string {
  const a = address.toLowerCase();
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return FRIEND_HUES[h % FRIEND_HUES.length];
}

/// Colours for everyone currently in the room, all distinct while the room has no more
/// traders than there are hues. Each trader starts at their hashed hue and takes the
/// next free one on a collision; addresses are processed in sorted order so the result
/// depends only on who is in the room, not on the order they were listed. Hashing
/// alone put three of four real traders on the same plum.
export function assignColours(accounts: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<number>();
  const sorted = Array.from(new Set(accounts.map((a) => a.toLowerCase()))).sort();
  for (const a of sorted) {
    let i = FRIEND_HUES.indexOf(colourFor(a) as (typeof FRIEND_HUES)[number]);
    for (let k = 0; k < FRIEND_HUES.length && taken.has(i); k++) i = (i + 1) % FRIEND_HUES.length;
    taken.add(i);
    out.set(a, FRIEND_HUES[i]);
  }
  return out;
}

export function shortName(address: string): string {
  return `${address.slice(2, 6)}`.toUpperCase();
}

/// Room subtitle: market names already end in "Perp" ("BTC Perp"), so the
/// subtitle reads "<name> on Perpl", never "<name> perpetual on Perpl".
export function subtitleForMarket(marketName: string): string {
  return `${marketName} on Perpl`;
}

/// The two letters printed inside an on-chart avatar: the head of the
/// shortName, in surface colour on the friend's hue.
export function avatarLabel(address: string): string {
  return shortName(address).slice(0, 2);
}

/// The chart time an avatar sits at: the friend's entry time, or the last
/// candle when the position data has no entry time.
export function avatarTime(entryTime: number | null, lastTime: number): number {
  return entryTime ?? lastTime;
}

/// Room summary counts: how many visible friends are long vs short. Drives the
/// single split bar above the chart, long in --gain and short in --loss.
export function sideCounts(friends: Pick<Friend, "side">[]): { long: number; short: number } {
  let long = 0;
  let short = 0;
  for (const f of friends) {
    if (f.side === "long") long++;
    else short++;
  }
  return { long, short };
}

/// Change of a candle against the previous close, for the OHLC readout line.
/// Falls back to the candle's own open when there is no previous candle.
export function candleChange(candle: Pick<Candle, "open" | "close">, prevClose: number | null): { change: number; pct: number } {
  const base = prevClose ?? candle.open;
  const change = candle.close - base;
  return { change, pct: base === 0 ? 0 : (change / base) * 100 };
}

export function formatUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/// Price with the precision the market actually trades at, so MON at 0.0204 does not
/// render as 0.02 and BTC does not render with four meaningless decimals.
export function formatPrice(p: number, priceDecimals: number): string {
  return p.toLocaleString("en-US", { minimumFractionDigits: priceDecimals, maximumFractionDigits: priceDecimals });
}

export type Friend = {
  account: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  fundingPnl: number;
  entryBlock: string;
  entryTime: number | null;
};

export type Chip = {
  account: string;
  label: string;
  colour: string;
  side: "LONG" | "SHORT";
  inProfit: boolean;
  pnl: string;
  entry: string;
};

export function chipFor(f: Friend, priceDecimals: number, label?: string): Chip {
  return {
    account: f.account,
    label: label ?? shortName(f.account),
    colour: colourFor(f.account),
    side: f.side === "long" ? "LONG" : "SHORT",
    inProfit: f.unrealizedPnl >= 0,
    pnl: formatUsd(f.unrealizedPnl),
    entry: formatPrice(f.entryPrice, priceDecimals),
  };
}

/// Chips pinned at entry prices collide when two traders entered within a few pixels
/// of each other. Given the y coordinate of each entry, return y positions that keep
/// every chip at least `gap` apart while staying as close to its entry as possible.
export function stackChips(ys: number[], gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = new Array(ys.length);
  let last = -Infinity;
  for (const { y, i } of order) {
    const at = Math.max(y, last + gap);
    placed[i] = at;
    last = at;
  }
  return placed;
}

/// Sorted strongest first, the order of the "In the room" rail.
export function byPnl(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
}

/// The visible price range widens the library's own visible-candle range to
/// fit the selected trader's TP and SL lines only. Friends' entry prices
/// never stretch the scale: an entry far below or above the candles would
/// squash them into a thin band, so entries are deliberately ignored here
/// and rendered as edge markers instead.
export function visiblePriceRange(
  base: { min: number; max: number } | null,
  tp: number | null | undefined,
  sl: number | null | undefined,
): { min: number; max: number } | null {
  let lo = base && Number.isFinite(base.min) && Number.isFinite(base.max) ? base.min : Infinity;
  let hi = base && Number.isFinite(base.min) && Number.isFinite(base.max) ? base.max : -Infinity;
  for (const p of [tp, sl]) {
    if (typeof p === "number" && Number.isFinite(p)) {
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { min: lo, max: hi };
}

export type AvatarMode = "candle" | "top" | "bottom";

/// Where a friend's 22px initials circle sits. On-candle when the entry time
/// maps to an x coordinate and the entry price maps to a y inside the pane;
/// otherwise pinned to the top or bottom edge. Callers pass the chart's own
/// converters (time via chart.timeScale().timeToCoordinate, price via
/// series.priceToCoordinate) so the decision matches what is on screen.
export function placeAvatar(opts: {
  entryTime: number | null;
  entryPrice: number;
  firstTime: number;
  lastTime: number;
  viewMin: number;
  viewMax: number;
  timeToX: (t: number) => number | null;
  priceToY: (p: number) => number | null;
  height: number;
  avatar?: number;
  /// Candle length in seconds. Entries are snapped to the start of the candle that contains them, so an
  /// entry inside the newest, still-open candle lands on it instead of being pushed to the edge.
  barSeconds?: number;
}): { mode: AvatarMode; x: number; y: number } {
  const size = opts.avatar ?? 22;
  const half = size / 2;
  const bar = opts.barSeconds && opts.barSeconds > 0 ? opts.barSeconds : 0;
  const t = typeof opts.entryTime === "number" && Number.isFinite(opts.entryTime) ? opts.entryTime : null;
  const snapped = t === null ? null : bar ? opts.firstTime + Math.floor((t - opts.firstTime) / bar) * bar : t;
  const inTime = snapped !== null && snapped >= opts.firstTime && snapped <= opts.lastTime;
  const xRaw = inTime ? opts.timeToX(snapped as number) : null;
  const yRaw = opts.priceToY(opts.entryPrice);
  const xOk = typeof xRaw === "number" && Number.isFinite(xRaw);
  const yOk = typeof yRaw === "number" && Number.isFinite(yRaw) && (yRaw as number) >= 0 && (yRaw as number) <= opts.height;
  const priceIn = opts.entryPrice >= opts.viewMin && opts.entryPrice <= opts.viewMax;
  if (xOk && yOk && priceIn) return { mode: "candle", x: xRaw as number, y: yRaw as number };
  const fallbackX = opts.timeToX(opts.lastTime);
  const x = xOk ? (xRaw as number) : typeof fallbackX === "number" && Number.isFinite(fallbackX) ? fallbackX : 0;
  const above = opts.entryPrice >= opts.viewMax || (!priceIn && opts.entryPrice > (opts.viewMin + opts.viewMax) / 2);
  if (above) return { mode: "top", x, y: half };
  return { mode: "bottom", x, y: opts.height - half };
}
