// Accepts a call link on Perpl TESTNET as its owner, exactly as the app's Accept button does:
// decodeSuggestion -> validateSuggestion against the live position -> toCloseOrder -> execOrder, signed by
// the owner's key from demo/.wallets.json (gitignored). Reads the caller back out of OrderRequestV2.
//   bun run demo/accept-call.ts "<call link or s= payload>"
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, publicClient } from "../web/lib/perpl";
import { padGas } from "../web/lib/wallet";
import { readPerpMeta, readPosition } from "../web/lib/readPosition";
import { buildAcceptOrders, decodeSuggestion, encodeAcceptBatch, encodeCloseOrder, sizeToLots, toCloseOrder, validateSuggestion } from "../web/lib/suggest";
import { findRestingCloses } from "../web/lib/resting";
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
// Same as the app: resting closes found from the room's accept receipts (KNOWN_TXS, comma separated) are
// cancelled and the new close placed in one execOrders batch, so a single signature replaces an old TP.
const knownTxs = (process.env.KNOWN_TXS ?? "").split(",").map((h) => h.trim()).filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h)) as Hex[];
const resting = (await findRestingCloses("testnet", client, s.owner, s.market, { knownTxs })).filter((r) => r.side === (s.side === "long" ? "close-long" : "close-short"));
const orders = buildAcceptOrders(order, resting.map((r) => r.orderId));
const data = orders.length > 1 ? encodeAcceptBatch(orders, true) : encodeCloseOrder(order);
console.log(`resting closes replaced: ${resting.map((r) => `${r.orderId}@${r.price}`).join(", ") || "none"}`);
const w = createWalletClient({ account: owner, chain, transport: http(net.rpc) });
const gas = padGas(await client.estimateGas({ account: owner.address, to: net.exchange, data }));
const hash = await w.sendTransaction({ to: net.exchange, data, gas });
const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (r.status !== "success") throw new Error(`accept reverted: ${hash}`);

const req = r.logs
  .map((l) => { try { return decodeEventLog({ abi: officialAbi as never, data: l.data, topics: l.topics }); } catch { return null; } })
  .find((e) => (e as { eventName?: string } | null)?.eventName === "OrderRequestV2") as { args: { orderDescId: bigint } } | undefined;
const caller = req ? decodeDescId(req.args.orderDescId) : null;
if (caller?.suggester.toLowerCase() !== s.from.toLowerCase()) throw new Error("caller not found in OrderRequestV2.orderDescId");
console.log(JSON.stringify({ accepted: hash, block: r.blockNumber.toString(), owner: s.owner, caller: caller.suggester, side: s.side, price: s.price }, null, 1));
