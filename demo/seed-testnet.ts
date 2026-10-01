// Seeds a real frens room on Perpl TESTNET (Monad 10143), using the app's own order builders.
// Four fresh wallets (keys in demo/.wallets.json, gitignored, never printed) are funded from the deployer
// (DEPLOYER_KEY env), open real positions, copy each other and accept each other's calls on chain.
// Every step is read back from chain. Output: demo/ROOMS.md with the room link and open call links.
//   DEPLOYER_KEY=0x... bun run demo/seed-testnet.ts
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, encodeFunctionData, erc20Abi, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { readPerpMeta, readPosition } from "../web/lib/readPosition";
import { toCopyOrder, encodeCopyOrder } from "../web/lib/copy";
import { toCloseOrder, encodeCloseOrder, encodeSuggestion, sizeToLots } from "../web/lib/suggest";
import { suggestionDescId, decodeDescId } from "../web/lib/callbook";
import { encodeRoom } from "../web/lib/roomlink";

const net = NETWORKS.testnet;
const MARKET = 16; // testnet BTC
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const client = publicClient("testnet");
const dir = path.dirname(new URL(import.meta.url).pathname);
const walletsFile = path.join(dir, ".wallets.json");
const NAMES = ["ana", "bo", "cy", "dee"] as const;

const deployerKey = process.env.DEPLOYER_KEY as Hex | undefined;
if (!deployerKey) throw new Error("set DEPLOYER_KEY");
const deployer = privateKeyToAccount(deployerKey);

const keys: Record<string, Hex> = fs.existsSync(walletsFile) ? JSON.parse(fs.readFileSync(walletsFile, "utf8")) : {};
for (const n of NAMES) keys[n] ??= generatePrivateKey();
fs.writeFileSync(walletsFile, JSON.stringify(keys), { mode: 0o600 });
const acct = Object.fromEntries(NAMES.map((n) => [n, privateKeyToAccount(keys[n])])) as Record<(typeof NAMES)[number], ReturnType<typeof privateKeyToAccount>>;

const log: string[] = [];
const note = (s: string) => { console.log(s); log.push(s); };

async function send(from: ReturnType<typeof privateKeyToAccount>, to: Address, data: Hex, value = 0n, step = "") {
  const w = createWalletClient({ account: from, chain, transport: http(net.rpc) });
  const hash = await w.sendTransaction({ to, data, value });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`${step} reverted: ${hash}`);
  note(`  tx ${step}: ${hash}`);
  return r;
}

const mark = async () => {
  const meta = await readPerpMeta(client, net.exchange, MARKET);
  const p = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(MARKET)] })) as { markPNS: bigint };
  return { meta, mark: Number(p.markPNS) / 10 ** Number(meta.priceDecimals) };
};

// 1. Fund: 1.5 MON for gas and 1,000 aUSD each, only if below half of that.
for (const n of NAMES) {
  const a = acct[n].address;
  if ((await client.getBalance({ address: a })) < parseEther("0.75")) await send(deployer, a, "0x", parseEther("1.5"), `fund MON ${n}`);
  const bal = await client.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  if (bal < 500_000_000n) await send(deployer, net.collateral, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [a, 1_000_000_000n] }), 0n, `fund aUSD ${n}`);
}

// 2. Perpl account with 500 aUSD collateral each.
for (const n of NAMES) {
  const a = acct[n].address;
  const has = await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getAccountByAddr", args: [a] }).then((x) => (x as { accountId: bigint }).accountId > 0n, () => false);
  if (has) continue;
  await send(acct[n], net.collateral, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [net.exchange, 500_000_000n] }), 0n, `approve ${n}`);
  await send(acct[n], net.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "createAccount", args: [500_000_000n] }), 0n, `createAccount ${n}`);
}

