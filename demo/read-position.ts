// Reads a fren's live position on Perpl testnet BTC; exits 1 when there is none. Used by progress check.

import { readPosition } from "../web/lib/readPosition";
import { publicClient } from "../web/lib/perpl";
const a = process.argv[2] as `0x${string}`;
const p = await readPosition(a, 16, { network: "testnet", client: publicClient("testnet") });
console.log(p ? `${p.side} ${p.size} @ ${p.entryPrice}` : "none");
process.exit(p && p.size > 0 ? 0 : 1);
