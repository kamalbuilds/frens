/// Pure helpers for drag-to-suggest TP/SL lines in ChartRoom.
/// Kept free of the chart library so they can be unit tested.

export type Side = "long" | "short";
export type SuggestKind = "tp" | "sl";

/// Starting placement for the draggable lines: entry +/- 2 percent.
/// TP sits in profit (above entry for a long, below for a short),
/// SL sits the same distance the other way.
export function initialTpSl(entryPrice: number, side: Side): { tp: number; sl: number } {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new RangeError(`bad entry ${String(entryPrice)}`);
  if (side !== "long" && side !== "short") throw new RangeError(`bad side ${String(side)}`);
  return side === "long"
    ? { tp: entryPrice * 1.02, sl: entryPrice * 0.98 }
    : { tp: entryPrice * 0.98, sl: entryPrice * 1.02 };
}

/// Realised PnL in quote currency if the position closed at `price`.
/// Longs gain when price rises above entry, shorts when it falls below.
export function pnlAtPrice(price: number, entryPrice: number, size: number, side: Side): number {
  if (side === "long") return (price - entryPrice) * size;
  return (entryPrice - price) * size;
}

/// One price tick for a market with `priceDecimals` decimals.
export function tickSize(priceDecimals: number): number {
  if (!Number.isInteger(priceDecimals) || priceDecimals < 0 || priceDecimals > 12) {
    throw new RangeError(`bad priceDecimals ${String(priceDecimals)}`);
  }
  return 10 ** -priceDecimals;
}

/// Nudge a line price by one tick. Rounds through the tick grid so repeated
/// arrow presses never drift on float error (0.1 + 0.2 style).
export function nudgePrice(price: number, priceDecimals: number, dir: 1 | -1): number {
  const tick = tickSize(priceDecimals);
  const factor = 10 ** priceDecimals;
  return Math.round((price + dir * tick) * factor) / factor;
}

/// Convert a pointer y (CSS px within the chart box) to a price using the
/// series converter. Thin wrapper so the component's drag math stays testable.
export function priceFromY(
  y: number,
  coordinateToPrice: (y: number) => number | null,
): number | null {
  const p = coordinateToPrice(y);
  if (p === null || typeof p !== "number" || !Number.isFinite(p) || p <= 0) return null;
  return p;
}
