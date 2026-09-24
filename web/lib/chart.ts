/// Pure pieces of the chart, kept apart from the chart library so they can be tested.

/// Friend hues from DESIGN.md. One per trader, used only for their chip and line.
export const FRIEND_HUES = ["#E8553D", "#2F5BEA", "#D9A21B", "#149C8F", "#8B3F9E"] as const;

export type RawCandle = { t: number; o: number; c: number; h: number; l: number; v: string; n: number };
export type Candle = { time: number; open: number; high: number; low: number; close: number };

/// Perpl candles carry prices as integers scaled by the market's price decimals
/// (BTC has 1: 866780 is 86,678.0) and times in milliseconds. The chart wants
/// seconds and real prices.
export function scaleCandle(c: RawCandle, priceDecimals: number): Candle {
  if (!Number.isInteger(priceDecimals) || priceDecimals < 0) throw new Error(`bad priceDecimals ${priceDecimals}`);
  const f = 10 ** priceDecimals;
  return { time: Math.floor(c.t / 1000), open: c.o / f, high: c.h / f, low: c.l / f, close: c.c / f };
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

export function chipFor(f: Friend, priceDecimals: number): Chip {
  return {
    account: f.account,
    label: shortName(f.account),
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
