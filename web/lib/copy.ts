// Copy a friend's Perpl position in one tap.
//
// The copier opens their own position on the friend's market and side, for the
// copier's own size, as a marketable limit IOC bounded by maxSlippageBps off
// the mark price. That is the same order shape trade.ts proved for OPEN_LONG on
// a testnet fork: immediateOrCancel with a marketable limit, no post-only, and
// the market-cap collateral buffer without which a taker fill that starts below
// mark reverts with TakerOrderSettlementFailed.
//
// Nothing here is custodial and no key is involved: toCopyOrder only builds the
// struct, encodeCopyOrder turns it into execOrderV2 calldata with frens' builder attribution, and wallet.ts hands
// that calldata to the copier's own EIP-1193 wallet to sign. The order stays
// visible and refusable in the wallet's own confirmation UI.
import { builderExtension, encodeOrderV2, FRENS_BUILDER_ID } from "./builder";
import type { Hex } from "viem";
import type { PerpMeta } from "./readPosition";
import {
  LEVERAGE_HDTHS,
  MAX_NEG_PNL_COLLAT_BPS,
  OPEN_LONG,
  OPEN_SHORT,
  encodeCloseOrder,
  priceToPNS,
  sizeToLots,
  type CloseOrderDesc,
} from "./suggest";

// execOrder takes one OrderDesc struct. suggest.ts already mirrors the on-chain
// layout field for field, and a copy order is that same struct with different
// flags, so reuse the type rather than re-declaring a 15-field shape that could
// drift from the ABI.
export type CopyOrderDesc = CloseOrderDesc;

// What the copier takes from the friend: which market, which direction. There
// is deliberately no size here, so the friend's position size cannot leak into
// the copier's order.
export type FriendTrade = { market: number; side: "long" | "short" };

const BPS = 10_000n;
// 1 bps keeps the bound tight enough to be a real limit; 500 bps is 5%, the
// most a one-tap copy should ever pay to get filled.
const MIN_SLIPPAGE_BPS = 1;
const MAX_SLIPPAGE_BPS = 500;

