// Perpl mainnet, read only. Over a block range it rebuilds, from Exchange logs alone, the
// trading cost a farmer works out by hand after a session:
//   feesUsd        = sum feeCNS on MakerOrderFilled/V2 (which carry accountId) + TakerOrderFilled/V2
//   realizedUsd    = sum deltaPnlCNS on PositionClosed + PositionDecreased
//   fundingUsd     = sum fundingCNS on PositionClosed + PositionDecreased
//   netUsd         = realizedUsd + fundingUsd - feesUsd
//   volumeUsd      = sum over fills of price * size
//   costPerMillion = (feesUsd - realizedUsd - fundingUsd) / volumeUsd * 1e6
// Every CNS amount is collateral (aUSD) base units, and the token's own decimals() is read once
// rather than trusted from src/perpl.ts. deltaPnlCNS and fundingCNS are int256 on chain, so a
// losing account carries its sign into the sums and out the other side.
//
// The boundary of the definition above, stated because the numbers are read as a whole: the
// contract also realizes PnL through PositionInverted, PositionDeleveraged(V2) and
// PositionLiquidated, and charges insFeeCNS/protFeeCNS on PositionOpenedV2/PositionIncreasedV2.
// None of those are in the definition, so a range containing them reads low. Over 4000 mainnet
// blocks the out-of-scope realized events were 16 against 589 in scope, so it is a footnote
// rather than the whole story, and it is a footnote on purpose: the definition is the one asked
// for, not the one the contract would produce.
//
// CLI: bun spike/ledger.ts --blocks N [--account ID|0xADDRESS] [--top K]
// stdout is a JSON array sorted by volumeUsd desc, progress goes to stderr.

