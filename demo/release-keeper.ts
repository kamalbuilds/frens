// Releases CallStakes the moment Perpl's mark reaches their TP. Anyone may call release, so this needs no special
// rights: it signs with a demo fren's key (gitignored demo/.wallets.json, never printed) only to pay gas.
//   bun run demo/release-keeper.ts <stake id> [<stake id> ...]   (env KEEPER=cy, POLL_MS=5000)
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { padGas } from "../web/lib/wallet";

const here = path.dirname(new URL(import.meta.url).pathname);
const ids = process.argv.slice(2) as Hex[];
const net = NETWORKS.testnet;
const client = publicClient("testnet");
const { CallStake } = JSON.parse(fs.readFileSync(path.join(here, "../contracts/deployments.json"), "utf8")).testnet;
const art = JSON.parse(fs.readFileSync(path.join(here, "../contracts/out/CallStake.sol/CallStake.json"), "utf8"));
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(here, ".wallets.json"), "utf8"));
const account = privateKeyToAccount(keys[process.env.KEEPER ?? "cy"]!);
const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [net.rpc] } } } as const;
const w = createWalletClient({ account, chain, transport: http(net.rpc) });
const poll = Number(process.env.POLL_MS ?? 5000);

const open = new Set(ids);
while (open.size) {
  for (const id of [...open]) {
    const s = (await client.readContract({ address: CallStake, abi: art.abi, functionName: "stakes", args: [id] })) as unknown[];
    const [, caller, amount, expiry, perpId, closeLong, state, tp] = s as [string, string, bigint, bigint, number, boolean, number, bigint];
    if (state !== 1) { console.log(`${id.slice(0, 12)} state ${state}, done`); open.delete(id); continue; }
    const info = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [BigInt(perpId)] })) as { markPNS: bigint };
    const crossed = closeLong ? info.markPNS >= tp : info.markPNS <= tp;
    if (Date.now() / 1000 >= Number(expiry)) { console.log(`${id.slice(0, 12)} expired; refund is open to anyone`); open.delete(id); continue; }
    if (!crossed) continue;
    const data = encodeFunctionData({ abi: art.abi, functionName: "release", args: [id] });
    try {
      const gas = padGas(await client.estimateGas({ account: account.address, to: CallStake, data }));
      const hash = await w.sendTransaction({ to: CallStake, data, gas });
      const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      console.log(JSON.stringify({ id, released: hash, status: r.status, caller, amount: String(amount), markPNS: String(info.markPNS), tpPNS: String(tp), at: new Date().toISOString() }));
      if (r.status === "success") open.delete(id);
    } catch (e) {
      console.log(`${id.slice(0, 12)} release raced the mark: ${String(e).slice(0, 100)}`);
    }
  }
  await new Promise((r) => setTimeout(r, poll));
}
