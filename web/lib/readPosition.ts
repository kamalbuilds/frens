import type { Address, PublicClient } from "viem";
import { COLLATERAL_DECIMALS, exchangeAbi, NETWORKS, publicClient, type Network } from "./perpl";

export type RawPosition = {
  accountId: bigint;
  positionType: number; // 0 long, 1 short
  depositCNS: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  entryBlock: bigint;
  pnlCNS: bigint;
  deltaPnlCNS: bigint;
  premiumPnlCNS: bigint;
  priceResiduePNSQ16: bigint;
};

export type PerpMeta = { symbol: string; priceDecimals: bigint; lotDecimals: bigint };

export type Position = {
  account: Address;
  accountId: bigint;
  market: number;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  markValid: boolean;
  deposit: number;
  deltaPnl: number; // price PnL at mark, as computed by the Exchange contract
  fundingPnl: number; // premium (funding) PnL
  unrealizedPnl: number;
  entryBlock: bigint;
  block: bigint;
};

const Q16 = 65536;

// Mirrors dex-sdk Position::effective_entry_price: the contract stores a rounded
// PNS price (ceil for longs, floor for shorts) plus a 16-bit residue.
export function effectiveEntryPrice(positionType: number, pricePNS: bigint, residueQ16: bigint, priceDecimals: bigint): number {
  const scale = 10 ** Number(priceDecimals);
  if (residueQ16 === 0n) return Number(pricePNS) / scale;
  let p = Number(pricePNS);
  if (positionType === 0 && p >= 1) p -= 1;
  return (p + Number(residueQ16) / Q16) / scale;
}

export function decodePosition(
  raw: RawPosition,
  markPricePNS: bigint,
  markValid: boolean,
  meta: PerpMeta,
  ctx: { account: Address; market: number; block: bigint },
): Position | null {
  if (raw.lotLNS === 0n) return null;
  if (raw.positionType !== 0 && raw.positionType !== 1) throw new Error(`unknown positionType ${raw.positionType}`);
  const c = 10 ** COLLATERAL_DECIMALS;
  const deltaPnl = Number(raw.deltaPnlCNS) / c;
  const fundingPnl = Number(raw.premiumPnlCNS) / c;
  return {
    account: ctx.account,
    accountId: raw.accountId,
    market: ctx.market,
    symbol: meta.symbol,
    side: raw.positionType === 0 ? "long" : "short",
    size: Number(raw.lotLNS) / 10 ** Number(meta.lotDecimals),
    entryPrice: effectiveEntryPrice(raw.positionType, raw.pricePNS, raw.priceResiduePNSQ16, meta.priceDecimals),
    markPrice: Number(markPricePNS) / 10 ** Number(meta.priceDecimals),
    markValid,
    deposit: Number(raw.depositCNS) / c,
    deltaPnl,
    fundingPnl,
    unrealizedPnl: deltaPnl + fundingPnl,
    entryBlock: raw.entryBlock,
    block: ctx.block,
  };
}

// Independent check on the contract's deltaPnl: side * (mark - entry) * size.
export function expectedDeltaPnl(p: Position): number {
  return (p.side === "long" ? 1 : -1) * (p.markPrice - p.entryPrice) * p.size;
}

const metaCache = new Map<string, PerpMeta>();

export async function readPerpMeta(client: PublicClient, exchange: Address, market: number, blockNumber?: bigint): Promise<PerpMeta> {
  const key = `${exchange}:${market}`;
  const hit = metaCache.get(key);
  if (hit) return hit;
  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [BigInt(market)],
    blockNumber,
  })) as { symbol: string; priceDecimals: bigint; lotDecimals: bigint };
  const meta = { symbol: info.symbol, priceDecimals: info.priceDecimals, lotDecimals: info.lotDecimals };
  metaCache.set(key, meta);
  return meta;
}

// Reads an account's live position in one market straight from the Exchange contract.
// Returns null when the address has no Perpl account or no open position in that market.
export async function readPosition(
  account: Address,
  market: number,
  opts: { network?: Network; client?: PublicClient; blockNumber?: bigint } = {},
): Promise<Position | null> {
  const network = opts.network ?? "testnet";
  const client = opts.client ?? publicClient(network);
  const exchange = NETWORKS[network].exchange;
  const block = opts.blockNumber ?? (await client.getBlockNumber());

  let accountId: bigint;
  try {
    const acc = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getAccountByAddr",
      args: [account],
      blockNumber: block,
    })) as { accountId: bigint };
    accountId = acc.accountId;
  } catch (e) {
    // getAccountByAddr reverts for an address that never created an account.
    if (String(e).includes("revert")) return null;
    throw e;
  }
  if (accountId === 0n) return null;

  const [[raw, markPricePNS, markValid], meta] = await Promise.all([
    client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPositionV2",
      args: [BigInt(market), accountId],
      blockNumber: block,
    }) as Promise<[RawPosition, bigint, boolean]>,
    readPerpMeta(client, exchange, market, block),
  ]);
  return decodePosition(raw, markPricePNS, markValid, meta, { account, market, block });
}
