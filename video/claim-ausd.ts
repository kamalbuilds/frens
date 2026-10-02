// Claims testnet aUSD from the Agora faucet (selector 0x544c7cf9, claim(address)) for <to>, signed by a demo fren
// (keys in demo/.wallets.json, never printed). Prints the aUSD balance before and after.
//   bun run video/claim-ausd.ts <to> [from fren, default dee]
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, encodeAbiParameters, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, publicClient } from "../web/lib/perpl";

const FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
const [to, from = "dee"] = process.argv.slice(2) as [Address, string?];
if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? "")) throw new Error("usage: claim-ausd.ts <to> [from]");
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../demo/.wallets.json"), "utf8"));
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const bal = async () => (await client.readContract({ address: net.collateral, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [to] })) as bigint;
const before = await bal();
const w = createWalletClient({ account: privateKeyToAccount(keys[from]!), chain, transport: http(net.rpc) });
const hash = await w.sendTransaction({ to: FAUCET, data: ("0x544c7cf9" + encodeAbiParameters([{ type: "address" }], [to]).slice(2)) as Hex, gas: 300000n });
const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log(JSON.stringify({ to, tx: hash, status: r.status, before: Number(before) / 1e6, after: Number(await bal()) / 1e6 }));
