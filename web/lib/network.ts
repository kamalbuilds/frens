/// Network selection: the whole app runs on one Perpl deployment at a time.
/// The network comes from the URL (?net=mainnet or ?net=testnet, default
/// testnet) and every API route, wallet call and room link follows it.
/// Everything stays real on-chain; testnet is Perpl's Monad testnet
/// deployment, never a mock.
import { NETWORKS, type Network } from "./perpl";

export type { Network };

export const DEFAULT_NETWORK: Network = "testnet";

export const API_BASES: Record<Network, string> = {
  mainnet: "https://app.perpl.xyz/api/v1",
  testnet: "https://testnet.perpl.xyz/api/v1",
};

/// Anything that is not exactly "mainnet" is testnet, so a missing, empty or
/// misspelled ?net= lands on the default instead of breaking the page.
export function parseNet(value: unknown): Network {
  return typeof value === "string" && value.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

/// Read ?net= off a URLSearchParams, a raw search string ("?net=mainnet") or
/// a bare value. Anything unparseable is testnet.
export function parseNetParam(
  params: { get: (key: string) => string | null } | string | null | undefined,
): Network {
  if (params === null || params === undefined) return DEFAULT_NETWORK;
  if (typeof params === "string") {
    try {
      return parseNet(new URLSearchParams(params.replace(/^[?#]/, "")).get("net"));
    } catch {
      return DEFAULT_NETWORK;
    }
  }
  try {
    return parseNet(params.get("net"));
  } catch {
    return DEFAULT_NETWORK;
  }
}

export type NetworkConfig = {
  chainId: number;
  exchange: (typeof NETWORKS)[Network]["exchange"];
  collateral: (typeof NETWORKS)[Network]["collateral"];
  markets: readonly number[];
  rpc: string;
  apiBase: string;
};

/// The per-network config the routes and the client build from: exchange,
/// collateral, markets and chain id out of perpl.ts plus the matching Perpl
/// public API base.
export function configFor(network: Network): NetworkConfig {
  const n = NETWORKS[network];
  return {
    chainId: n.chainId,
    exchange: n.exchange,
    collateral: n.collateral,
    markets: n.markets,
    rpc: n.rpc,
    apiBase: API_BASES[network],
  };
}

/// Block explorer transaction base per network: MonadVision only indexes
/// mainnet, so testnet receipts link to the testnet explorer instead.
export const EXPLORER_TX: Record<Network, string> = {
  mainnet: "https://monadvision.com/tx",
  testnet: "https://testnet.monadexplorer.com/tx",
};

export function explorerTxUrl(network: Network, hash: string): string {
  return `${EXPLORER_TX[network]}/${hash}`;
}

/// Room links keep the network: /r/<room>?net=<net> so a shared room opens on
/// the deployment its positions were read from.
export function roomLink(code: string, network: Network): string {
  return `/r/${code}?net=${network}`;
}

/// Set ?net= on a path or URL while preserving every other query param and
/// hash, so switching networks never drops a suggestion link or room code.
export function withNetParam(path: string, network: Network): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const bare = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = bare.indexOf("?");
  const pathname = queryAt >= 0 ? bare.slice(0, queryAt) : bare;
  const query = queryAt >= 0 ? bare.slice(queryAt + 1) : "";
  const params = new URLSearchParams(query);
  params.set("net", network);
  const next = params.toString();
  return `${pathname}${next ? `?${next}` : ""}${hash}`;
}
