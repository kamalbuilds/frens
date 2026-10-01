// Friend take-profit suggestions for Chartroom.
//
// A friend sees your live position on the chart and suggests a take-profit
// price. The suggestion travels as a compact base64url payload in a share
// link, and accepting it places the same resting reduce-only close order that
// src/trade.ts proved on a testnet fork (CloseLong/CloseShort, post-only GTC,
// maxNegPnlCollatBPS non-zero).
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import { suggestionDescId } from "./callbook";
import { exchangeAbi } from "./perpl";
import type { PerpMeta, Position } from "./readPosition";

export type Suggestion = {
  owner: Address;
  market: number;
  side: "long" | "short";
  price: number;
  sizeLots?: bigint;
  from: Address;
  createdAt: number;
};

// On-chain order types, 0-indexed dex-sdk RequestType. trade.ts proves
// OPEN_LONG = 0, CLOSE_LONG = 2 and CANCEL = 4 on a testnet fork. The enum
// interleaves open/close pairs, so OPEN_SHORT = 1 and CLOSE_SHORT = 3 follow
// the only consistent reading; the short close still needs an on-chain
// read-back before it is trusted the way trade.ts trusted the long close.
export const OPEN_LONG = 0;
export const OPEN_SHORT = 1;
export const CLOSE_LONG = 2;
export const CLOSE_SHORT = 3;
export const CANCEL = 4;

// trade.ts uses a fixed 3x leverage field on every order (open, resting TP,
// IOC close) and the market cap 1000 for maxNegPnlCollatBPS. The leverage
// field is carried on closes for encoding parity; the collateral buffer is
// load-bearing: a zero maxNegPnlCollatBPS makes a fill that starts below mark
// revert with TakerOrderSettlementFailed.
export const LEVERAGE_HDTHS = 300n;
export const MAX_NEG_PNL_COLLAT_BPS = 1000n;

// execOrder takes a single OrderDesc struct. This mirrors the OrderDesc shape
// in src/trade.ts field for field so the encoding matches exactly.
export type CloseOrderDesc = {
  orderDescId: bigint;
  perpId: bigint;
  orderType: number;
  orderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  expiryBlock: bigint;
  postOnly: boolean;
  fillOrKill: boolean;
  immediateOrCancel: boolean;
  maxMatches: bigint;
  leverageHdths: bigint;
  lastExecutionBlock: bigint;
  amountCNS: bigint;
  maxNegPnlCollatBPS: bigint;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function isAddress(v: unknown): v is Address {
  return typeof v === "string" && ADDRESS_RE.test(v);
}

// Browser-safe base64url. Buffer does not exist in browsers, so the UTF-8
// bytes go through TextEncoder/TextDecoder plus btoa/atob with the standard
// base64url alphabet (+/ to -_, padding stripped). The wire format matches
// Buffer's base64url exactly, so existing links still decode.
function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(str: string): string {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// The share payload is a fixed 7 slot JSON array: owner, market, side, price,
// size lots (decimal string) or null, from, createdAt. A fixed array keeps the
// link short and the decode strict.
export function encodeSuggestion(s: Suggestion): string {
  const payload = [
    s.owner,
    s.market,
    s.side,
    s.price,
    s.sizeLots === undefined ? null : s.sizeLots.toString(),
    s.from,
    s.createdAt,
  ];
  return encodeBase64Url(JSON.stringify(payload));
}

// Decodes a share payload. Returns null for anything malformed and never
// throws, so pasting garbage into the accept box cannot crash the page.
// Structural checks live here (right shapes and types); semantic checks
// (positive price, owner match, TP direction) live in validateSuggestion.
export function decodeSuggestion(str: string): Suggestion | null {
  try {
    if (typeof str !== "string" || str.length === 0 || !BASE64URL_RE.test(str)) return null;
    const json = decodeBase64Url(str);
    // Reject non-canonical input: anything that does not re-encode to itself
    // (wrong alphabet, padding, truncated bytes) is not one of our links.
    if (encodeBase64Url(json) !== str) return null;
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v) || v.length !== 7) return null;
    const [owner, market, side, price, sizeLots, from, createdAt] = v;
    if (!isAddress(owner)) return null;
    if (!Number.isInteger(market) || (market as number) < 0) return null;
    if (side !== "long" && side !== "short") return null;
    if (typeof price !== "number" || !Number.isFinite(price)) return null;
    if (sizeLots !== null && (typeof sizeLots !== "string" || !/^\d+$/.test(sizeLots))) return null;
    if (!isAddress(from)) return null;
    if (!Number.isInteger(createdAt) || (createdAt as number) < 0) return null;
    return {
      owner,
      market: market as number,
      side: side as "long" | "short",
      price,
      sizeLots: sizeLots === null ? undefined : BigInt(sizeLots as string),
      from,
      createdAt: createdAt as number,
    };
  } catch {
    return null;
  }
}

