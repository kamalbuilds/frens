// Funds an address on Perpl testnet from a demo fren's wallet (keys in demo/.wallets.json, never printed).
//   bun run demo/fund.ts <to> [mon, default 0.3] [aUSD, default 60] [from fren, default cy]
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, encodeFunctionData, erc20Abi, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, publicClient } from "../web/lib/perpl";

const [to, mon = "0.3", ausd = "60", from = "cy"] = process.argv.slice(2) as [Address, string?, string?, string?];
if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? "")) throw new Error("usage: fund.ts <to> [mon] [aUSD] [from]");
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), ".wallets.json"), "utf8"));
const account = privateKeyToAccount(keys[from]!);
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account, chain, transport: http(net.rpc) });
for (const tx of [
  { to, value: parseEther(mon), data: "0x" as Hex },
  { to: net.collateral, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, BigInt(Math.round(Number(ausd) * 1e6))] }) },
]) {
  const hash = await w.sendTransaction(tx);
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`funding tx reverted: ${hash}`);
  console.log(`funded ${to}: ${hash}`);
}
