// Prints a call payload (the ?s= value) for a demo fren's open position, priced off the live mark.
//   bun run demo/make-call.ts <from address> <owner address> [pct, default 4] [tp|sl, default tp]
// sl prices the stop on the losing side of the mark and marks the link as a stop-loss call.
import type { Address } from "viem";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { readPerpMeta, readPosition } from "../web/lib/readPosition";
import { encodeSuggestion } from "../web/lib/suggest";

const [from, owner, pctArg, kind = "tp"] = process.argv.slice(2) as [Address, Address, string?, ("tp" | "sl")?];
if (!from || !owner) throw new Error("usage: make-call.ts <from> <owner> [pct]");
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const market = 16;
const pos = await readPosition(owner, market, { network: "testnet", client });
if (!pos) throw new Error(`${owner} has no open position on market ${market}`);
const meta = await readPerpMeta(client, net.exchange, market);
const p = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(market)] })) as { markPNS: bigint };
const mark = Number(p.markPNS) / 10 ** Number(meta.priceDecimals);
const pct = Number(pctArg ?? 4) / 100;
const up = (pos.side === "long") === (kind === "tp");
const price = Math.round(up ? mark * (1 + pct) : mark * (1 - pct));
console.log(encodeSuggestion({ owner, market, side: pos.side, price, from, createdAt: Date.now(), ...(kind === "sl" ? { kind: "sl" as const } : {}) }));
