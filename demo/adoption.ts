// The "it works" bar read from chain: Perpl orders carrying a frens orderDescId (caller or copied fren in
// the top 160 bits, a ms timestamp below). Close orders are accepted calls, opens are copies.
//   bun --env-file=web/.env.local run demo/adoption.ts [mainnet|testnet] [hours, default 24] [end block, default latest]
import { decodeEventLog, type AbiEvent, type Hex } from "viem";
import { decodeDescId, ORDER_REQUEST_V2_TOPIC0 } from "../web/lib/callbook";
import { NETWORKS, type Network } from "../web/lib/perpl";
import { clientFor } from "../web/lib/server";
import officialAbi from "../web/lib/exchange-official.abi.json";

const net = (process.argv[2] ?? "mainnet") as Network;
const hours = Number(process.argv[3] ?? 24);
const client = clientFor(net);
const exchange = NETWORKS[net].exchange;
const CHUNK = 1000n; // QuickNode's eth_getLogs range cap
const latest = process.argv[4] ? BigInt(process.argv[4]) : await client.getBlockNumber();
const from = latest - BigInt(Math.round(hours * 12_000));

const ranges: [bigint, bigint][] = [];
for (let b = from; b <= latest; b += CHUNK) ranges.push([b, b + CHUNK - 1n > latest ? latest : b + CHUNK - 1n]);

type RawLog = { data: Hex; topics: [Hex]; transactionHash: Hex; blockNumber: Hex };

// A busy 1,000-block range can exceed viem's 10 MB response cap: halve it until it fits.
async function getLogs(a: bigint, z: bigint): Promise<RawLog[]> {
  for (let i = 0; ; i++) {
    try {
      return (await client.request({ method: "eth_getLogs", params: [{ address: exchange, topics: [ORDER_REQUEST_V2_TOPIC0], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${z.toString(16)}` }] })) as RawLog[];
    } catch (e) {
      if (String(e).includes("ResponseBodyTooLarge") && z > a) {
        const mid = (a + z) / 2n;
        return [...(await getLogs(a, mid)), ...(await getLogs(mid + 1n, z))];
      }
      if (i === 4) { failed++; console.error(`range ${a}-${z} failed: ${String(e).slice(0, 120)}`); return []; }
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

type Row = { kind: "call" | "copy"; tag: string; account: bigint; tx: Hex; block: bigint };
const rows: Row[] = [];
let largeIds = 0;
let next = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < ranges.length) {
      const [a, z] = ranges[next++]!;
      const logs = await getLogs(a, z);
      for (const l of logs) {
        const ev = decodeEventLog({ abi: officialAbi as AbiEvent[], data: l.data, topics: l.topics });
        const { orderDescId, orderType, accountId } = ev.args as unknown as { orderDescId: bigint; orderType: number; accountId: bigint };
        if (orderDescId >> 96n !== 0n) largeIds++;
        const d = decodeDescId(orderDescId);
        if (!d) continue;
        const t = Number(orderType);
        if (t > 3) continue; // cancels and changes reuse the id; only opens and closes count
        rows.push({ kind: t >= 2 ? "call" : "copy", tag: d.suggester, account: accountId, tx: l.transactionHash, block: BigInt(l.blockNumber) });
      }
    }
  }),
);

const calls = rows.filter((r) => r.kind === "call");
const copies = rows.filter((r) => r.kind === "copy");
console.log(JSON.stringify({
  net, hours, fromBlock: from.toString(), toBlock: latest.toString(), rangesFailed: failed,
  largeDescIdsSeen: largeIds,
  callsAccepted: calls.length, callers: new Set(calls.map((r) => r.tag)).size,
  copies: copies.length, copiedFrens: new Set(copies.map((r) => r.tag)).size,
  accounts: new Set(rows.map((r) => r.account.toString())).size,
  txs: rows.map((r) => `${r.kind} ${r.tx}`),
}, null, 1));
if (failed) process.exit(2);
