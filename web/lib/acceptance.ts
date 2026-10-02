// Pure receiving-side logic for suggestion links (?s=<payload>).
//
// ChartRoom.tsx creates links with encodeSuggestion from suggest.ts. This
// module never touches the network, the DOM, or a wallet: it decodes the
// payload, checks it against the owner's live room position with
// validateSuggestion, and formats the one-line banner text. The client
// component in app/SuggestionBanner.tsx renders whatever this returns, so a
// malformed or stale link becomes a muted notice, never a crash.
import { decodeSuggestion, validateSuggestion, type Suggestion } from "./suggest";
import type { Position } from "./readPosition";
import { pnlAtPrice } from "./drag";
import { formatPrice, formatUsd, shortName } from "./chart";

export type SuggestionKind = "TP" | "SL";

// Whether the suggested price rests on the take-profit side of the mark or
// the stop-loss side. Longs profit above the mark, shorts below, so a long
// suggestion above mark (or a short below mark) reads as a TP and anything
// on the other side reads as an SL. The label is descriptive only: whether
// the suggestion is acceptable is decided by validateSuggestion, which only
// accepts take-profit direction.
export function suggestionKind(s: Suggestion, markPrice: number): SuggestionKind {
  if (s.side === "long") return s.price > markPrice ? "TP" : "SL";
  return s.price < markPrice ? "TP" : "SL";
}

// One-line banner text: "<from> suggests a <TP|SL> at <price> on <owner>'s
// <side> (<signed PnL>)". PnL comes from pnlAtPrice against the owner's room
// position, so it matches the chart's own TP/SL tags. Addresses render
// through nameFor so room nicknames show instead of the 4-char address.
export function bannerText(
  s: Suggestion,
  position: Position,
  priceDecimals: number,
  nameFor: (addr: string) => string = shortName,
): string {
  const kind = suggestionKind(s, position.markPrice);
  const pnl = pnlAtPrice(s.price, position.entryPrice, position.size, position.side);
  return `${nameFor(s.from)} suggests a ${kind} at ${formatPrice(s.price, priceDecimals)} on ${nameFor(s.owner)}'s ${position.side} (${formatUsd(pnl)})`;
}

// validateSuggestion speaks in raw checks ("must be above the mark price
// 84008.9, got 70000"). The banner shows whatever this module returns, so
// rewrite each known problem as a plain sentence with formatted prices.
function friendlyReason(
  raw: string,
  s: Suggestion,
  position: Position,
  priceDecimals: number,
  nameFor: (addr: string) => string = shortName,
): string {
  const who = nameFor(s.owner);
  if (/take-profit for a long must be above/i.test(raw)) {
    return (
      `This take-profit (${formatPrice(s.price, priceDecimals)}) is below the current price ` +
      `(${formatPrice(position.markPrice, priceDecimals)}), so it would close ${who}'s long right away at the current price instead of waiting for the target.`
    );
  }
  if (/take-profit for a short must be below/i.test(raw)) {
    return (
      `This take-profit (${formatPrice(s.price, priceDecimals)}) is above the current price ` +
      `(${formatPrice(position.markPrice, priceDecimals)}), so it would close ${who}'s short right away at the current price instead of waiting for the target.`
    );
  }
  if (/does not match the position account/i.test(raw)) {
    return (
      `This suggestion is for ${who}, but the open position here belongs to ` +
      `${nameFor(position.account)}, so it cannot be applied here.`
    );
  }
  if (/but the position is on market/i.test(raw)) {
    return "This suggestion is for another market, so it cannot be applied to this position.";
  }
  if (/take-profit but the position is/i.test(raw)) {
    return (
      `This suggestion is for a ${s.side}, but the open position is ${position.side}, ` +
      "so it cannot be applied here."
    );
  }
  if (/must be a positive number/i.test(raw)) {
    return "This suggestion has no usable price, so it cannot be placed.";
  }
  if (/must be positive/i.test(raw)) {
    return "This suggestion has no usable size, so there is nothing to close.";
  }
  if (/exceeds the position size/i.test(raw)) {
    return `This suggestion asks for more than ${who} holds, so it cannot be filled as written.`;
  }
  return raw;
}

export type Acceptance =
  | { status: "empty" }
  | { status: "malformed"; reason: string }
  | { status: "stale"; reason: string; suggestion: Suggestion }
  | { status: "valid"; suggestion: Suggestion; kind: SuggestionKind; text: string };

// Notice shown when Accept replaces the owner's resting TP: the one line the
// task requires, with the old price formatted for the market.
export function replacementNotice(oldPrice: number, priceDecimals: number, owner: string): string {
  return `Replaces ${owner}'s TP at ${formatPrice(oldPrice, priceDecimals)}`;
}

// A resting close at the call's own price means the owner already took this
// call: Accept would cancel and re-place the identical order for gas.
export function alreadyTaken(resting: { price: number }[], price: number, priceDecimals: number): boolean {
  const tick = 10 ** -priceDecimals;
  return resting.some((r) => Math.abs(r.price - price) < tick / 2);
}

// Gate for the Accept button: only the suggestion owner can place the close
// order. Comparison is case-insensitive because addresses checksum differently
// across wallets. Returns ok, or the exact notice the banner should show.
export function acceptOwnerCheck(
  connected: string | null | undefined,
  s: Suggestion,
  nameFor: (addr: string) => string = shortName,
): { ok: true } | { ok: false; reason: string } {
  if (!connected || connected.trim() === "") {
    return { ok: false, reason: "Connect the owner wallet to accept this." };
  }
  if (connected.trim().toLowerCase() !== s.owner.toLowerCase()) {
    return { ok: false, reason: `Only ${nameFor(s.owner)} can accept this.` };
  }
  return { ok: true };
}

export function evaluateSuggestion(
  raw: string | null | undefined,
  opts: {
    positionFor: (s: Suggestion) => Position | null;
    priceDecimals: number;
    lotDecimals?: number | bigint;
    nameFor?: (addr: string) => string;
  },
): Acceptance {
  const nameFor = opts.nameFor ?? shortName;
  if (raw === null || raw === undefined || raw === "") return { status: "empty" };
  let suggestion: Suggestion | null = null;
  try {
    suggestion = decodeSuggestion(raw);
  } catch {
    suggestion = null;
  }
  if (suggestion === null) {
    return { status: "malformed", reason: "That suggestion link is malformed and cannot be opened." };
  }
  let position: Position | null = null;
  try {
    position = opts.positionFor(suggestion);
  } catch {
    position = null;
  }
  if (position === null) {
    return {
      status: "stale",
      reason: `${nameFor(suggestion.owner)} has no open position on this market right now, so this suggestion is stale.`,
      suggestion,
    };
  }
  let problems: string[] = [];
  try {
    problems = validateSuggestion(suggestion, position, opts.lotDecimals);
  } catch (e) {
    return {
      status: "stale",
      reason: e instanceof Error ? e.message : String(e),
      suggestion,
    };
  }
  if (problems.length > 0) {
    return { status: "stale", reason: friendlyReason(problems[0] as string, suggestion, position, opts.priceDecimals, nameFor), suggestion };
  }
  return {
    status: "valid",
    suggestion,
    kind: suggestionKind(suggestion, position.markPrice),
    text: bannerText(suggestion, position, opts.priceDecimals, nameFor),
  };
}
