// Reads frens' live positions on Perpl testnet BTC; exits 1 when none of the given addresses holds one. Used by progress check.
//   bun run demo/read-position.ts <addr> [<addr> ...]   stops at the first address that holds a position

import { readPosition } from "../web/lib/readPosition";
import { publicClient } from "../web/lib/perpl";
const client = publicClient("testnet");
for (const a of process.argv.slice(2) as `0x${string}`[]) {
  const p = await readPosition(a, 16, { network: "testnet", client });
  console.log(`${a} ${p ? `${p.side} ${p.size} @ ${p.entryPrice}` : "none"}`);
  if (p && p.size > 0) process.exit(0);
}
process.exit(1);
