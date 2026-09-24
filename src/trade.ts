// Spike step 1: open a small BTC long on Perpl, rest a take-profit, close the position,
// and prove every step by reading the Exchange contract back.
//
// Transactions are signed by `cast send`, so this process never holds a key:
//   real testnet: SIGNER='--private-key "$PRIVATE_KEY"' RPC=https://testnet-rpc.monad.xyz bun run src/trade.ts
//   local fork:   SIGNER='--unlocked --from 0x...' RPC=http://127.0.0.1:8545 bun run src/trade.ts
import { $ } from "bun";
import { encodeFunctionData, erc20Abi, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { exchangeAbi, NETWORKS, publicClient } from "./perpl";
import { readPerpMeta, readPosition } from "./readPosition";

const net = NETWORKS.testnet;
const RPC = process.env.RPC ?? net.rpc;
const SIGNER = process.env.SIGNER;
const TRADER = process.env.TRADER as Address;
const MARKET = Number(process.env.MARKET ?? 16); // testnet BTC
const LOTS = BigInt(process.env.LOTS ?? 10); // 10 lots = 0.0001 BTC at 5 lot decimals
const LEVERAGE_HDTHS = 300n; // 3x
if (!SIGNER || !TRADER) throw new Error("set SIGNER (cast signer flags) and TRADER (its address)");

const client = publicClient("testnet", RPC);
const txs: { step: string; hash: Hex }[] = [];

async function send(step: string, to: Address, data: Hex): Promise<Log[]> {
  // SIGNER is expanded by bash (e.g. "$PRIVATE_KEY"), never by this process.
  const out = await $`bash -c ${`cast send --json --rpc-url ${RPC} ${SIGNER} ${to} ${data}`}`.quiet().nothrow();
  if (out.exitCode !== 0) throw new Error(`${step} failed: ${out.stderr.toString().split("\n").slice(-3).join(" ")}`);
  const r = JSON.parse(out.stdout.toString());
  txs.push({ step, hash: r.transactionHash });
  if (r.status !== "0x1") throw new Error(`${step} reverted in ${r.transactionHash}`);
  console.log(`  tx ${step}: ${r.transactionHash}`);
  return r.logs;
}

type OrderDesc = {
  orderDescId: bigint; perpId: bigint; orderType: number; orderId: bigint; pricePNS: bigint; lotLNS: bigint;
  expiryBlock: bigint; postOnly: boolean; fillOrKill: boolean; immediateOrCancel: boolean; maxMatches: bigint;
  leverageHdths: bigint; lastExecutionBlock: bigint; amountCNS: bigint; maxNegPnlCollatBPS: bigint;
};
// On-chain order types are 0-indexed (dex-sdk RequestType). maxNegPnlCollatBPS 0 makes a taker
// fill that starts below mark revert (TakerOrderSettlementFailed, code 14); 1000 is the market cap.
const OPEN_LONG = 0, CLOSE_LONG = 2, CANCEL = 4;
let descId = BigInt(Date.now());
const order = (o: Partial<OrderDesc> & Pick<OrderDesc, "orderType">): OrderDesc => ({
  orderDescId: descId++, perpId: BigInt(MARKET), orderId: 0n, pricePNS: 0n, lotLNS: 0n, expiryBlock: 0n,
  postOnly: false, fillOrKill: false, immediateOrCancel: false, maxMatches: 0n, leverageHdths: LEVERAGE_HDTHS,
  lastExecutionBlock: 0n, amountCNS: 0n, maxNegPnlCollatBPS: 1000n, ...o,
});
const execOrder = (o: OrderDesc) => encodeFunctionData({ abi: exchangeAbi, functionName: "execOrder", args: [o] });

async function poll<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, tries = 20): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (ok(v)) return v;
    await Bun.sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const meta = await readPerpMeta(client, net.exchange, MARKET);
const pScale = 10 ** Number(meta.priceDecimals);
const perp = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(MARKET)] })) as { markPNS: bigint; basePricePNS: bigint };
const mark = Number(perp.markPNS) / pScale;
console.log(`market ${MARKET} ${meta.symbol}: mark ${mark}, trader ${TRADER}, rpc ${RPC}`);

// 1. Account with collateral.
const hasAccount = await client
  .readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [TRADER] })
  .then((a) => (a as { accountId: bigint }).accountId > 0n, () => false);
