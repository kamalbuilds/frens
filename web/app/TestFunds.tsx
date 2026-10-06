"use client";

// Testnet onboarding for a first-time wallet: MON for gas comes from Monad's faucet (a page the trader opens),
// then test aUSD comes from Agora's faucet in one transaction signed here. Renders nothing on mainnet or once the
// wallet holds enough aUSD to open a Perpl account.
import { useEffect, useState } from "react";
import { type Address, type Hex } from "viem";
import { FAUCET_AUSD, TESTNET_MON_FAUCET_URL, ausdBalance, faucetCall, minAccountOpen } from "@/lib/onboard";
import { publicClient, type Network } from "@/lib/perpl";

export function TestFunds({ network, address, send }: { network: Network; address: Address | null; send: (to: Address, data: Hex) => Promise<Hex> }) {
  const [bal, setBal] = useState<{ mon: bigint; ausd: bigint; floor: bigint } | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (network !== "testnet" || !address) return;
    let live = true;
    const read = async () => {
      const c = publicClient(network);
      const [mon, ausd, floor] = await Promise.all([c.getBalance({ address }), ausdBalance(c, network, address), minAccountOpen(c, network)]);
      if (live) setBal({ mon, ausd, floor });
    };
    read().catch(() => undefined);
    const id = setInterval(() => read().catch(() => undefined), 10_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [network, address, tick]);

  if (network !== "testnet" || !address || !bal || bal.ausd >= bal.floor) return null;

  async function getAusd() {
    if (!address) return;
    setState({ kind: "sending" });
    try {
      const call = faucetCall(network, address);
      const hash = await send(call.to, call.data);
      const r = await publicClient(network).waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (r.status !== "success") throw new Error(`The faucet transaction reverted (tx ${hash.slice(0, 10)}…).`);
      setState({ kind: "idle" });
      setTick((t) => t + 1);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div data-test-funds className="flex flex-col gap-1.5 rounded-[8px] border border-edge px-2.5 py-2 text-[12px]">
      {bal.mon === 0n ? (
        <>
          <p>
            Testnet trading is free. Get a little test MON for gas at{" "}
            <a className="underline" href={TESTNET_MON_FAUCET_URL} target="_blank" rel="noreferrer">
              faucet.monad.xyz
            </a>{" "}
            with this address, then come back for test aUSD.
          </p>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(address).then(() => setCopied(true))}
            className="self-start rounded-[6px] border border-edge px-2 py-1 font-medium text-muted hover:text-ink"
          >
            {copied ? "Address copied" : "Copy my address"}
          </button>
        </>
      ) : (
        <>
          <p>Perpl trades in aUSD. Get {FAUCET_AUSD.toLocaleString("en-US")} test aUSD for this wallet, free.</p>
          <button
            type="button"
            onClick={getAusd}
            disabled={state.kind === "sending"}
            className="self-start rounded-[6px] bg-accent px-3 py-1.5 font-medium text-page active:scale-[0.97] disabled:opacity-40"
          >
            {state.kind === "sending" ? "Getting test aUSD" : `Get ${FAUCET_AUSD.toLocaleString("en-US")} test aUSD`}
          </button>
        </>
      )}
      {state.kind === "error" && <p className="text-loss">{state.message}</p>}
    </div>
  );
}
