import { CLOSE_LONG, CLOSE_SHORT } from "./suggest";

export function callHit(
  orderType: number,
  price: number,
  candles: { time: number; high: number; low: number }[],
  sinceSec: number,
  barSec: number,
): boolean {
  if (!Number.isFinite(price)) return false;
  if (!Array.isArray(candles) || candles.length === 0) return false;
  if (orderType !== CLOSE_LONG && orderType !== CLOSE_SHORT) return false;
  for (const c of candles) {
    if (!(c.time + barSec > sinceSec)) continue;
    if (orderType === CLOSE_LONG && c.high >= price) return true;
    if (orderType === CLOSE_SHORT && c.low <= price) return true;
  }
  return false;
}
