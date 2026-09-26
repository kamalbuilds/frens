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
import { createWalletClient, custom, toHex, type Address, type EIP1193Provider, type Hex } from "viem";
import { monad } from "viem/chains";
import { NETWORKS } from "./perpl";

// The Exchange address in perpl.ts exists only on Monad mainnet, so a wallet
// pointed anywhere else would send a real order into a chain with no market.
// viem's Monad definition must stay aligned with perpl.ts NETWORKS.mainnet or
// this fails loudly at import instead of signing to the wrong chain.
if (monad.id !== NETWORKS.mainnet.chainId) {
  throw new Error(
    `viem's Monad chain id ${monad.id} does not match perpl.ts ${NETWORKS.mainnet.chainId}`,
  );
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

function addChainParams() {
  return {
    chainId: toHex(monad.id),
    chainName: monad.name,
    nativeCurrency: monad.nativeCurrency,
    rpcUrls: [NETWORKS.mainnet.rpc],
    blockExplorerUrls: monad.blockExplorers?.default ? [monad.blockExplorers.default.url] : [],
  };
}

function chainIdOf(e: unknown): number | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

async function currentChainId(eth: InjectedProvider): Promise<number> {
  return Number(await eth.request({ method: "eth_chainId" }));
}

// Put the wallet on Monad mainnet, adding the chain first if the wallet has never
// heard of it. The chain id is re-read afterwards instead of assumed, because
// a wallet that accepted wallet_addEthereumChain but stayed on the old chain
// would otherwise sign an order against an RPC that cannot see the Exchange.
async function ensureMonad(eth: InjectedProvider): Promise<void> {
  if ((await currentChainId(eth)) === monad.id) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(monad.id) }] });
  } catch (e) {
    if (chainIdOf(e) !== CHAIN_NOT_ADDED) {
      throw new Error(`the wallet refused to switch to Monad mainnet (chain ${monad.id}): ${String(e)}`);
    }
    await eth.request({ method: "wallet_addEthereumChain", params: [addChainParams()] });
  }
  const now = await currentChainId(eth);
  if (now !== monad.id) {
    throw new Error(`the wallet is on chain ${now} after adding Monad mainnet; switch to chain ${monad.id} and try again`);
  }
}

// Ask the wallet for an account and land on Monad mainnet. Returns the address
// the copier will trade from. Every call prompts the wallet, so a caller that
// already holds an address should not need this; sendExecOrder reuses it only
// because it cannot be handed an account without widening its signature.
export async function connect(): Promise<Address> {
  const eth = injectedProvider();
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("the wallet returned no accounts; unlock it and approve the connection");
  }
  await ensureMonad(eth);
  return accounts[0];
}

// Hand execOrder calldata to the copier's own wallet and return the hash it
// broadcast. The wallet does the signing; this function never sees a key.
//
// The account and chain are resolved first, so the signature is requested only
// once the order can actually land: viem's sendTransaction also re-reads
// eth_chainId and refuses to send from a wallet that moved off Monad between
// this call and the signature prompt. That check is a pre-flight read, not an
// atomic one, because viem does not put chainId in the eth_sendTransaction
// params, so the wallet cannot reject a chain switch made while its own prompt
// is open. The order is a plain swap in that prompt and the copier can see and
// refuse it. Returns a hash the caller must still wait on for a receipt before
// claiming the position was opened.
export async function sendExecOrder(exchange: Address, data: Hex): Promise<Hex> {
  const account = await connect();
  const eth = injectedProvider();
  const client = createWalletClient({ account, chain: monad, transport: custom(eth) });
  return client.sendTransaction({ account, to: exchange, data });
}
