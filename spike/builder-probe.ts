// Does a wallet-signed execOrderV2 carry Perpl builder attribution on chain? Places a post-only limit buy 10% under
// the mark on testnet (cannot fill), reads getOrderV2 back for builderId and builderFeePer100K, then cancels it.
//   bun --env-file=.env run spike/builder-probe.ts        (signs with PRIVATE_KEY, Kamal's testnet deployer)
import { createWalletClient, decodeEventLog, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { readPerpMeta } from "../web/lib/readPosition";
import { builderExtension, encodeOrderV2, FRENS_BUILDER_ID } from "../web/lib/builder";
import { padGas } from "../web/lib/wallet";
import officialAbi from "../web/lib/exchange-official.abi.json";

const net = NETWORKS.testnet;
const client = publicClient("testnet", process.env.MONAD_TESTNET_RPC_URL || undefined);
const account = privateKeyToAccount((process.env.DEPLOYER_KEY ?? process.env.PRIVATE_KEY) as Hex);
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account, chain, transport: http(net.rpc) });
const PERP = 16n;
const meta = await readPerpMeta(client, net.exchange, 16);
const info = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [PERP] })) as { markPNS: bigint };
const price = (info.markPNS * 90n) / 100n;
const order = {
  orderDescId: 0n, perpId: PERP, orderType: 0, orderId: 0n, pricePNS: price, lotLNS: 10n ** (BigInt(meta.lotDecimals) - 3n),
  expiryBlock: 0n, postOnly: true, fillOrKill: false, immediateOrCancel: false, maxMatches: 0n, leverageHdths: 500n,
  lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 0n,
};
async function send(data: Hex, label: string) {
  const gas = padGas(await client.estimateGas({ account: account.address, to: net.exchange, data }));
  const hash = await w.sendTransaction({ to: net.exchange, data, gas });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return r;
}
const r = await send(encodeOrderV2(order, builderExtension(FRENS_BUILDER_ID, 50)), "place (builder 23, fee 50/100k)");
const placed = r.logs.map((l) => { try { return decodeEventLog({ abi: officialAbi as never, data: l.data, topics: l.topics }) as { eventName: string; args: { orderId?: bigint } }; } catch { return null; } }).find((e) => e?.eventName === "OrderPlaced");
const orderId = placed!.args.orderId!;
const o = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getOrderV2", args: [PERP, orderId] })) as { builderId: number; builderFeePer100K: number; lotLNS: bigint };
console.log(JSON.stringify({ orderId: String(orderId), builderId: Number(o.builderId), builderFeePer100K: Number(o.builderFeePer100K), lots: String(o.lotLNS) }));
await send(encodeFunctionData({ abi: exchangeAbi, functionName: "execOrder", args: [{ ...order, orderType: 4, orderId, postOnly: false }] }), "cancel");
const after = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getOrderV2", args: [PERP, orderId] })) as { lotLNS: bigint };
console.log(`after cancel lots ${after.lotLNS}`);
if (Number(o.builderId) !== FRENS_BUILDER_ID) process.exit(1);