// 3. Positions. ana and bo open their own; cy copies ana and dee copies bo through toCopyOrder, the app's
//    one-tap copy builder, with the copied fren written into orderDescId.
async function open(n: (typeof NAMES)[number], side: "long" | "short", size: number, copied?: Address) {
  const before = await readPosition(acct[n].address, MARKET, { network: "testnet", client });
  if (before) { note(`${n} already ${before.side} ${before.size} @ ${before.entryPrice}`); return; }
  const { meta, mark: m } = await mark();
  const order = toCopyOrder({ market: MARKET, side }, meta, { size, markPrice: m, maxSlippageBps: 200, orderDescId: suggestionDescId(copied ?? acct[n].address, Date.now()) });
  await send(acct[n], net.exchange, encodeCopyOrder(order), 0n, `${copied ? "copy" : "open"} ${side} ${n}`);
  // State at "latest" can trail the receipt by a block or two: poll before declaring it missing.
  let p = null;
  for (let i = 0; i < 20 && !(p && p.side === side); i++) {
    p = await readPosition(acct[n].address, MARKET, { network: "testnet", client });
    if (!(p && p.side === side)) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!p || p.side !== side) throw new Error(`${n}: position not on chain after open`);
  note(`READ BACK ${n}: ${p.side} ${p.size} BTC @ ${p.entryPrice}`);
}
await open("ana", "long", 0.002);
await open("bo", "short", 0.0015);
await open("cy", "long", 0.001, acct.ana.address);
await open("dee", "short", 0.001, acct.bo.address);

// 4. Calls. ana calls a take-profit on bo's short; bo accepts it on chain (toCloseOrder carries ana in
//    orderDescId). cy calls a take-profit on dee's short and it is left open for the live demo.
const { meta, mark: m } = await mark();
const bo = await readPosition(acct.bo.address, MARKET, { network: "testnet", client });
if (!bo) throw new Error("bo has no position");
const callOnBo = { owner: acct.bo.address, market: MARKET, side: "short" as const, price: Math.round(m * 0.97), from: acct.ana.address, createdAt: Date.now() };
const close = toCloseOrder(callOnBo, meta, { fullSizeLots: sizeToLots(bo.size, meta.lotDecimals) });
const r = await send(acct.bo, net.exchange, encodeCloseOrder(close), 0n, "bo accepts ana's TP");
const caller = decodeDescId(close.orderDescId);
if (caller?.suggester.toLowerCase() !== acct.ana.address.toLowerCase()) throw new Error("caller not encoded in orderDescId");
note(`READ BACK call: TP ${callOnBo.price} on bo's short, resting on Perpl, caller ${caller.suggester} in orderDescId, block ${r.blockNumber}`);

const callOnDee = { owner: acct.dee.address, market: MARKET, side: "short" as const, price: Math.round(m * 0.96), from: acct.cy.address, createdAt: Date.now() };

// 5. Links for the demo.
const site = process.env.SITE ?? "https://frenstrade.vercel.app";
const room = encodeRoom(NAMES.map((n) => acct[n].address));
const md = [
  "# Testnet demo room (seeded by demo/seed-testnet.ts)",
  "",
  `Seeded ${new Date().toISOString()}. Perpl testnet, market ${MARKET} (BTC). Mark at seeding: ${m}.`,
  "",
  "| fren | address | role |",
  "|---|---|---|",
  `| ana | ${acct.ana.address} | long, called the TP on bo |`,
  `| bo | ${acct.bo.address} | short, accepted ana's TP on chain |`,
  `| cy | ${acct.cy.address} | copied ana's long in one tap |`,
  `| dee | ${acct.dee.address} | copied bo's short; has an open call from cy |`,
  "",
  `Room: ${site}/r/${room}?net=testnet`,
  "",
  `Open call for the live demo (dee accepts it): ${site}/r/${room}?net=testnet&s=${encodeSuggestion(callOnDee)}`,
  "",
  "Transactions:",
  ...log.filter((l) => l.includes("tx ")).map((l) => `- ${l.trim()}`),
  "",
  "Read back from chain:",
  ...log.filter((l) => l.startsWith("READ BACK")).map((l) => `- ${l}`),
  "",
].join("\n");
fs.writeFileSync(path.join(dir, "ROOMS.md"), md);
console.log("\nwrote demo/ROOMS.md");