if (!hasAccount) {
  const min = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getMinAccountOpenCNS" })) as bigint;
  const bal = await client.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [TRADER] });
  if (bal < min) throw new Error(`need ${Number(min) / 1e6} aUSD to open a Perpl account, wallet holds ${Number(bal) / 1e6}`);
  await send("approve", net.collateral, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [net.exchange, min] }));
  const logs = await send("createAccount", net.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "createAccount", args: [min] }));
  const created = parseEventLogs({ abi: exchangeAbi, logs, eventName: "AccountCreated" });
  if (created.length !== 1) throw new Error("createAccount emitted no AccountCreated");
}
const acct = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [TRADER] })) as { accountId: bigint; balanceCNS: bigint };
console.log(`account ${acct.accountId}, balance ${Number(acct.balanceCNS) / 1e6} aUSD`);
const before = await readPosition(TRADER, MARKET, { network: "testnet", client });
if (before) throw new Error(`trader already has a ${before.side} ${before.size} position; close it first`);

// 2. Open: marketable limit IOC, 2% slippage bound (how Perpl's own UI builds a market order).
const openPx = BigInt(Math.round(mark * 1.02 * pScale));
await send("open long", net.exchange, execOrder(order({ orderType: OPEN_LONG, pricePNS: openPx, lotLNS: LOTS, immediateOrCancel: true })));
const opened = await poll("position to appear", () => readPosition(TRADER, MARKET, { network: "testnet", client }), (p) => p !== null);
const wantSize = Number(LOTS) / 10 ** Number(meta.lotDecimals);
if (opened!.side !== "long" || opened!.size !== wantSize) throw new Error(`expected long ${wantSize}, chain says ${opened!.side} ${opened!.size}`);
if (Math.abs(opened!.entryPrice - mark) / mark > 0.02) throw new Error(`entry ${opened!.entryPrice} outside 2% of mark ${mark}`);
console.log(`  READ BACK open: ${opened!.side} ${opened!.size} ${meta.symbol} @ ${opened!.entryPrice}, mark ${opened!.markPrice}, uPnL ${opened!.unrealizedPnl.toFixed(4)}, block ${opened!.block}`);

// 3. Take-profit as a native on-chain order: reduce-only CloseLong, post-only GTC, 5% above entry.
const tpPx = BigInt(Math.round(opened!.entryPrice * 1.05 * pScale));
const tpLogs = await send("take-profit", net.exchange, execOrder(order({ orderType: CLOSE_LONG, pricePNS: tpPx, lotLNS: LOTS, postOnly: true })));
const placed = parseEventLogs({ abi: exchangeAbi, logs: tpLogs, eventName: "OrderPlaced" });
if (placed.length !== 1) throw new Error("take-profit emitted no OrderPlaced");
const tpId = (placed[0].args as { orderId: bigint }).orderId;
const readOrder = async () => (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getOrderV2", args: [BigInt(MARKET), tpId] })) as { accountId: number; orderType: number; lotLNS: number; priceONS: number };
const tp = await readOrder();
// Resting prices are stored as an offset (ONS) from the market's base price.
if (BigInt(tp.accountId) !== acct.accountId || tp.orderType !== CLOSE_LONG || BigInt(tp.lotLNS) !== LOTS || BigInt(tp.priceONS) + perp.basePricePNS !== tpPx) throw new Error(`TP read back wrong: ${JSON.stringify(tp, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
console.log(`  READ BACK take-profit: order ${tpId} on book, CloseLong ${tp.lotLNS} lots @ ${Number(tpPx) / pScale}`);

// 4. Close: reduce-only CloseLong IOC, 2% below mark.
const closePx = BigInt(Math.round(mark * 0.98 * pScale));
await send("close", net.exchange, execOrder(order({ orderType: CLOSE_LONG, pricePNS: closePx, lotLNS: LOTS, immediateOrCancel: true })));
await poll("position to disappear", () => readPosition(TRADER, MARKET, { network: "testnet", client }), (p) => p === null);
console.log(`  READ BACK close: no ${meta.symbol} position for ${TRADER}`);

// 5. The resting TP is now orphaned; cancel it if the exchange did not.
const after = await readOrder();
if (BigInt(after.accountId) === acct.accountId && after.lotLNS > 0) {
  console.log(`  take-profit ${tpId} still resting after close; cancelling`);
  await send("cancel tp", net.exchange, execOrder(order({ orderType: CANCEL, orderId: tpId })));
  const gone = await readOrder();
  if (BigInt(gone.accountId) === acct.accountId && gone.lotLNS > 0) throw new Error("take-profit still on book after cancel");
  console.log(`  READ BACK cancel: order ${tpId} gone`);
} else console.log(`  take-profit ${tpId} was removed by the exchange with the position`);

console.log(JSON.stringify({ rpc: RPC, trader: TRADER, accountId: acct.accountId.toString(), txs }, null, 2));
