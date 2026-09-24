// Discovers accounts with open positions on Perpl mainnet (read-only) and decodes
// each one through readPosition(account, market). Writes evidence to positions.mainnet.json.
import type { Address } from "viem";
import { exchangeAbi, NETWORKS, publicClient } from "./perpl";
import { expectedDeltaPnl, readPerpMeta, readPosition, type Position } from "./readPosition";

const WANT = Number(process.argv[2] ?? 12);
const net = NETWORKS.mainnet;
const client = publicClient("mainnet");
const block = await client.getBlockNumber();

type ListEntry = { accountId: bigint; lotLNS: bigint; pricePNS: bigint; positionType: number };
const found: { market: number; entry: ListEntry }[] = [];
const perMarket = Math.ceil(WANT / net.markets.length) + 1;

for (const market of net.markets) {
  const [start] = (await client.readContract({
    address: net.exchange, abi: exchangeAbi, functionName: "getPositionIds", args: [BigInt(market)], blockNumber: block,
  })) as [bigint, bigint];
  if (start === 0n) continue;
  const [list, total] = (await client.readContract({
    address: net.exchange, abi: exchangeAbi, functionName: "getPositionsV2",
    args: [BigInt(market), start, BigInt(perMarket)], blockNumber: block,
  })) as [ListEntry[], bigint];
  console.error(`market ${market}: read ${list.length} positions from the head of the list`);
  for (const e of list) if (e.lotLNS > 0n) found.push({ market, entry: e });
}

const out: (Position & { listAgrees: boolean; deltaCheck: number })[] = [];
for (const { market, entry } of found) {
  if (out.length >= WANT) break;
  const acc = (await client.readContract({
    address: net.exchange, abi: exchangeAbi, functionName: "getAccountById", args: [entry.accountId], blockNumber: block,
  })) as { accountAddr: Address };
  const p = await readPosition(acc.accountAddr, market, { client, blockNumber: block });
  if (!p) throw new Error(`list says account ${entry.accountId} has a position in ${market}, readPosition found none`);
  // Two different view functions (the paginated list and the per-account read) must agree.
  const meta = await readPerpMeta(client, net.exchange, market, block);
  const listAgrees = p.accountId === entry.accountId
    && p.side === (entry.positionType === 0 ? "long" : "short")
    && p.size === Number(entry.lotLNS) / 10 ** Number(meta.lotDecimals);
  out.push({ ...p, listAgrees, deltaCheck: expectedDeltaPnl(p) });
}

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
console.log(`Perpl mainnet, Exchange ${net.exchange}, block ${block}`);
console.log("account                                     market side   size          entry          mark           uPnL($)   delta($)  recomputed($)");
for (const p of out) {
  console.log(
    `${p.account} ${p.symbol.padEnd(6)} ${p.side.padEnd(6)} ${String(p.size).padEnd(13)} ${fmt(p.entryPrice, 4).padEnd(14)} ${fmt(p.markPrice, 4).padEnd(14)} ${fmt(p.unrealizedPnl).padStart(9)} ${fmt(p.deltaPnl).padStart(9)} ${fmt(p.deltaCheck).padStart(9)}`,
  );
}
await Bun.write(
  new URL("../positions.mainnet.json", import.meta.url),
  JSON.stringify({ block: block.toString(), exchange: net.exchange, positions: out }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
);
