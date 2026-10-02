// Can frens place a STOP-LOSS trigger order through Perpl's authenticated API on testnet, read it back and cancel it?
//   bun --env-file=.env run spike/stoploss-probe.ts
//
// Whose account: the testnet deployer (PRIVATE_KEY) funds and signs for a probe wallet whose key is derived from a
// deployer signature, so it is the same wallet on every run and never printed or stored. The deployer's own Perpl
// account cannot take API orders any more: an earlier probe sent request ids from Date.now() (1.79e12), the gateway
// accepted them, the Exchange stores the last request id as uint32 and failed them, and the gateway now refuses every
// smaller id for that account. The probe account stays below 2^32 by seeding request ids from lfr (see nextRequestId).
//
// Flow: fund probe wallet and open its Perpl account (once) -> open a 0.001 BTC long on market 16 if none -> enroll an
// API key (wallet EIP-712 signature, Ed25519 secret in memory only) -> stop 3% below mark -> read back over REST and the
// trading WebSocket -> cancel -> read that it is gone. Prints ids and responses, never a key or token.
import { createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, parseEther, type Account, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { readPerpMeta, readPosition } from "../web/lib/readPosition";
import { encodeCopyOrder, toCopyOrder } from "../web/lib/copy";
import { FRENS_BUILDER_ID } from "../web/lib/builder";
import { padGas } from "../web/lib/wallet";
import {
  PERPL_ENV, PerplApiError, cancelOrder, enrollApiKey, getMarkets, getOpenOrders, getOpenPositions, getOrderHistory, getWallet, nextRequestId,
  placeStopLoss, readTradingSnapshot, stopLossSpec, submitOrders, type ApiCreds, type ApiKeyInfo,
} from "../web/lib/perplapi";

const MARKET = 16;
const STOP_BPS = 300;
const OPEN_ACCOUNT_AUSD = 100_000_000n; // Perpl min_account_open_amount, 100 aUSD
const net = NETWORKS.testnet;
const env = PERPL_ENV.testnet;
const client = publicClient("testnet", process.env.MONAD_TESTNET_RPC_URL || undefined);
const chain = { id: net.chainId, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const probe = privateKeyToAccount(keccak256(await deployer.signMessage({ message: "frens stoploss probe wallet v1" })));
const show = (label: string, v: unknown) => console.log(`${label}: ${JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}`);
const fail = (msg: string): never => { console.error(`FAIL: ${msg}`); process.exit(1); };

async function send(from: Account, to: Hex, data: Hex, label: string) {
  const wallet = createWalletClient({ account: from, chain, transport: http(net.rpc) });
  const gas = padGas(await client.estimateGas({ account: from.address, to, data }));
  const hash = await wallet.sendTransaction({ to, data, gas });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") fail(`${label} reverted: ${hash}`);
  console.log(`tx ${label}: ${hash}`);
}
async function until<T>(what: string, read: () => Promise<T | null | undefined | false>, tries = 40): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await read(); if (v) return v; await Bun.sleep(1000); }
  return fail(`timed out waiting for ${what}`);
}
const hasAccount = async (addr: Hex) => {
  try { return ((await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [addr] })) as { accountId: bigint }).accountId !== 0n; }
  catch (e) { if (String(e).includes("revert")) return false; throw e; }
};

console.log(`deployer ${deployer.address} funds probe wallet ${probe.address}; perpl ${env.name} chain ${env.chainId}`);

// 0. Probe wallet: gas, collateral, Perpl account, order forwarding (one time).
if ((await client.getBalance({ address: probe.address })) < parseEther("0.3")) {
  const wallet = createWalletClient({ account: deployer, chain, transport: http(net.rpc) });
  const hash = await wallet.sendTransaction({ to: probe.address, value: parseEther("0.5") });
  await client.waitForTransactionReceipt({ hash });
  console.log(`tx fund 0.5 MON: ${hash}`);
}
const ausd = (a: Hex) => client.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [a] });
if (!(await hasAccount(probe.address))) {
  if ((await ausd(probe.address)) < OPEN_ACCOUNT_AUSD) await send(deployer, net.collateral, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [probe.address, 150_000_000n] }), "fund 150 aUSD");
  await send(probe, net.collateral, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [net.exchange, OPEN_ACCOUNT_AUSD] }), "approve aUSD");
  await send(probe, net.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "createAccount", args: [OPEN_ACCOUNT_AUSD] }), "createAccount(100 aUSD)");
  await until("perpl account", () => hasAccount(probe.address));
}

// 1. A position to protect, opened through the app's copy order builder (execOrderV2 with builder 23).
let pos = await readPosition(probe.address, MARKET, { network: "testnet", client });
if (!pos) {
  const meta = await readPerpMeta(client, net.exchange, MARKET);
  const info = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(MARKET)] })) as { markPNS: bigint };
  const mark = Number(info.markPNS) / 10 ** Number(meta.priceDecimals);
  const order = toCopyOrder({ market: MARKET, side: "long" }, meta, { size: 0.001, markPrice: mark, maxSlippageBps: 100, orderDescId: BigInt(Date.now()) });
  await send(probe, net.exchange, encodeCopyOrder(order), "open 0.001 BTC long (builder 23)");
  pos = await until("position on chain", () => readPosition(probe.address, MARKET, { network: "testnet", client }));
}
show("on-chain position", { side: pos.side, size: pos.size, entry: pos.entryPrice, mark: pos.markPrice });