// Scale a positive decimal price or size by 10^decimals using the decimal
// digits of the value's shortest round-trip representation, never float
// multiplication. Float math is lossy here (73229.35 * 1e5 is
// 7322935000.000001 in doubles), and a one-tick error on a resting order is a
// wrong fill price, so the conversion must be exact.
function scaleDecimal(value: number, decimals: number | bigint, round: "floor" | "ceil"): bigint {
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) throw new RangeError(`bad decimals ${String(decimals)}`);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`cannot scale non-positive price ${value}`);
  const repr = value.toString();
  const e = repr.search(/e/i);
  const mantissa = e < 0 ? repr : repr.slice(0, e);
  const exp = e < 0 ? 0 : parseInt(repr.slice(e + 1), 10);
  const dot = mantissa.indexOf(".");
  const intPart = dot < 0 ? mantissa : mantissa.slice(0, dot);
  const fracPart = dot < 0 ? "" : mantissa.slice(dot + 1);
  const digits = intPart + fracPart;
  const pointIndex = intPart.length + exp;
  const whole = BigInt(digits);
  const shift = pointIndex - digits.length + d;
  if (shift >= 0) return whole * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const q = whole / divisor;
  const r = whole % divisor;
  if (round === "floor" || r === 0n) return q;
  return q + 1n;
}

// Convert a human-readable size (base units, as in Position.size) to integer
// lots. Always floors: suggesting or closing a fraction of a lot more than
// the position holds would over-close, so partial lots are dropped.
export function sizeToLots(size: number, lotDecimals: number | bigint): bigint {
  return scaleDecimal(size, lotDecimals, "floor");
}

