"use client";

import { useEffect, useState } from "react";
import { formatEther, formatUnits, type Address, type LocalAccount } from "viem";
import { COLLATERAL_DECIMALS, NETWORKS, publicClient, type Network } from "@/lib/perpl";
import { createPasskeyAccount, signInWithPasskey } from "@/lib/passkey";

// Minimal ERC-20 read surface for the aUSD balance.
const erc20BalanceAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

type Balances = { mon: bigint; ausd: bigint };

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Mera wraps the browser's WebAuthn error in `cause`; that is the part that says what went wrong.
function messageOf(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  return cause instanceof Error && cause.message && cause.message !== e.message ? `${e.message}: ${cause.message}` : e.message;
}

// Shared passkey sign-in panel: "Use a passkey" next to the existing browser
// wallet button, a create flow for first-time traders, and, once signed in,
// the derived address with copy affordance plus MON and aUSD balances read
// with the public client. The account stays in memory only: the parent holds
// the LocalAccount, this panel never persists it, and the seed phrase is
// never shown anywhere in the flow.
export function PasskeyWallet({
  account,
  onAccount,
  onFunded,
  idPrefix,
  network,
}: {
  account: LocalAccount | null;
  onAccount: (account: LocalAccount | null) => void;
  onFunded: (funded: boolean) => void;
  idPrefix: string;
  network: Network;
}) {
  const [busy, setBusy] = useState<"idle" | "signing" | "creating">("idle");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [balances, setBalances] = useState<Balances | null>(null);
  const [balancesError, setBalancesError] = useState("");
  const [copied, setCopied] = useState(false);

  const address = account?.address ?? null;
  const chainName = network === "mainnet" ? "Monad mainnet" : "Monad testnet";

  // Balances follow the signed-in address. Funded flips true only on a loaded
  // nonzero MON balance, so the parent offers the passkey send only when gas
  // money is actually there.
  useEffect(() => {
    if (!address) {
      setBalances(null);
      setBalancesError("");
      onFunded(false);
      return;
    }
    let live = true;
    setBalances(null);
    setBalancesError("");
    onFunded(false);
    const client = publicClient(network);
    const read = () =>
      Promise.all([
        client.getBalance({ address }),
        client.readContract({
          address: NETWORKS[network].collateral,
          abi: erc20BalanceAbi,
          functionName: "balanceOf",
          args: [address],
        }),
      ])
        .then(([mon, ausd]) => {
          if (!live) return;
          setBalances({ mon, ausd: ausd as bigint });
          setBalancesError("");
          onFunded(mon > 0n);
        })
        .catch((e) => {
          if (!live) return;
          setBalancesError(`Could not read balances: ${messageOf(e)}`);
          onFunded(false);
        });
    void read();
    // Funds sent after sign-in show up without signing in again.
    const timer = setInterval(read, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, network]);

  async function doSignIn() {
    setBusy("signing");
    setError("");
    try {
      const { account: next } = await signInWithPasskey();
      setShowCreate(false);
      onAccount(next);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("idle");
    }
  }

  async function doCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy("creating");
    setError("");
    try {
      const { account: next } = await createPasskeyAccount(name);
      setShowCreate(false);
      setName("");
      onAccount(next);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("idle");
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function signOut() {
    setError("");
    setShowCreate(false);
    onAccount(null);
  }

  if (!account || !address) {
    return (
      <div className="flex flex-col gap-1.5">
        {!showCreate ? (
          <>
            <button
              type="button"
              onClick={doSignIn}
              disabled={busy !== "idle"}
                className="rounded-[6px] border border-edge px-3 py-2 text-[13px] font-medium hover:bg-raised active:scale-[0.97] disabled:opacity-40"
            >
              {busy === "signing" ? "Waiting for passkey" : "Use a passkey"}
            </button>
            <p className="text-[12px] text-muted">Works in Chrome and Safari.</p>
            {error && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[12px] text-loss">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setShowCreate(true);
                  }}
                  className="self-start text-[12px] font-medium text-accent underline underline-offset-2"
                >
                  New here? Create a passkey instead
                </button>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={doCreate} className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-passkey-name`} className="text-[12px] font-medium">
              Name for this passkey
            </label>
            <input
              id={`${idPrefix}-passkey-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="trader"
              autoComplete="off"
              spellCheck={false}
              className="num w-full rounded-[6px] border border-edge bg-page px-2.5 py-2 text-[12px]"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy !== "idle"}
              className="rounded-[6px] border border-edge px-3 py-2 text-[13px] font-medium hover:bg-raised active:scale-[0.97] disabled:opacity-40"
              >
                {busy === "creating" ? "Waiting for passkey" : "Create a passkey"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setError("");
                }}
                className="rounded-[6px] px-3 py-2 text-[13px] font-medium text-muted hover:text-ink"
              >
                Back to sign in
              </button>
            </div>
            <p className="text-[12px] text-muted">Works in Chrome and Safari.</p>
            {error && <p className="text-[12px] text-loss">{error}</p>}
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-edge bg-page px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="num text-[12px] font-medium" title={address}>
          {shortAddress(address)}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyAddress}
            aria-label={`Copy passkey address ${address}`}
            className="rounded-[6px] border border-edge px-2 py-1 text-[12px] font-medium text-muted hover:text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="text-[12px] font-medium text-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </div>
      {balances ? (
        <div className="flex flex-col gap-0.5">
          <p className="num text-[12px] text-muted">
            MON {formatEther(balances.mon)} · aUSD {formatUnits(balances.ausd, COLLATERAL_DECIMALS)}
          </p>
          <p className="text-[11px] text-muted">Balances from {chainName}.</p>
        </div>
      ) : balancesError ? (
        <p className="text-[12px] text-loss">{balancesError}</p>
      ) : (
        <p className="text-[12px] text-muted">Reading balances from {chainName}</p>
      )}
      {balances && balances.mon === 0n && (
        <p className="text-[12px] font-medium">Send a little MON to this address to pay gas.</p>
      )}
    </div>
  );
}
