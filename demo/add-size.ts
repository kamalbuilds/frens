// Adds size to a demo fren's position on testnet through the app's copy-order builder (one tap, own key).
//   bun run demo/add-size.ts <name: ana|bo|cy|dee> <size> <long|short>
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { readPerpMeta } from "../web/lib/readPosition";
import { encodeCopyOrder, toCopyOrder } from "../web/lib/copy";
import { suggestionDescId } from "../web/lib/callbook";

const [name, sizeArg, side] = process.argv.slice(2) as [string, string, "long" | "short"];
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), ".wallets.json"), "utf8"));
if (!keys[name]) throw new Error(`no demo wallet ${name}`);
const me = privateKeyToAccount(keys[name]);
const net = NETWORKS.testnet, client = publicClient("testnet"), market = 16;
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const meta = await readPerpMeta(client, net.exchange, market);
const p = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(market)] })) as { markPNS: bigint };
const mark = Number(p.markPNS) / 10 ** Number(meta.priceDecimals);
const order = toCopyOrder({ market, side }, meta, { size: Number(sizeArg), markPrice: mark, maxSlippageBps: 200, orderDescId: suggestionDescId(me.address, Date.now()) });
const hash = await createWalletClient({ account: me, chain, transport: http(net.rpc) }).sendTransaction({ to: net.exchange, data: encodeCopyOrder(order) });
const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log(JSON.stringify({ name, side, size: sizeArg, tx: hash, status: r.status, block: r.blockNumber.toString() }));
