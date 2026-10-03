// Reads frens' live positions on Perpl testnet BTC. Used by progress check.
//   bun run demo/read-position.ts <addr> [<addr> ...]         passes when ANY address holds a position (stops at the first)
//   bun run demo/read-position.ts --all <addr> [<addr> ...]   passes only when EVERY address holds one

import { readPosition } from "../web/lib/readPosition";
import { publicClient } from "../web/lib/perpl";
const all = process.argv[2] === "--all";
const client = publicClient("testnet");
let missing = 0;
for (const a of process.argv.slice(all ? 3 : 2) as `0x${string}`[]) {
  const p = await readPosition(a, 16, { network: "testnet", client });
  console.log(`${a} ${p ? `${p.side} ${p.size} @ ${p.entryPrice}` : "none"}`);
  if (p && p.size > 0) { if (!all) process.exit(0); } else missing++;
}
process.exit(all ? (missing ? 1 : 0) : 1);