// A copy is the opposite trade from the resting take-profit suggest.ts prices:
// there the friend is the maker and a tick of rounding in the friend's favour is
// fine, here the copier is the taker paying the fill. Every rounding in a
// slippage bound therefore has to point away from the copier.
//
// The mark is a whole number of ticks on chain, but a mark that arrived rounded
// or estimated is not, so it is scaled in the copier's own direction:
// priceToPNS floors a "long" and ceils a "short". Flooring a long's mark can
// only pull its bid down and ceiling a short's mark can only push its offer up,
// so the bound the copier agreed to is never inflated.
//
// The bound rounds the same way, because the limit price is a whole tick and
// has to be the best tick inside the promise: a buying long floors, so the bid
// is never above mark * (1 + bps), and a selling short ceils, so the offer is
// never below mark * (1 - bps). The one-tick cost of that is an order that can
// miss a fill it was allowed to take, which is the safe direction to be off by.
//
// The bps are then applied as integer math on ticks, never as
// markPrice * (1 + bps/1e4) in doubles. Doubles are not merely imprecise here,
// they are one tick tight on about one bound in twenty: 20 at 50 bps is 20.1
// exactly, which in doubles is 20.099999999999998, and flooring it lands a tick
// under the slippage the copier chose. The copier would watch a fill they paid
// for never happen and have no way to see why.
function slippageLimitPNS(
  markPrice: number,
  maxSlippageBps: number,
  priceDecimals: number | bigint,
  side: "long" | "short",
): bigint {
  const markPNS = priceToPNS(markPrice, priceDecimals, side);
  const bps = BigInt(maxSlippageBps);
  const limit = side === "long" ? (markPNS * (BPS + bps)) / BPS : ceilDiv(markPNS * (BPS - bps), BPS);
  if (limit <= 0n) {
    throw new RangeError(
      `a ${maxSlippageBps} bps bound on mark ${markPrice} rounds to a zero limit price, which cannot fill as a taker order`,
    );
  }
  return limit;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

// Build the copy order: same market and side as the friend, the copier's own
// size, OPEN_LONG or OPEN_SHORT by side, immediateOrCancel with a limit that is
// exactly maxSlippageBps worse than mark, postOnly off so the order can take
// liquidity, plus the same proven 3x leverage field and non-zero collateral
// buffer trade.ts uses. The copier can refuse or edit all of it in their wallet.
//
// Throws rather than returning a degenerate order: a non-positive size or mark,
// a slippage bound outside 1..500 bps, a bad market, or a size too small to be
// one whole lot would each produce an order that cannot trade.
export function toCopyOrder(
  friend: FriendTrade,
  meta: Pick<PerpMeta, "priceDecimals" | "lotDecimals">,
  opts: { size: number; markPrice: number; maxSlippageBps: number; orderDescId: bigint },
): CopyOrderDesc {
  if (friend.side !== "long" && friend.side !== "short") {
    throw new Error(`friend side must be long or short, got ${String(friend.side)}`);
  }
  if (!Number.isSafeInteger(friend.market) || friend.market < 0) {
    throw new Error(`friend market must be a non-negative integer, got ${String(friend.market)}`);
  }
  if (typeof opts.size !== "number" || !Number.isFinite(opts.size) || opts.size <= 0) {
    throw new Error(`copy size must be a positive number of base units, got ${String(opts.size)}`);
  }
  if (typeof opts.markPrice !== "number" || !Number.isFinite(opts.markPrice) || opts.markPrice <= 0) {
    throw new Error(`copy mark price must be a positive number, got ${String(opts.markPrice)}`);
  }
  if (
    !Number.isInteger(opts.maxSlippageBps) ||
    opts.maxSlippageBps < MIN_SLIPPAGE_BPS ||
    opts.maxSlippageBps > MAX_SLIPPAGE_BPS
  ) {
    throw new Error(
      `maxSlippageBps must be a whole number of basis points in ${MIN_SLIPPAGE_BPS}..${MAX_SLIPPAGE_BPS}, got ${String(opts.maxSlippageBps)}`,
    );
  }
  if (typeof opts.orderDescId !== "bigint") {
    throw new Error(`orderDescId must be a bigint, got ${String(opts.orderDescId)}`);
  }
  const lotLNS = sizeToLots(opts.size, meta.lotDecimals);
  if (lotLNS === 0n) {
    throw new Error(
      `copy size ${opts.size} is under one whole lot at ${String(meta.lotDecimals)} lot decimals, so the order would trade nothing`,
    );
  }
  return {
    orderDescId: opts.orderDescId,
    perpId: BigInt(friend.market),
    orderType: friend.side === "long" ? OPEN_LONG : OPEN_SHORT,
    orderId: 0n,
    pricePNS: slippageLimitPNS(opts.markPrice, opts.maxSlippageBps, meta.priceDecimals, friend.side),
    lotLNS,
    expiryBlock: 0n,
    // A copy is a taker order, so postOnly must be off: trade.ts places the
    // open with postOnly false, and a post-only order crossed at the limit
    // would be rejected and never fill.
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: 0n,
    leverageHdths: LEVERAGE_HDTHS,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: MAX_NEG_PNL_COLLAT_BPS,
  };
}

// A copy goes out as execOrderV2 carrying frens' builder attribution (Perpl builder id 23, proven on chain by
// spike/builder-probe.ts). COPY_BUILDER_FEE_PER_100K is the fee frens charges on the size a copy opens: 0 until Kamal
// sets one (max 1,000 = 1%). The copier signs these bytes in their own wallet.
export const COPY_BUILDER_FEE_PER_100K = 0;
export function encodeCopyOrder(order: CopyOrderDesc): Hex {
  return encodeOrderV2(order, builderExtension(FRENS_BUILDER_ID, COPY_BUILDER_FEE_PER_100K));
}
