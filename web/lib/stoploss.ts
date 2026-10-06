// Stop-loss calls: a friend's stop on your position becomes a trigger order on Perpl, placed from your browser.
//
// A take-profit call is an on-chain order the owner signs. A stop-loss is a trigger, which Perpl's keeper evaluates
// off chain, so it goes through the trading API: the owner signs ONE EIP-712 enrollment (wallet or passkey account),
// the key pair it enrolls stays in this tab's memory, and every order after that is signed by that key. The owner's
// account must also allow order forwarding on the Exchange, the one transaction this flow can ask for.
import { encodeFunctionData, type Address, type Hex } from "viem";
import { FRENS_BUILDER_ID } from "./builder";
import { exchangeAbi, NETWORKS, publicClient, type Network } from "./perpl";
import {
  PERPL_ENV, PerplApiError, enrollApiKey, getOpenOrders, getWallet, placeStopLoss,
  type ApiCreds, type PerplEnv, type PerplOrder, type TypedDataSigner,
} from "./perplapi";

// Mainnet answers a browser from this site directly. Testnet does not whitelist the origin yet, so the browser goes
// through the same-origin relay (app/api/perpl), which forwards the signed request without an Origin header.
export function browserEnv(network: Network): PerplEnv {
  return network === "mainnet" ? PERPL_ENV.mainnet : { ...PERPL_ENV.testnet, apiUrl: "/api/perpl/testnet" };
}

// One enrolled key per owner address, in memory only: a reload asks for the signature again.
const keys = new Map<string, { creds: ApiCreds; builder: number | null }>();

export type StopLossPlaced = { order: PerplOrder; trigger: number; builder: number | null; forwardingTx: Hex | null };

export async function placeStopLossFor(p: {
  network: Network;
  owner: Address;
  market: number;
  price: number;
  signTypedData: TypedDataSigner;
  // Sends allowOrderForwarding(true) from the owner's wallet and resolves with the transaction hash.
  sendForwarding: (to: Address, data: Hex) => Promise<Hex>;
}): Promise<StopLossPlaced> {
  const env = browserEnv(p.network);
  const id = `${p.network}:${p.owner.toLowerCase()}`;
  let entry = keys.get(id);
  if (!entry) {
    const enroll = (builderId?: number) => enrollApiKey(env, {
      address: p.owner,
      signTypedData: p.signTypedData,
      label: "frens stop-loss calls",
      ...(builderId !== undefined ? { builderId, maxBuilderFeePer100k: 0 } : {}),
    });
    let builder: number | null = FRENS_BUILDER_ID;
    let enrolled;
    try {
      enrolled = await enroll(FRENS_BUILDER_ID);
    } catch (e) {
      // A deployment that has not registered builder 23 refuses the payload; the key still places orders without it.
      if (!(e instanceof PerplApiError)) throw e;
      builder = null;
      enrolled = await enroll();
    }
    entry = { creds: enrolled.creds, builder };
    keys.set(id, entry);
  }
  let forwardingTx: Hex | null = null;
  const wallet = await getWallet(env, entry.creds);
  const account = wallet.as[0];
  if (!account) throw new Error("This wallet has no Perpl account yet, so there is no position to protect.");
  if (!account.fw) {
    forwardingTx = await p.sendForwarding(NETWORKS[p.network].exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "allowOrderForwarding", args: [true] }));
    const receipt = await publicClient(p.network).waitForTransactionReceipt({ hash: forwardingTx, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`Allowing order forwarding reverted (tx ${forwardingTx.slice(0, 10)}…).`);
    for (let i = 0; !(await getWallet(env, entry.creds)).as[0]?.fw; i++) {
      if (i >= 30) throw new Error("Perpl has not registered order forwarding yet. Try Accept again in a moment.");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const order = await placeStopLoss(env, entry.creds, { market: p.market, triggerPrice: p.price });
  // placeStopLoss returns once the order is listed; read it once more so the receipt shown is what Perpl holds now.
  const resting = (await getOpenOrders(env, entry.creds)).d.find((o) => o.oid === order.oid);
  if (!resting) throw new Error("The stop-loss was accepted but is not listed as resting on Perpl.");
  return { order: resting, trigger: p.price, builder: entry.builder, forwardingTx };
}
