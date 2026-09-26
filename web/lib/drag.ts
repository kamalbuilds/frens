/// Pure helpers for drag-to-suggest TP/SL lines in ChartRoom.
/// Kept free of the chart library so they can be unit tested.

export type Side = "long" | "short";
export type SuggestKind = "tp" | "sl";

/// Starting placement for the draggable lines: mark +/- 2 percent.
/// TP sits in profit relative to the current mark (above mark for a long,
/// below for a short), SL sits the same distance the other way. Starting
/// from entry is wrong when the position has moved: a long TP below the
/// current mark would fill immediately.
export function initialTpSl(markPrice: number, side: Side): { tp: number; sl: number } {
  if (!Number.isFinite(markPrice) || markPrice <= 0) throw new RangeError(`bad entry ${String(markPrice)}`);
  if (side !== "long" && side !== "short") throw new RangeError(`bad side ${String(side)}`);
  return side === "long"
    ? { tp: markPrice * 1.02, sl: markPrice * 0.98 }
    : { tp: markPrice * 0.98, sl: markPrice * 1.02 };
}

/// Whether a TP/SL `price` can rest where it is without filling immediately
/// against the current `mark`: a long's TP must stay above mark and its SL
/// below mark; a short's the opposite.
export function validTpSl(kind: SuggestKind, price: number, mark: number, side: Side): boolean {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(mark) || mark <= 0) return false;
  if (side === "long") return kind === "tp" ? price > mark : price < mark;
  if (side === "short") return kind === "tp" ? price < mark : price > mark;
  return false;
}

/// Clamp a dragged or nudged line to the nearest valid tick instead of
/// letting it cross the mark. Valid prices pass through untouched;
/// invalid ones snap to one tick on the_profitable side of the mark.
export function clampTpSl(kind: SuggestKind, price: number, mark: number, side: Side, priceDecimals: number): number {
  if (validTpSl(kind, price, mark, side)) return price;
  const tick = tickSize(priceDecimals);
  const factor = 10 ** priceDecimals;
  const above = side === "long" ? kind === "tp" : kind === "sl";
  return Math.round((mark + (above ? tick : -tick)) * factor) / factor;
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
