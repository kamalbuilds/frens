// Deploys CallStake to Monad testnet from a demo fren's wallet (key from the gitignored demo/.wallets.json, never
// printed), then reads the constructor args back from chain. Writes the address to contracts/deployments.json.
//   cd contracts && forge build && cd .. && bun run demo/deploy-callstake.ts [fren, default cy]
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, publicClient } from "../web/lib/perpl";

const here = path.dirname(new URL(import.meta.url).pathname);
const from = process.argv[2] ?? "cy";
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(here, ".wallets.json"), "utf8"));
const account = privateKeyToAccount(keys[from]!);
const art = JSON.parse(fs.readFileSync(path.join(here, "../contracts/out/CallStake.sol/CallStake.json"), "utf8"));
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account, chain, transport: http(net.rpc) });
const hash = await w.deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args: [net.exchange, net.collateral] });
const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed: ${hash}`);
const [ex, tok] = await Promise.all(
  ["exchange", "token"].map((fn) => client.readContract({ address: r.contractAddress!, abi: art.abi, functionName: fn })),
);
if (String(ex).toLowerCase() !== net.exchange.toLowerCase() || String(tok).toLowerCase() !== net.collateral.toLowerCase()) throw new Error("constructor args do not read back");
const out = path.join(here, "../contracts/deployments.json");
const d = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
d.testnet = { CallStake: r.contractAddress, tx: hash, block: r.blockNumber.toString(), exchange: ex, token: tok };
fs.writeFileSync(out, JSON.stringify(d, null, 1));
console.log(JSON.stringify(d.testnet));
