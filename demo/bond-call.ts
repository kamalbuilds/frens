// The caller bonds their own staked call on CallStake v3 (testnet), as the room's bond button does: approve, then
// bond(id, amount), signed by the caller's key from the gitignored demo/.wallets.json (never printed).
//   bun run demo/bond-call.ts <stake id> [aUSD, default 2]
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bondCalls } from "../web/lib/callstake";
import { NETWORKS, publicClient } from "../web/lib/perpl";

const here = path.dirname(new URL(import.meta.url).pathname);
const [id, amountArg = "2"] = process.argv.slice(2) as [Hex, string];
if (!/^0x[0-9a-fA-F]{64}$/.test(id ?? "")) throw new Error("usage: bond-call.ts <stake id> [aUSD]");
const { CallStake } = JSON.parse(fs.readFileSync(path.join(here, "../contracts/deployments.json"), "utf8")).testnet;
const caller = ("0x" + id.slice(2, 42)).toLowerCase();
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(here, ".wallets.json"), "utf8"));
const account = Object.values(keys).map((k) => privateKeyToAccount(k)).find((a) => a.address.toLowerCase() === caller);
if (!account) throw new Error(`no demo wallet is the caller ${caller}`);
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account, chain, transport: http(net.rpc) });
for (const tx of bondCalls(CallStake, BigInt(id), Number(amountArg), "testnet")) {
  const hash = await w.sendTransaction({ to: tx.to, data: tx.data });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  console.log(hash);
}
const bond = (await client.readContract({ address: CallStake, abi: (await import("../web/lib/callstake.abi.json")).default, functionName: "bonds", args: [id] })) as bigint;
console.log(JSON.stringify({ id, caller: account.address, bond: bond.toString() }));
