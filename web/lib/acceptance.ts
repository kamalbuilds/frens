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
// position, so it matches the chart's own TP/SL tags.
export function bannerText(s: Suggestion, position: Position, priceDecimals: number): string {
  const kind = suggestionKind(s, position.markPrice);
  const pnl = pnlAtPrice(s.price, position.entryPrice, position.size, position.side);
  return `${shortName(s.from)} suggests a ${kind} at ${formatPrice(s.price, priceDecimals)} on ${shortName(s.owner)}'s ${position.side} (${formatUsd(pnl)})`;
}

export type Acceptance =
  | { status: "empty" }
  | { status: "malformed"; reason: string }
  | { status: "stale"; reason: string; suggestion: Suggestion }
  | { status: "valid"; suggestion: Suggestion; kind: SuggestionKind; text: string };

// Gate for the Accept button: only the suggestion owner can place the close
// order. Comparison is case-insensitive because addresses checksum differently
// across wallets. Returns ok, or the exact notice the banner should show.
export function acceptOwnerCheck(
  connected: string | null | undefined,
  s: Suggestion,
): { ok: true } | { ok: false; reason: string } {
  if (!connected || connected.trim() === "") {
    return { ok: false, reason: "Connect the owner wallet to accept this." };
  }
  if (connected.trim().toLowerCase() !== s.owner.toLowerCase()) {
    return { ok: false, reason: `Only ${shortName(s.owner)} can accept this.` };
  }
  return { ok: true };
}

export function evaluateSuggestion(
  raw: string | null | undefined,
  opts: {
    positionFor: (s: Suggestion) => Position | null;
    priceDecimals: number;
    lotDecimals?: number | bigint;
  },
): Acceptance {
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
      reason: `${shortName(suggestion.owner)} has no open position on this market right now, so this suggestion is stale.`,
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
    return { status: "stale", reason: problems[0] as string, suggestion };
  }
  return {
    status: "valid",
    suggestion,
    kind: suggestionKind(suggestion, position.markPrice),
    text: bannerText(suggestion, position, opts.priceDecimals),
  };
}
