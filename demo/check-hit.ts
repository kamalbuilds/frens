// Exit 0 when a testnet accept tx is a verified call whose TP Perpl's candles reached after the accept block.
//   bun run demo/check-hit.ts <accept tx hash>
import type { Hex } from "viem";
import { callHit } from "../web/lib/callhit";
import { scaleCandle, type RawCandle } from "../web/lib/chart";
import { API_BASES } from "../web/lib/network";
import { NETWORKS, publicClient } from "../web/lib/perpl";
import { priceCalls, verifyCallReceipts } from "../web/lib/receipts";
import { readPerpMeta } from "../web/lib/readPosition";

const client = publicClient("testnet");
const [call] = await priceCalls(await verifyCallReceipts("testnet", [process.argv[2] as Hex], client), client, NETWORKS.testnet.exchange);
if (!call || call.price === null) { console.log("not a verified call"); process.exit(1); }
const blockSec = Number((await client.getBlock({ blockNumber: BigInt(call.block) })).timestamp);
const { priceDecimals } = await readPerpMeta(client, NETWORKS.testnet.exchange, call.market);
const r = await fetch(`${API_BASES.testnet}/market-data/${call.market}/candles/900/${blockSec * 1000}-${Date.now()}`);
const candles = ((await r.json()) as { d: RawCandle[] }).d.map((c) => scaleCandle(c, Number(priceDecimals)));
const hit = callHit(call.orderType, call.price, candles, blockSec, 900);
console.log(`${call.caller} TP ${call.price} type ${call.orderType}: ${hit ? "hit" : "not hit"} over ${candles.length} bars`);
process.exit(hit ? 0 : 1);