import {
  erc20Abi,
  decodeEventLog,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { NETWORKS, exchangeAbi, publicClient } from "../src/perpl";
import officialAbi from "./exchange-official.abi.json";
import { readPerpMeta } from "../src/readPosition";

// Monad's node rejects eth_getLogs over 100 blocks, so the range is walked in pages of that size.
const PAGE_BLOCKS = 100n;
const CONCURRENCY = 4;
const RETRIES = 5;

// The deployed Exchange emits the V2 forms only: over 800 mainnet blocks MakerOrderFilledV2 and
// TakerOrderFilledV2 fired 144 and 87 times and their V1 topics never fired once, while scanning
// the V1 topics alone finds no trades at all. Both are requested because a fill is emitted under
// exactly one of the two names, so a range that predates the V2 upgrade is still read whole.
const MAKER_FILL_EVENTS = ["MakerOrderFilled", "MakerOrderFilledV2"] as const;
const TAKER_FILL_EVENTS = ["TakerOrderFilled", "TakerOrderFilledV2"] as const;
const PNL_EVENTS = ["PositionClosed", "PositionDecreased"] as const;
// OrderRequest names the account behind a fill. It is fetched per transaction, never scanned.
const ORDER_REQUEST_EVENTS = ["OrderRequest", "OrderRequestV2"] as const;
const SCAN_EVENTS = [...MAKER_FILL_EVENTS, ...TAKER_FILL_EVENTS, ...PNL_EVENTS] as const;
const RECEIPT_EVENTS = [...SCAN_EVENTS, ...ORDER_REQUEST_EVENTS] as const;

// OrderDescEnum: 0 and 1 open long and short, 2 and 3 close them, and those four can trade. 4
// cancels an order and 6 rests a limit order, and the contract emits both, so a request is only a
// candidate for naming a taker when its type can fill at all. postOnly is checked as well: a
// post-only order that crossed would have reverted, so it never appears here.
const LAST_TRADING_ORDER_TYPE = 3n;

export type MarketScale = { priceDecimals: number; lotDecimals: number };

export type DecodedFill = {
  kind: "fill";
  accountId: bigint;
  perpId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  feeCNS: bigint; // uint256, the fee is always charged as a positive amount
  source: (typeof MAKER_FILL_EVENTS)[number] | (typeof TAKER_FILL_EVENTS)[number];
  // price * lot, exactly as the two sides of the trade saw it. It is filled in for a taker order
  // that consumed several maker lots, because its price is a lot-weighted average and averaging
  // rounds: pricing the whole fill off the rounded average would move the volume by up to one lot,
  // which on a market quoted in thousandths is money. Left out, pricePNS * lotLNS is the product.
  notionalPNS?: bigint;
};

export type DecodedPnl = {
  kind: "pnl";
  accountId: bigint;
  perpId: bigint;
  deltaPnlCNS: bigint;
  fundingCNS: bigint;
  source: (typeof PNL_EVENTS)[number];
};

export type DecodedEvent = DecodedFill | DecodedPnl;

export type LedgerRow = {
  accountId: number;
  events: number;
  volumeUsd: number;
  feesUsd: number;
  realizedUsd: number;
  fundingUsd: number;
  netUsd: number;
  costPerMillion: number | null; // null rather than 0 when the account traded no volume to divide by
  fromBlock: number;
  toBlock: number;
};

export type SummarizeOptions = {
  collateralDecimals: number;
  range: { fromBlock: bigint; toBlock: bigint };
  scaleOf: (perpId: bigint) => MarketScale;
};

function num(v: bigint, what: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${what} ${v} is past the JS safe integer range`);
  return n;
}

// The one place numbers become floats: the CNS sums stay bigint until a single division by
// 10 ** decimals, so a long range of fills cannot lose a cent to accumulation error. Prices and
// sizes are scaled by their own market, since PNS and LNS decimals are per market.
export function summarize(events: readonly DecodedEvent[], opts: SummarizeOptions): LedgerRow[] {
  type Acc = { events: number; feeCNS: bigint; realizedCNS: bigint; fundingCNS: bigint; volumeUsd: number };
  const byAccount = new Map<bigint, Acc>();

  for (const e of events) {
    let acc = byAccount.get(e.accountId);
    if (!acc) byAccount.set(e.accountId, (acc = { events: 0, feeCNS: 0n, realizedCNS: 0n, fundingCNS: 0n, volumeUsd: 0 }));
    acc.events += 1;
    if (e.kind === "fill") {
      acc.feeCNS += e.feeCNS;
      const s = opts.scaleOf(e.perpId);
      const notional = e.notionalPNS ?? e.pricePNS * e.lotLNS;
      acc.volumeUsd += Number(notional) / 10 ** s.priceDecimals / 10 ** s.lotDecimals;
    } else {
      acc.realizedCNS += e.deltaPnlCNS;
      acc.fundingCNS += e.fundingCNS;
    }
  }

  const c = 10 ** opts.collateralDecimals;
  const fromBlock = num(opts.range.fromBlock, "fromBlock");
  const toBlock = num(opts.range.toBlock, "toBlock");
  const rows: LedgerRow[] = [...byAccount].map(([accountId, acc]) => {
    const feesUsd = Number(acc.feeCNS) / c;
    const realizedUsd = Number(acc.realizedCNS) / c;
    const fundingUsd = Number(acc.fundingCNS) / c;
    return {
      accountId: num(accountId, "accountId"),
      events: acc.events,
      volumeUsd: acc.volumeUsd,
      feesUsd,
      realizedUsd,
      fundingUsd,
      netUsd: realizedUsd + fundingUsd - feesUsd,
      costPerMillion: acc.volumeUsd === 0 ? null : ((feesUsd - realizedUsd - fundingUsd) / acc.volumeUsd) * 1e6,
      fromBlock,
      toBlock,
    };
  });
  return rows.sort((a, b) => b.volumeUsd - a.volumeUsd || a.accountId - b.accountId);
}

// A decoded Exchange log from one transaction, in the order the contract emitted it.
export type TxLog = { name: string; args: Record<string, unknown>; logIndex: number };

export type TakerAttribution = { accountId: bigint; perpId: bigint; pricePNS: bigint; notionalPNS: bigint };

// TakerOrderFilled names no account, no market and no execution price. It carries entryPricePNS,
// which is the position's average entry after the fill, not the price that traded: across 800
// mainnet blocks it matched the price of the taker's last consumed maker lot only 74 times in 85
// fills, and the other 11 were multi-maker fills sitting at a different average. So the fill is
// named from its own transaction, and every step is checked rather than assumed:
//
//   1. A taker fill consumes the maker fills logged before it, and their lotLNS sums to exactly
//      the taker's lotLNS. That held for 85 of 85 taker fills in 800 mainnet blocks, and the
//      maker fills of one transaction always shared a single perpId (79 of 79 transactions). The
//      run therefore supplies the market and the exact price * lot the taker traded, kept as a
//      product so that averaging across several maker lots cannot round the volume away. A run
//      that does not sum exactly means the matching pass is not the one this assumes, so the fill
//      is reported unattributed rather than costed.
//   2. The account is the crossing OrderRequest nearest above the fill in the log that has not
//      already been spent on an earlier fill. The contract logs a request, then the fills that
//      request produced, then the next request, so the nearest request above a fill is the one
//      that made it. Over 1500 mainnet blocks that named 139 of 139 taker fills, in 129
//      transactions of which 25 batched several takers, and it agreed with a check that reads
//      nothing it uses: the position events in the same transaction name both sides of the trade,
//      and the account it named was the taker in 139 of 139 cases. A request whose lotLNS is
//      smaller than the fill is refused, since no order can fill more than it asked for.
//   3. Makers are excluded from the candidates, because every maker that traded in the
//      transaction is already named, by that same transaction, in its own
//      MakerOrderFilled.accountId. The transaction sender is never used: it is the taker in only
//      37 of 83 taker transactions and owns no Perpl account at all in the other 46, because most
//      of the flow is relayed. Fills that stay unnamed are counted and reported, never guessed at.
export function attributeTakerFills(logs: readonly TxLog[]): (TakerAttribution | null)[] {
  const ordered = logs.slice().sort((a, b) => a.logIndex - b.logIndex);

  const candidates = ordered
    .filter((l) => isOneOf(l.name, ORDER_REQUEST_EVENTS))
    .map((l) => ({
      accountId: l.args.accountId as bigint,
      perpId: l.args.perpId as bigint,
      lotLNS: l.args.lotLNS as bigint,
      logIndex: l.logIndex,
      spent: false,
      orderType: l.args.orderType as bigint,
      postOnly: l.args.postOnly as boolean,
    }))
    .filter((r) => r.orderType <= LAST_TRADING_ORDER_TYPE && !r.postOnly);

  const out: (TakerAttribution | null)[] = [];
  // Makers are collected as the walk passes them, not up front. One account can be the taker of one
  // fill and the maker of another in the same transaction, and whether it has already been a maker
  // depends on where the fill sits: mainnet block 108163281 has 5302 closing against 812's short at
  // log 63 and then filling 1974's close as maker at log 74, so a set built from the whole
  // transaction drops the only request that made log 63 and hands the fill to 3040, whose request
  // two logs earlier the contract had already refused with CloseOrderExceedsPosition.
  const makersSoFar = new Set<bigint>();
  let run: { perpId: bigint; pricePNS: bigint; lotLNS: bigint }[] = [];

  for (const l of ordered) {
    if (isOneOf(l.name, MAKER_FILL_EVENTS)) {
      makersSoFar.add(l.args.accountId as bigint);
      run.push({ perpId: l.args.perpId as bigint, pricePNS: l.args.pricePNS as bigint, lotLNS: l.args.lotLNS as bigint });
      continue;
    }
    if (!isOneOf(l.name, TAKER_FILL_EVENTS)) continue;

    const lotLNS = l.args.lotLNS as bigint;
    const notionalPNS = run.reduce((a, r) => a + r.pricePNS * r.lotLNS, 0n);
    const runLot = run.reduce((a, r) => a + r.lotLNS, 0n);
    const perpIds = new Set(run.map((r) => r.perpId));
    const perpId = perpIds.size === 1 ? run[0]!.perpId : null;
    run = [];
    // A fill that consumed exactly the lots above it, in one market, is the only kind that can be
    // priced; anything else is left out of the report instead of being costed on a guess. A request
    // asking for fewer lots than the fill cannot be the one that made it, so it does not count.
    const here = perpId === null ? [] : candidates.filter((c) => !c.spent && !makersSoFar.has(c.accountId) && c.logIndex < l.logIndex && c.perpId === perpId && c.lotLNS >= lotLNS);
    const pick = here.length === 0 ? null : here[here.length - 1]!;
    if (runLot !== lotLNS || perpId === null || pick === null) {
      out.push(null);
      continue;
    }
    pick.spent = true;
    out.push({
      accountId: pick.accountId,
      perpId,
      // Reported as the lot-weighted average, which is what a human would call the price paid, and
      // the exact product travels beside it so that no rounding creeps into the volume.
      pricePNS: notionalPNS / lotLNS,
      notionalPNS,
    });
  }
  return out;
}

const isOneOf = <T extends readonly string[]>(name: string, group: T): name is T[number] => (group as readonly string[]).includes(name);

function eventAbi(name: string): AbiEvent {
  // The trimmed src/exchange.abi.json carries only the V1 fills, while the deployed Exchange
  // emits the V2 forms. The official ABI checked in beside this spike has both, so look up
  // event signatures there; on-chain reads below keep using exchangeAbi.
  const found = (officialAbi as unknown as readonly AbiEvent[]).find((e) => e.type === "event" && e.name === name);
  if (!found) throw new Error(`Exchange ABI has no event ${name}`);
  return found;
}

const topicToEvent = new Map<string, AbiEvent>();
for (const name of RECEIPT_EVENTS) {
  const ev = eventAbi(name);
  topicToEvent.set(toEventSelector(ev), ev);
}
const scanEvents = SCAN_EVENTS.map(eventAbi);

// One decode path for scanned logs and for receipts. A log from another contract (the collateral
// transfer the Exchange makes on every fill) has a topic nobody here knows, and is skipped
// rather than thrown on.
function decodeExchangeLog(log: Log): TxLog | null {
  const ev = topicToEvent.get(log.topics[0] ?? "");
  if (!ev) return null;
  const decoded = decodeEventLog({ abi: [ev], topics: log.topics as [Hex, ...Hex[]], data: log.data });
  return { name: decoded.eventName, args: decoded.args as Record<string, unknown>, logIndex: log.logIndex ?? 0 };
}

function isRateLimited(e: unknown): boolean {
  const s = String(e).toLowerCase();
  return s.includes("429") || s.includes("rate limit") || s.includes("too many requests") || s.includes("limit exceeded");
}

async function withRetry<T>(what: string, run: () => Promise<T>, tries = RETRIES): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= tries - 1 || !isRateLimited(e)) throw e;
      const wait = 400 * 2 ** attempt + Math.floor(Math.random() * 200);
      console.error(`  429 on ${what}, retry ${attempt + 1}/${tries - 1} in ${wait}ms`);
      await Bun.sleep(wait);
    }
  }
}

// Bounded concurrency: the public Monad node is shared, so pages and receipts go out a few at a
// time rather than all at once.
async function pMap<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) out[next] = await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

type MakerFill = { name: string; txHash: Hex; args: { accountId: bigint; perpId: bigint; pricePNS: bigint; lotLNS: bigint; feeCNS: bigint } };
type TakerFill = { name: string; txHash: Hex; args: { lotLNS: bigint; feeCNS: bigint } };

async function scanRange(
  client: PublicClient,
  exchange: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ maker: MakerFill[]; taker: TakerFill[]; pnl: DecodedPnl[]; pages: number }> {
  const starts: bigint[] = [];
  for (let s = fromBlock; s <= toBlock; s += PAGE_BLOCKS) starts.push(s);

  const pages = await pMap(starts, CONCURRENCY, async (from) => {
    const to = from + PAGE_BLOCKS - 1n < toBlock ? from + PAGE_BLOCKS - 1n : toBlock;
    return withRetry(`eth_getLogs ${from}-${to}`, () =>
      client.getLogs({ address: exchange, events: scanEvents, fromBlock: from, toBlock: to }),
    );
  });

  const maker: MakerFill[] = [];
  const taker: TakerFill[] = [];
  const pnl: DecodedPnl[] = [];
  for (const log of pages.flat()) {
    const d = decodeExchangeLog(log);
    if (!d) continue;
    if (isOneOf(d.name, MAKER_FILL_EVENTS)) {
      maker.push({ name: d.name, txHash: log.transactionHash!, args: d.args as MakerFill["args"] });
    } else if (isOneOf(d.name, TAKER_FILL_EVENTS)) {
      taker.push({ name: d.name, txHash: log.transactionHash!, args: d.args as TakerFill["args"] });
    } else if (isOneOf(d.name, PNL_EVENTS)) {
      pnl.push({ kind: "pnl", accountId: d.args.accountId as bigint, perpId: d.args.perpId as bigint, deltaPnlCNS: d.args.deltaPnlCNS as bigint, fundingCNS: d.args.fundingCNS as bigint, source: d.name });
    }
  }

  // A position cannot close or shrink without a fill behind it, so PnL events with no fills at
  // all mean the fill events in the ABI are not the ones the chain emits. Say so rather than
  // printing a table of zero fees, which would read as "these traders are free".
  if (maker.length === 0 && taker.length === 0 && pnl.length > 0) {
    throw new Error(
      `found ${pnl.length} PositionClosed/PositionDecreased events in ${fromBlock}-${toBlock} but zero fills. ` +
        `The Exchange emits fills under other signatures, so the checked-in ABI is out of date.`,
    );
  }
  return { maker, taker, pnl, pages: starts.length };
}

// Names the taker for every TakerOrderFilled. One receipt per transaction, shared by the fills in
// it, since one taker order can settle against several makers in a single fill.
async function attributeTakers(
  client: PublicClient,
  taker: readonly TakerFill[],
): Promise<{ fills: DecodedFill[]; unattributed: number }> {
  const byTx = new Map<Hex, TakerFill[]>();
  for (const f of taker) byTx.set(f.txHash, [...(byTx.get(f.txHash) ?? []), f]);

  const fills: DecodedFill[] = [];
  let unattributed = 0;
  await pMap([...byTx.values()], CONCURRENCY, async (group) => {
    const receipt = await withRetry(`receipt ${group[0]!.txHash}`, () => client.getTransactionReceipt({ hash: group[0]!.txHash }));
    const logs = receipt.logs.map(decodeExchangeLog).filter((l): l is TxLog => l !== null);
    const named = attributeTakerFills(logs);
    const fillsInTx = logs.filter((l) => isOneOf(l.name, TAKER_FILL_EVENTS));

    fillsInTx.forEach((l, i) => {
      const a = named[i];
      if (!a) {
        unattributed++;
        return;
      }
      fills.push({
        kind: "fill",
        accountId: a.accountId,
        perpId: a.perpId,
        pricePNS: a.pricePNS,
        notionalPNS: a.notionalPNS,
        lotLNS: l.args.lotLNS as bigint,
        feeCNS: l.args.feeCNS as bigint,
        source: l.name,
      });
    });
  });
  return { fills, unattributed };
}

async function readCollateralDecimals(client: PublicClient, token: Address): Promise<number> {
  const decimals = await withRetry("collateral decimals", () =>
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  );
  return Number(decimals);
}

async function accountIdOfAddr(client: PublicClient, exchange: Address, addr: Address, blockNumber: bigint): Promise<bigint | null> {
  try {
    const acc = (await withRetry(`getAccountByAddr ${addr}`, () =>
      client.readContract({ address: exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [addr], blockNumber }),
    )) as { accountId: bigint };
    return acc.accountId === 0n ? null : acc.accountId;
  } catch (e) {
    // getAccountByAddr reverts for an address that never created an account.
    if (String(e).includes("revert")) return null;
    throw e;
  }
}

function parseArgs(argv: readonly string[]): { blocks: number; account?: string; top?: number } {
  const out: { blocks?: number; account?: string; top?: number } = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--blocks") out.blocks = Number(value);
    else if (flag === "--account") out.account = value;
    else if (flag === "--top") out.top = Number(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (out.blocks === undefined || !Number.isInteger(out.blocks) || out.blocks < 1) {
    throw new Error("usage: bun spike/ledger.ts --blocks N [--account ID|0xADDRESS] [--top K]");
  }
  if (out.top !== undefined && (!Number.isInteger(out.top) || out.top < 1)) throw new Error("--top needs a positive integer");
  return { blocks: out.blocks, account: out.account, top: out.top };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const net = NETWORKS.mainnet;
  const client = publicClient("mainnet");
  const toBlock = await client.getBlockNumber();
  const fromBlock = toBlock - BigInt(args.blocks - 1);

  const collateralDecimals = await readCollateralDecimals(client, net.collateral);
  console.error(`Perpl mainnet ${net.exchange}, blocks ${fromBlock}-${toBlock} (${args.blocks}), aUSD ${net.collateral} has ${collateralDecimals} decimals`);

  const { maker, taker, pnl, pages } = await scanRange(client, net.exchange, fromBlock, toBlock);
  console.error(`scanned ${pages} pages of at most ${PAGE_BLOCKS} blocks: ${maker.length} maker fills, ${taker.length} taker fills, ${pnl.length} pnl events`);

  const attributed = await attributeTakers(client, taker);
  if (attributed.unattributed > 0) {
    // Never drop money quietly: name how many taker fills no account could be tied to.
    console.error(`BLIND SPOT: ${attributed.unattributed} of ${taker.length} taker fills could not be tied to an account and are in no row`);
  }

  const decoded: DecodedEvent[] = [...pnl, ...attributed.fills];
  for (const m of maker) {
    decoded.push({ kind: "fill", accountId: m.args.accountId, perpId: m.args.perpId, pricePNS: m.args.pricePNS, lotLNS: m.args.lotLNS, feeCNS: m.args.feeCNS, source: m.name });
  }

  const perpIds = [...new Set(decoded.map((e) => e.perpId))];
  const scales = new Map<bigint, MarketScale>();
  await pMap(perpIds, CONCURRENCY, async (perpId) => {
    const meta = await readPerpMeta(client, net.exchange, num(perpId, "perpId"));
    scales.set(perpId, { priceDecimals: Number(meta.priceDecimals), lotDecimals: Number(meta.lotDecimals) });
  });
  const scaleOf = (perpId: bigint): MarketScale => {
    const s = scales.get(perpId);
    if (!s) throw new Error(`no price or lot decimals for market ${perpId}`);
    return s;
  };

  let rows = summarize(decoded, { collateralDecimals, range: { fromBlock, toBlock }, scaleOf });

  if (args.account !== undefined) {
    // Nothing on this Exchange is indexed by account, so the filter runs after decoding.
    const wanted = args.account.startsWith("0x")
      ? await accountIdOfAddr(client, net.exchange, args.account as Address, toBlock)
      : BigInt(args.account);
    if (wanted === null) throw new Error(`${args.account} owns no Perpl account`);
    rows = rows.filter((r) => r.accountId === num(wanted, "accountId"));
    if (rows.length === 0) console.error(`no ledger events for account ${wanted} in this range`);
  }

  if (args.top !== undefined) rows = rows.slice(0, args.top);
  console.error(`${rows.length} accounts`);
  console.log(JSON.stringify(rows, null, 2));
}

if (import.meta.main) await main();