// Scale a suggestion price to integer PNS ticks. Rounds toward the
// conservative side for the position owner: DOWN for a long take-profit, UP
// for a short take-profit. A long TP is a resting sell, so flooring the limit
// asks slightly less than suggested, which can only make the order more
// fillable; rounding up would ask MORE than the friend suggested and could
// leave a stale order resting above what anyone will pay. A short TP is a
// resting buy, so the mirror holds: ceiling bids slightly more, favoring a
// fill. Either way the owner is never promised a better price than the chain
// can represent, and the rounding error is always under one tick.
export function priceToPNS(price: number, priceDecimals: number | bigint, side: "long" | "short"): bigint {
  return scaleDecimal(price, priceDecimals, side === "long" ? "floor" : "ceil");
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Check a suggestion against the live on-chain position. Returns plain-English
// problems, or [] when the suggestion is acceptable. lotDecimals is needed for
// the size check because Position.size is in base units while sizeLots is in
// integer lots; when it is omitted the size check is skipped and the rest
// still runs.
export function validateSuggestion(
  s: Suggestion,
  position: Position,
  lotDecimals?: number | bigint,
): string[] {
  const problems: string[] = [];
  if (typeof s.price !== "number" || !Number.isFinite(s.price) || s.price <= 0) {
    problems.push(`price must be a positive number, got ${String(s.price)}`);
  }
  if (!sameAddress(s.owner, position.account)) {
    problems.push(`suggestion owner ${s.owner} does not match the position account ${position.account}`);
  }
  if (s.market !== position.market) {
    problems.push(`suggestion is for market ${s.market} but the position is on market ${position.market}`);
  }
  if (s.side !== position.side) {
    problems.push(`suggestion is for a ${s.side} take-profit but the position is ${position.side}`);
  }
  // Judge direction only when the price is usable and the sides agree; a bad
  // price or a side mismatch is already reported above.
  if (typeof s.price === "number" && Number.isFinite(s.price) && s.price > 0 && s.side === position.side) {
    if (s.side === "long" && !(s.price > position.markPrice)) {
      problems.push(`take-profit for a long must be above the mark price ${position.markPrice}, got ${s.price}`);
    }
    if (s.side === "short" && !(s.price < position.markPrice)) {
      problems.push(`take-profit for a short must be below the mark price ${position.markPrice}, got ${s.price}`);
    }
  }
  if (s.sizeLots !== undefined) {
    if (s.sizeLots <= 0n) {
      problems.push(`suggested size must be positive, got ${s.sizeLots.toString()} lots`);
    } else if (lotDecimals !== undefined) {
      const held = sizeToLots(position.size, lotDecimals);
      if (s.sizeLots > held) {
        problems.push(
          `suggested size of ${s.sizeLots.toString()} lots exceeds the position size of ${held.toString()} lots`,
        );
      }
    }
  }
  return problems;
}

// Build the resting reduce-only close order for a suggestion, using the exact
// arguments trade.ts uses: CloseLong/CloseShort by side, post-only GTC
// (expiry 0, no IOC/FOK flags), full or partial lots, and the proven 3x
// leverage field plus the non-zero 1000 BPS collateral buffer without which
// the order reverts. orderDescId defaults to suggestionDescId(s.from,
// s.createdAt), which packs the suggester into the top 160 bits so the
// callbook can rebuild the suggester's on-chain record from OrderRequest
// logs; retries of the same suggestion reuse the id instead of stacking
// duplicates; pass an explicit id to place a fresh order.
export function toCloseOrder(
  s: Suggestion,
  meta: Pick<PerpMeta, "priceDecimals" | "lotDecimals">,
  opts: { orderDescId?: bigint; fullSizeLots?: bigint } = {},
): CloseOrderDesc {
  if (typeof s.price !== "number" || !Number.isFinite(s.price) || s.price <= 0) {
    throw new Error(`cannot build a close order for a non-positive price: ${String(s.price)}`);
  }
  const lotLNS = s.sizeLots ?? opts.fullSizeLots;
  if (lotLNS === undefined || lotLNS <= 0n) {
    throw new Error("suggestion carries no size; pass fullSizeLots to close the whole position");
  }
  return {
    orderDescId: opts.orderDescId ?? suggestionDescId(s.from, s.createdAt),
    perpId: BigInt(s.market),
    orderType: s.side === "long" ? CLOSE_LONG : CLOSE_SHORT,
    orderId: 0n,
    pricePNS: priceToPNS(s.price, meta.priceDecimals, s.side),
    lotLNS,
    expiryBlock: 0n,
    postOnly: true,
    fillOrKill: false,
    immediateOrCancel: false,
    maxMatches: 0n,
    leverageHdths: LEVERAGE_HDTHS,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: MAX_NEG_PNL_COLLAT_BPS,
  };
}

// Encode the close order as execOrder calldata against the Exchange ABI, the
// same call trade.ts sends with cast. Throws if the struct ever drifts from
// the on-chain OrderDesc layout, which is the point: drift must fail loudly
// here, not as a reverted take-profit.
export function encodeCloseOrder(order: CloseOrderDesc): Hex {
  return encodeFunctionData({ abi: exchangeAbi, functionName: "execOrder", args: [order] });
}

export function decodeCloseOrder(data: Hex): CloseOrderDesc {
  const decoded = decodeFunctionData({ abi: exchangeAbi, data });
  if (decoded.functionName !== "execOrder") throw new Error(`expected execOrder calldata, got ${decoded.functionName}`);
  if (!decoded.args || decoded.args.length !== 1) throw new Error("execOrder calldata has no order argument");
  return decoded.args[0] as CloseOrderDesc;
}
