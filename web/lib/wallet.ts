// Browser wallet for one-tap copy trades.
//
// Non-custodial end to end. This module never receives, stores, derives or
// forwards a private key, and it never signs server side: it speaks EIP-1193 to
// the copier's own injected wallet (window.ethereum), which holds the key, shows
// the Perpl execOrder call in its own confirmation UI and signs it there. A
// copied trade is an ordinary swap the wallet can read, price and refuse.
//
// Everything here is browser only. There is no privateKeyToAccount, no account
// hoisting from a seed and no signing helper: the only two things the copier can
// do are grant access to an address and have their own wallet sign bytes we
// built in copy.ts.
//
// Every call takes the selected network and lands the wallet on that chain
// before signing, sending to that network's Exchange.
import { createWalletClient, custom, http, toHex, type Address, type Chain, type EIP1193Provider, type Hex, type LocalAccount } from "viem";
import { monad, monadTestnet } from "viem/chains";
import { NETWORKS, publicClient, type Network } from "./perpl";

// viem's chain definitions must stay aligned with perpl.ts or an order could
// be signed for the wrong chain. This fails loudly at import instead.
if (monad.id !== NETWORKS.mainnet.chainId || monadTestnet.id !== NETWORKS.testnet.chainId) {
  throw new Error(
    `viem chain ids ${monad.id}/${monadTestnet.id} do not match perpl.ts ${NETWORKS.mainnet.chainId}/${NETWORKS.testnet.chainId}`,
  );
}

export const CHAINS: Record<Network, Chain> = { mainnet: monad, testnet: monadTestnet };

export function chainFor(network: Network): Chain {
  return CHAINS[network];
}

function chainLabel(network: Network): string {
  return network === "mainnet" ? "Monad mainnet" : "Monad testnet";
}

// EIP-1193 error 4902 is "chain is not known to this wallet", the one failure
// wallet_switchEthereumChain raises that we can fix ourselves by adding it.
const CHAIN_NOT_ADDED = 4902;

type InjectedProvider = EIP1193Provider & { isMetaMask?: boolean };

// window.ethereum is not in the DOM lib, and augmenting the global Window from a
// lib file would leak into every other file, so read it through a narrow cast.
function injectedProvider(): InjectedProvider {
  if (typeof window === "undefined") {
    throw new Error("the wallet is browser only; call connect() from a client component or an event handler");
  }
  const eth = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  if (!eth || typeof eth.request !== "function") {
    throw new Error("no EIP-1193 wallet found on window.ethereum; install a browser wallet and unlock it");
  }
  return eth;
}

function addChainParams(network: Network) {
  const chain = chainFor(network);
  return {
    chainId: toHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [NETWORKS[network].rpc],
    blockExplorerUrls: chain.blockExplorers?.default ? [chain.blockExplorers.default.url] : [],
  };
}

function chainIdOf(e: unknown): number | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

async function currentChainId(eth: InjectedProvider): Promise<number> {
  return Number(await eth.request({ method: "eth_chainId" }));
}

// Put the wallet on the selected chain, adding the chain first if the wallet
// has never heard of it. The chain id is re-read afterwards instead of
// assumed, because a wallet that accepted wallet_addEthereumChain but stayed
// on the old chain would otherwise sign an order against an RPC that cannot
// see the Exchange.
async function ensureNetwork(eth: InjectedProvider, network: Network): Promise<void> {
  const chain = chainFor(network);
  if ((await currentChainId(eth)) === chain.id) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(chain.id) }] });
  } catch (e) {
    if (chainIdOf(e) !== CHAIN_NOT_ADDED) {
      throw new Error(`the wallet refused to switch to ${chainLabel(network)} (chain ${chain.id}): ${String(e)}`);
    }
    await eth.request({ method: "wallet_addEthereumChain", params: [addChainParams(network)] });
  }
  const now = await currentChainId(eth);
  if (now !== chain.id) {
    throw new Error(`the wallet is on chain ${now} after adding ${chainLabel(network)}; switch to chain ${chain.id} and try again`);
  }
}

// Ask the wallet for an account and land on the selected chain. Returns the
// address the copier will trade from. Every call prompts the wallet, so a
// caller that already holds an address should not need this; sendExecOrder
// reuses it only because it cannot be handed an account without widening its
// signature.
export async function connect(network: Network = "testnet"): Promise<Address> {
  const eth = injectedProvider();
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("the wallet returned no accounts; unlock it and approve the connection");
  }
  await ensureNetwork(eth, network);
  return accounts[0];
}

// Hand execOrder calldata to the copier's own wallet and return the hash it
// broadcast. The wallet does the signing; this function never sees a key.
//
// The account and chain are resolved first, so the signature is requested only
// once the order can actually land: viem's sendTransaction also re-reads
// eth_chainId and refuses to send from a wallet that moved off the selected
// chain between this call and the signature prompt. That check is a pre-flight
// read, not an atomic one, because viem does not put chainId in the
// eth_sendTransaction params, so the wallet cannot reject a chain switch made
// while its own prompt is open. The order is a plain swap in that prompt and
// the copier can see and refuse it. Returns a hash the caller must still wait
// on for a receipt before claiming the position was opened.
// Perpl batches estimated against the pre-block state ran out of gas once
// earlier transactions in the same block changed the book (testnet tx
// 0xf57665e0, gasUsed == gasLimit). Orders go out with 1.5x the estimate.
export function padGas(estimate: bigint): bigint {
  return (estimate * 3n) / 2n;
}

export async function sendExecOrder(exchange: Address, data: Hex, network: Network = "testnet"): Promise<Hex> {
  const account = await connect(network);
  const eth = injectedProvider();
  const client = createWalletClient({ account, chain: chainFor(network), transport: custom(eth) });
  const estimate = BigInt(await eth.request({ method: "eth_estimateGas", params: [{ from: account, to: exchange, data }] }));
  return client.sendTransaction({ account, to: exchange, data, gas: padGas(estimate) });
}

// Passkey sibling of sendExecOrder: same execOrder calldata, but signed by a
// Mera passkey LocalAccount (lib/passkey.ts) instead of an injected wallet.
// The client points at that network's public RPC literally, never at the
// server-only MONAD_RPC_URL, so this stays callable from browser code. Returns
// the broadcast hash; the caller must still wait on a receipt before claiming
// the position opened.
export async function sendExecOrderWith(
  account: LocalAccount,
  exchange: Address,
  data: Hex,
  network: Network = "testnet",
): Promise<Hex> {
  const client = createWalletClient({ account, chain: chainFor(network), transport: http(NETWORKS[network].rpc) });
  return client.sendTransaction({ account, to: exchange, data, gas: padGas(await publicClient(network).estimateGas({ account: account.address, to: exchange, data })) });
}
