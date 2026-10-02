// Backs a taken call with a CallStake on Monad testnet. The call id (orderDescId), caller, market and resting order
// id come from the accept receipt; the owner's key from the gitignored demo/.wallets.json (never printed).
//   bun run demo/stake-call.ts <accept tx> [aUSD, default 2] [expiry hours, default 48]
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, decodeEventLog, encodeFunctionData, erc20Abi, http, pad, toHex, type Hex } from "viem";
import { padGas } from "../web/lib/wallet";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, publicClient } from "../web/lib/perpl";
import { verifyCallReceipts } from "../web/lib/receipts";
import officialAbi from "../web/lib/exchange-official.abi.json";

const here = path.dirname(new URL(import.meta.url).pathname);
const [acceptTx, amt = "2", hours = "48"] = process.argv.slice(2) as [Hex, string?, string?];
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const { CallStake } = JSON.parse(fs.readFileSync(path.join(here, "../contracts/deployments.json"), "utf8")).testnet;
const art = JSON.parse(fs.readFileSync(path.join(here, "../contracts/out/CallStake.sol/CallStake.json"), "utf8"));

const [call] = await verifyCallReceipts("testnet", [acceptTx], client);
if (!call || call.orderId === null) throw new Error("not a verified call with a resting order");
const r = await client.getTransactionReceipt({ hash: acceptTx });
const descId = r.logs
  .map((l) => { try { return decodeEventLog({ abi: officialAbi as never, data: l.data, topics: l.topics }); } catch { return null; } })
  .map((e) => e as { eventName?: string; args?: { orderDescId: bigint; orderType: number } } | null)
  .find((e) => e?.eventName === "OrderRequestV2" && (Number(e.args!.orderType) === 2 || Number(e.args!.orderType) === 3))!.args!.orderDescId;
const id = pad(toHex(descId), { size: 32 });

const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(here, ".wallets.json"), "utf8"));
const owner = Object.values(keys).map((k) => privateKeyToAccount(k)).find((a) => a.address.toLowerCase() === call.owner.toLowerCase());
if (!owner) throw new Error("no demo wallet owns this call");
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account: owner, chain, transport: http(net.rpc) });
const amount = BigInt(Math.round(Number(amt) * 1e6));
const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(hours) * 3600);
for (const req of [
  { address: net.collateral, abi: erc20Abi, functionName: "approve", args: [CallStake, amount] },
  { address: CallStake, abi: art.abi, functionName: "stake", args: [id, call.caller, amount, BigInt(call.market), BigInt(call.orderId), expiry] },
] as const) {
  // Estimate without fee fields (the Monad node checks the balance against its gas cap when fees are passed),
  // then send with 1.5x of it, as the app does (web/lib/wallet.ts padGas).
  const data = encodeFunctionData({ abi: req.abi as never, functionName: req.functionName as never, args: req.args as never });
  const gas = padGas(await client.estimateGas({ account: owner.address, to: req.address, data }));
  const hash = await w.sendTransaction({ to: req.address, data, gas });
  const rc = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (rc.status !== "success") throw new Error(`${req.functionName} reverted: ${hash}`);
  console.log(`${req.functionName}: ${hash}`);
}
const s = (await client.readContract({ address: CallStake, abi: art.abi, functionName: "stakes", args: [id] })) as unknown[];
console.log(JSON.stringify({ id, caller: s[1], amount: String(s[2]), state: Number(s[6]), tpPNS: String(s[7]) }));