// 2. Enroll a trade-scoped key bound to builder 23. The wallet signs the EIP-712 payload; the Ed25519 secret stays here.
const signTypedData = (td: Parameters<typeof probe.signTypedData>[0]) => probe.signTypedData(td);
let creds: ApiCreds;
let info: ApiKeyInfo;
try {
  ({ creds, info } = await enrollApiKey(env, { address: probe.address, signTypedData: signTypedData as never, label: "frens stoploss probe", builderId: FRENS_BUILDER_ID, maxBuilderFeePer100k: 0 }));
} catch (e) {
  if (!(e instanceof PerplApiError)) throw e;
  console.log(`builder-23 enrollment refused (${e.message}); enrolling a key with no builder to test the rest of the flow`);
  ({ creds, info } = await enrollApiKey(env, { address: probe.address, signTypedData: signTypedData as never, label: "frens stoploss probe (no builder)" }));
}
show("enrolled key", { ...info, api_key: "<redacted>" });

// 3. Order forwarding must be on for any API order. fw is only visible through the API.
let w = await getWallet(env, creds);
show("account", { id: w.as[0].id, fw: w.as[0].fw, lfr: w.as[0].lfr });
if (!w.as[0].fw) {
  await send(probe, net.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "allowOrderForwarding", args: [true] }), "allowOrderForwarding(true)");
  w = await until("fw true", async () => { const x = await getWallet(env, creds); return x.as[0].fw ? x : null; });
}

// 4. Stop 3% beyond mark on the losing side.
const apiPos = (await getOpenPositions(env, creds)).d.find((p) => p.mkt === MARKET);
if (!apiPos) fail("API shows no position on market 16");
const market = (await getMarkets(env)).find((m) => m.id === MARKET)!;
const dec = 10 ** market.config.price_decimals;
const mark = market.state.mrk / dec;
const long = apiPos!.sd === 1;
const trigger = Math.round(mark * (long ? 1 - STOP_BPS / 1e4 : 1 + STOP_BPS / 1e4) * dec) / dec;
show("api position", apiPos);
console.log(`mark ${mark}, ${long ? "long" : "short"}, stop trigger ${trigger}`);

const sl = await placeStopLoss(env, creds, { market: MARKET, triggerPrice: trigger });
show("stop-loss order (REST open orders)", sl);
if (sl.tp !== Math.round(trigger * dec) || sl.t !== (long ? 3 : 4) || sl.lp !== apiPos!.pid || sl.os !== apiPos!.s) fail("order read-back does not match what was sent");

// 5. Second surface: the trading WebSocket snapshot.
const snap = await readTradingSnapshot(env, creds);
const wsOrder = snap.orders.d.find((o) => o.oid === sl.oid);
show("trading ws orders snapshot", wsOrder);
if (!wsOrder || wsOrder.tp !== sl.tp) fail("stop-loss missing from the WebSocket orders snapshot");
show("builder terms on the key", { builder_id: info.builder_id ?? null, max_builder_fee_per_100k: info.max_builder_fee_per_100k ?? null });

// 6. Cancel and prove it is gone on both surfaces.
await cancelOrder(env, creds, { market: MARKET, orderId: sl.oid });
const after = await getOpenOrders(env, creds);
const wsAfter = await readTradingSnapshot(env, creds);
show("after cancel", { restHasIt: after.d.some((o) => o.oid === sl.oid), wsHasIt: wsAfter.orders.d.some((o) => o.oid === sl.oid), openOrders: after.d.length });
if (after.d.some((o) => o.oid === sl.oid) || wsAfter.orders.d.some((o) => o.oid === sl.oid)) fail("stop-loss still listed after cancel");
console.log("OK stop-loss placed, read back and cancelled");

// 7. FIRE=1: a trigger that is already met fires at once, which shows the exchange executes stop-losses with no keeper of
// ours: the position closes and order history records the trigger as Executed. It closes the probe position.
if (process.env.FIRE === "1") {
  const lfr = (await getWallet(env, creds)).as[0].lfr;
  const spec = { ...stopLossSpec(apiPos!, market, trigger, nextRequestId(lfr)), tp: market.state.mrk + (long ? 100 : -100) };
  show("firing trigger", spec);
  show("status", await submitOrders(env, creds, [spec]));
  await until("position closed", async () => !(await getOpenPositions(env, creds)).d.some((p) => p.mkt === MARKET));
  const done = await until("trigger Executed in history", async () => (await getOrderHistory(env, creds)).d.find((o) => o.rq === spec.rq && o.st === 10));
  show("order history entry", done);
  console.log("OK trigger fired, position closed, no keeper needed");
}
