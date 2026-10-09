import type { Address, PublicClient } from "viem";
import { NETWORKS, type Network } from "./perpl";
import type { Suggestion } from "./suggest";
import {
  delegatedExecOrderAllowedForOperator,
  readDelegatedProxyFromRegistry,
  readIsDelegatedOperator,
  validateDelegatedProxyForOwner,
} from "./delegated";

export type AcceptExecTarget =
  | { ok: false; reason: string }
  | { ok: true; mode: "owner"; execTo: Address; positionAccount: Address }
  | { ok: true; mode: "operator"; execTo: Address; positionAccount: Address; delegatedProxy: Address };

export function acceptSignerCheck(
  connected: string | null | undefined,
  s: Suggestion,
  opts: { viaOperator: boolean },
  nameFor: (addr: string) => string = (a) => a.slice(0, 6),
): { ok: true; viaOperator: boolean } | { ok: false; reason: string } {
  if (!connected || connected.trim() === "") {
    return { ok: false, reason: "Connect a wallet to accept this." };
  }
  if (connected.trim().toLowerCase() === s.owner.toLowerCase()) {
    return { ok: true, viaOperator: false };
  }
  if (opts.viaOperator) {
    return { ok: true, viaOperator: true };
  }
  return { ok: false, reason: `Only ${nameFor(s.owner)} or their delegated operator can accept this.` };
}

export async function resolveAcceptExecTarget(
  network: Network,
  client: PublicClient,
  connected: Address,
  suggestion: Suggestion,
  registryProxy?: Address | null,
): Promise<AcceptExecTarget> {
  const exchange = NETWORKS[network].exchange;
  if (connected.toLowerCase() === suggestion.owner.toLowerCase()) {
    return { ok: true, mode: "owner", execTo: exchange, positionAccount: suggestion.owner };
  }

  const proxy = registryProxy ?? readDelegatedProxyFromRegistry(network, suggestion.owner);
  if (!proxy) {
    return {
      ok: false,
      reason: "Connect the owner wallet, or register their Perpl delegated account for operator accept.",
    };
  }

  const valid = await validateDelegatedProxyForOwner(client, network, suggestion.owner, proxy);
  if (!valid.ok) return valid;

  const isOp = await readIsDelegatedOperator(client, proxy, connected);
  if (!isOp) {
    return { ok: false, reason: "This wallet is not an operator on the owner's delegated account." };
  }

  if (!(await delegatedExecOrderAllowedForOperator(client, proxy))) {
    return {
      ok: false,
      reason:
        "The owner's delegated account still allows the old execOrder selector. The owner wallet must sync the operator allowlist once before a friend can accept.",
    };
  }

  return { ok: true, mode: "operator", execTo: proxy, positionAccount: proxy, delegatedProxy: proxy };
}
