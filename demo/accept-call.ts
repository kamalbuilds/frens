// Accepts a call link on Perpl TESTNET as its owner, exactly as the app's Accept button does:
// decodeSuggestion -> validateSuggestion against the live position -> toCloseOrder -> execOrder, signed by
// the owner's key from demo/.wallets.json (gitignored). Reads the caller back out of OrderRequestV2.
//   bun run demo/accept-call.ts "<call link or s= payload>"
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, publicClient } from "../web/lib/perpl";
import { readPerpMeta, readPosition } from "../web/lib/readPosition";
import { decodeSuggestion, encodeCloseOrder, sizeToLots, toCloseOrder, validateSuggestion } from "../web/lib/suggest";
import { decodeDescId } from "../web/lib/callbook";
import officialAbi from "../spike/exchange-official.abi.json";

const net = NETWORKS.testnet;
const client = publicClient("testnet");
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const arg = process.argv[2] ?? "";
const payload = arg.includes("s=") ? new URL(arg).searchParams.get("s") ?? "" : arg;
const s = decodeSuggestion(payload);
if (!s) throw new Error("not a valid call link");

const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), ".wallets.json"), "utf8"));
const owner = Object.values(keys).map((k) => privateKeyToAccount(k)).find((a) => a.address.toLowerCase() === s.owner.toLowerCase());
if (!owner) throw new Error(`no demo wallet owns ${s.owner}`);

const position = await readPosition(s.owner, s.market, { network: "testnet", client });
if (!position) throw new Error("owner has no open position on this market");
const meta = await readPerpMeta(client, net.exchange, s.market);
const problems = validateSuggestion(s, position, meta.lotDecimals);
if (problems.length) throw new Error(`call rejected: ${problems.join("; ")}`);

const order = toCloseOrder(s, meta, { fullSizeLots: sizeToLots(position.size, meta.lotDecimals) });
const w = createWalletClient({ account: owner, chain, transport: http(net.rpc) });
const hash = await w.sendTransaction({ to: net.exchange, data: encodeCloseOrder(order) });
const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (r.status !== "success") throw new Error(`accept reverted: ${hash}`);

const req = r.logs
  .map((l) => { try { return decodeEventLog({ abi: officialAbi as never, data: l.data, topics: l.topics }); } catch { return null; } })
  .find((e) => (e as { eventName?: string } | null)?.eventName === "OrderRequestV2") as { args: { orderDescId: bigint } } | undefined;
const caller = req ? decodeDescId(req.args.orderDescId) : null;
if (caller?.suggester.toLowerCase() !== s.from.toLowerCase()) throw new Error("caller not found in OrderRequestV2.orderDescId");
console.log(JSON.stringify({ accepted: hash, block: r.blockNumber.toString(), owner: s.owner, caller: caller.suggester, side: s.side, price: s.price }, null, 1));
