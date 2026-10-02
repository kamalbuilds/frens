// Releases CallStakes the moment Perpl's mark reaches their TP. Anyone may call release, so this needs no special
// rights: it signs with a demo fren's key (gitignored demo/.wallets.json, never printed) only to pay gas.
//   bun run demo/release-keeper.ts [<stake id> ...]   (env KEEPER=cy, POLL_MS=5000)
// With no ids it watches the contract's Staked events itself (100-block pages, cursor in KEEPER_CURSOR). The
// signer is KEEPER_KEY_FILE ({"key":"0x.."}, gitignored, made on the host that runs it) or a demo fren's key.
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { padGas } from "../web/lib/wallet";
import { callStakeAbi } from "../web/lib/callstake";

const here = path.dirname(new URL(import.meta.url).pathname);
const ids = process.argv.slice(2) as Hex[];
const net = NETWORKS.testnet;
// Reads go through the private RPC when the host has one (the public one caps at 15 requests/s, shared by every app).
const client = publicClient("testnet", process.env.MONAD_TESTNET_RPC_URL || undefined);
// CALLSTAKE picks one deployment (current or legacy) so each contract gets its own keeper and cursor.
const deployments = JSON.parse(fs.readFileSync(path.join(here, "../contracts/deployments.json"), "utf8"));
const target = process.env.CALLSTAKE
  ? [deployments.testnet, ...(deployments.testnetLegacy ?? [])].find((d: { CallStake: string }) => d.CallStake.toLowerCase() === process.env.CALLSTAKE!.toLowerCase())
  : deployments.testnet;
if (!target) throw new Error(`no deployment for CALLSTAKE=${process.env.CALLSTAKE}`);
const CallStake = target.CallStake as Hex;
const art = { abi: callStakeAbi as unknown as { type: string; name: string }[] };
const keyFile = process.env.KEEPER_KEY_FILE;
const account = privateKeyToAccount(
  keyFile
    ? (JSON.parse(fs.readFileSync(keyFile, "utf8")).key as Hex)
    : (JSON.parse(fs.readFileSync(path.join(here, ".wallets.json"), "utf8")) as Record<string, Hex>)[process.env.KEEPER ?? "cy"]!,
);
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account, chain, transport: http(net.rpc) });
const poll = Number(process.env.POLL_MS ?? 5000);

const open = new Set(ids);
const watch = ids.length === 0;
const cursorFile = process.env.KEEPER_CURSOR ?? path.join(here, ".keeper-cursor");
// The cursor file holds the next block to scan AND the stakes still open, so a restart resumes both.
// An older keeper wrote a bare block number; read that as a cursor with nothing open.
const rawSaved = fs.existsSync(cursorFile) ? (JSON.parse(fs.readFileSync(cursorFile, "utf8")) as unknown) : null;
const saved = typeof rawSaved === "number" ? { cursor: String(rawSaved), open: [] as Hex[] } : (rawSaved as { cursor: string; open: Hex[] } | null);
let cursor = saved ? BigInt(saved.cursor) : BigInt(target.block);
for (const id of saved?.open ?? []) open.add(id);
const save = () => fs.writeFileSync(cursorFile, JSON.stringify({ cursor: cursor.toString(), open: [...open] }));
const stakedEvent = art.abi.find((x: { type: string; name: string }) => x.type === "event" && x.name === "Staked");
async function discover() {
  const head = await client.getBlockNumber();
  while (cursor <= head) {
    const to = cursor + 99n > head ? head : cursor + 99n;
    const logs = await client.getLogs({ address: CallStake, event: stakedEvent, fromBlock: cursor, toBlock: to });
    for (const l of logs) {
      const id = (l as unknown as { args: { id: Hex } }).args.id;
      if (!open.has(id)) console.log(`watching stake ${id.slice(0, 12)}`);
      open.add(id);
    }
    cursor = to + 1n;
    save(); // per page, so a restart mid-scan neither rescans nor loses a stake found earlier in the scan
  }
}
console.log(`keeper ${account.address} on ${CallStake.slice(0, 10)} watching ${watch ? "Staked events" : ids.length + " ids"}, ${open.size} open from the last run`);
while (watch || open.size) {
  if (watch) await discover().catch((e) => console.log(`discover: ${String(e).slice(0, 100)}`));
  for (const id of [...open]) {
   try {
    const s = (await client.readContract({ address: CallStake, abi: art.abi, functionName: "stakes", args: [id] })) as unknown[];
    const [, caller, amount, expiry, perpId, closeLong, state, tp] = s as [string, string, bigint, bigint, number, boolean, number, bigint];
    if (state !== 1) { console.log(`${id.slice(0, 12)} state ${state}, done`); open.delete(id); save(); continue; }
    const info = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(perpId)] })) as { markPNS: bigint };
    const crossed = closeLong ? info.markPNS >= tp : info.markPNS <= tp;
    if (Date.now() / 1000 >= Number(expiry)) { console.log(`${id.slice(0, 12)} expired; refund is open to anyone`); open.delete(id); save(); continue; }
    if (!crossed) continue;
    const data = encodeFunctionData({ abi: art.abi, functionName: "release", args: [id] });
    try {
      const gas = padGas(await client.estimateGas({ account: account.address, to: CallStake, data }));
      const hash = await w.sendTransaction({ to: CallStake, data, gas });
      const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      console.log(JSON.stringify({ id, released: hash, status: r.status, caller, amount: String(amount), markPNS: String(info.markPNS), tpPNS: String(tp), at: new Date().toISOString() }));
      if (r.status === "success") { open.delete(id); save(); }
    } catch (e) {
      console.log(`${id.slice(0, 12)} release raced the mark: ${String(e).slice(0, 100)}`);
    }
   } catch (e) {
    // A failed read (rate limit, node hiccup) skips this poll for this stake; the next poll retries.
    console.log(`${id.slice(0, 12)} read failed: ${String(e).slice(0, 80)}`);
   }
  }
  await new Promise((r) => setTimeout(r, poll));
}
