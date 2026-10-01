/// Ghost suggestion line: pure logic for the friend suggestion centrepiece.
///
/// When a suggestion link (?s=<payload>) is open, the owner's chart draws it
/// as a ghost line in the suggester's hue. This module holds the pieces that
/// do not need the chart library or the DOM, so they can be unit tested:
/// the 60% opacity ghost colour (8-digit hex, never CSS color-mix which
/// lightweight-charts v5 cannot parse), the axis pill label text, and the
/// counter suggestion construction (owner/from swapped via encodeSuggestion
/// in the banner).
import type { Address } from "viem";
import { colourFor, formatPrice, formatUsd, shortName } from "./chart";
import type { Suggestion } from "./suggest";

/// Append an alpha byte to a #RRGGBB hex. alpha 0 is transparent, 1 is solid.
/// Returns an 8-digit hex the chart library parses as-is (no color-mix).
export function hexWithAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new RangeError(`bad hex ${hex}`);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError(`bad alpha ${String(alpha)}`);
  const byte = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${byte}`;
}

/// The suggester's hue at 60% opacity for the dashed ghost line.
export function ghostColorFor(from: string): string {
  return hexWithAlpha(colourFor(from), 0.6);
}

/// Axis pill text for the ghost line: "<FROM> TP <price> <signed PnL>".
/// PnL comes from pnlAtPrice against the owner's room position, so it matches
/// the chart's own TP/SL tags. Valid suggestions rest on the take-profit side,
/// so the pill always reads TP.
export function ghostLabelText(opts: { from: string; price: number; pnl: number; priceDecimals: number }): string {
  return `${shortName(opts.from)} · TP ${formatPrice(opts.price, opts.priceDecimals)} · ${formatUsd(opts.pnl)}`;
}

/// Build the counter suggestion after the owner drags the ghost line to their
/// own price. Owner and from swap, market and side stay, size carries over;
/// the banner encodes it with encodeSuggestion into a "Send counter link".
export function buildCounterSuggestion(original: Suggestion, price: number, now?: number): Suggestion {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new RangeError(`cannot counter at a non-positive price: ${String(price)}`);
  }
  return {
    owner: original.from as Address,
    market: original.market,
    side: original.side,
    price,
    sizeLots: original.sizeLots,
    from: original.owner as Address,
    createdAt: now ?? Date.now(),
  };
}
