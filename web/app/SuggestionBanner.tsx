"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import type { Friend } from "@/lib/chart";
import { nameForAddress, type NamesByAddress } from "@/lib/names";
import { decodeSuggestion, encodeCloseOrder, encodeSuggestion, sizeToLots, toCloseOrder, type Suggestion } from "@/lib/suggest";
import { buildCounterSuggestion } from "@/lib/ghost";
import type { Position } from "@/lib/readPosition";
import { NETWORKS, type Network } from "@/lib/perpl";
import { explorerTxUrl } from "@/lib/network";
import { connect, sendExecOrder, sendExecOrderWith } from "@/lib/wallet";
import { acceptOwnerCheck, evaluateSuggestion } from "@/lib/acceptance";
import { PasskeyWallet } from "./PasskeyWallet";
import type { LocalAccount } from "viem";

type AcceptState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; hash: string; orderId: string }
  | { kind: "error"; message: string };

function readRawParam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("s");
    return s && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

function removeParam(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("s");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Dismiss still hides the banner even if the URL cannot be rewritten.
  }
}

function friendToPosition(f: Friend, marketId: number): Position {
  return {
    account: f.account as Address,
    accountId: 0n,
    market: marketId,
    symbol: "",
    side: f.side,
    size: f.size,
    entryPrice: f.entryPrice,
    markPrice: f.markPrice,
    markValid: true,
    deposit: 0,
    deltaPnl: 0,
    fundingPnl: f.fundingPnl,
    unrealizedPnl: f.unrealizedPnl,
    entryBlock: 0n,
    block: 0n,
  };
}

export function SuggestionBanner({
  friends,
  roomReady,
  marketId,
  network,
  priceDecimals,
  lotDecimals,
  names,
  onSuggestion,
  ghostPrice,
  onAcceptedChange,
  acceptRequest,
  passRequest,
}: {
  friends: Friend[];
  roomReady: boolean;
  marketId: number;
  network: Network;
  priceDecimals: number;
  lotDecimals: number;
  names?: NamesByAddress;
  onSuggestion?: (s: Suggestion | null) => void;
  ghostPrice?: number | null;
  onAcceptedChange?: (info: { orderId: string; hash: string } | null) => void;
  acceptRequest?: number;
  passRequest?: number;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });
  const [counterCopied, setCounterCopied] = useState(false);
  const [passkey, setPasskey] = useState<LocalAccount | null>(null);
  const [passkeyFunded, setPasskeyFunded] = useState(false);

  useEffect(() => {
    setRaw(readRawParam());
    setSeen(true);
  }, []);

  const nameFor = useMemo(() => nameForAddress(names), [names]);

  const evaluated = useMemo(() => {
    if (!seen || raw === null) return null;
    try {
      return evaluateSuggestion(raw, {
        positionFor: (s) => {
          const f = friends.find((x) => x.account.toLowerCase() === s.owner.toLowerCase());
          return f ? friendToPosition(f, marketId) : null;
        },
        priceDecimals,
        lotDecimals,
        nameFor,
      });
    } catch {
      return { status: "malformed" as const, reason: "That suggestion link is malformed and cannot be opened." };
    }
  }, [seen, raw, friends, marketId, priceDecimals, lotDecimals, nameFor]);

  const validSuggestion = evaluated && evaluated.status === "valid" ? evaluated.suggestion : null;
  const suggestion = evaluated && evaluated.status === "valid" ? evaluated.suggestion : null;
  const ownerFriend =
    suggestion !== null
      ? friends.find((x) => x.account.toLowerCase() === suggestion.owner.toLowerCase()) ?? null
      : null;

  // Latest-closure refs for the chart signal effects below. They are only
  // written inside the sync effect after the function declarations, never
  // during render.
  const onSuggestionRef = useRef(onSuggestion);
  const onAcceptedRef = useRef(onAcceptedChange);
  const passRef = useRef(pass);
  const acceptRef = useRef(doAccept);

  useEffect(() => {
    onSuggestionRef.current?.(validSuggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSuggestion?.owner, validSuggestion?.price, validSuggestion?.market, validSuggestion?.from]);

  // A fresh suggestion link resets the accept and counter state.
  useEffect(() => {
    setAccept({ kind: "idle" });
    setCounterCopied(false);
    onAcceptedRef.current?.(null);
  }, [validSuggestion?.owner, validSuggestion?.price, validSuggestion?.market, validSuggestion?.from]);

  function pass() {
    setDismissed(true);
    setAccept({ kind: "idle" });
    setCounterCopied(false);
    onAcceptedRef.current?.(null);
    removeParam();
    onSuggestionRef.current?.(null);
  }

  // Order id of the close order built by buildCloseOrderData, read back by the
  // accept wrappers below so both wallet paths report the same receipt.
  const lastCloseOrderId = useRef("");

  function buildCloseOrderData(): `0x${string}` {
    if (!suggestion || !ownerFriend) throw new Error("that suggestion is no longer open");
    const fullSizeLots = sizeToLots(ownerFriend.size, lotDecimals);
    if (fullSizeLots <= 0n) {
      throw new Error("The owner position is under one whole lot, so there is nothing to close.");
    }
    const order = toCloseOrder(
      { ...suggestion, sizeLots: undefined },
      { priceDecimals: BigInt(priceDecimals), lotDecimals: BigInt(lotDecimals) },
      { fullSizeLots },
    );
    lastCloseOrderId.current = order.orderDescId.toString();
    return encodeCloseOrder(order);
  }

  async function doAccept() {
    if (!suggestion || !ownerFriend) return;
    setAccept({ kind: "sending" });
    try {
      const connected = await connect(network);
      const gate = acceptOwnerCheck(connected, suggestion, nameFor);
      if (!gate.ok) {
        setAccept({ kind: "error", message: gate.reason });
        return;
      }
      const data = buildCloseOrderData();
      const hash = await sendExecOrder(NETWORKS[network].exchange, data, network);
      const orderId = lastCloseOrderId.current;
      setAccept({ kind: "ok", hash, orderId });
      onAcceptedRef.current?.({ orderId, hash });
    } catch (e) {
      setAccept({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Passkey sibling of doAccept: the same close order signed by the in-memory
  // passkey account. The owner gate still applies, so this succeeds when the
  // owner opens the link with the same passkey that holds the position.
  async function doAcceptWithPasskey() {
    if (!suggestion || !ownerFriend || !passkey) return;
    setAccept({ kind: "sending" });
    try {
      const gate = acceptOwnerCheck(passkey.address, suggestion, nameFor);
      if (!gate.ok) {
        setAccept({ kind: "error", message: gate.reason });
        return;
      }
      const data = buildCloseOrderData();
      const hash = await sendExecOrderWith(passkey, NETWORKS[network].exchange, data, network);
      const orderId = lastCloseOrderId.current;
      setAccept({ kind: "ok", hash, orderId });
      onAcceptedRef.current?.({ orderId, hash });
    } catch (e) {
      setAccept({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Sync the latest closures after every render so the signal effects below
  // always call fresh code.
  useEffect(() => {
    onSuggestionRef.current = onSuggestion;
    onAcceptedRef.current = onAcceptedChange;
    passRef.current = pass;
    acceptRef.current = doAccept;
  });

  // The chart's own ghost-line buttons resolve through the same flow: the
  // chart only sends a signal, the banner still owns the wallet call and the
  // URL param, so Accept stays one code path and Pass stays one code path.
  const lastAcceptReq = useRef(acceptRequest ?? 0);
  useEffect(() => {
    const req = acceptRequest ?? 0;
    if (req > lastAcceptReq.current) {
      lastAcceptReq.current = req;
      void acceptRef.current();
    } else {
      lastAcceptReq.current = req;
    }
  }, [acceptRequest]);

  const lastPassReq = useRef(passRequest ?? 0);
  useEffect(() => {
    const req = passRequest ?? 0;
    if (req > lastPassReq.current) {
      lastPassReq.current = req;
      passRef.current();
    } else {
      lastPassReq.current = req;
    }
  }, [passRequest]);

  async function sendCounter() {
    if (!suggestion || ghostPrice === null || ghostPrice === undefined) return;
    try {
      const counter = buildCounterSuggestion(suggestion, ghostPrice, Date.now());
      const payload = encodeSuggestion(counter);
      const path = typeof window !== "undefined" ? window.location.pathname : "/";
      const url = `${window.location.origin}${path}?s=${payload}&net=${network}`;
      await navigator.clipboard.writeText(url);
      setCounterCopied(true);
      setTimeout(() => setCounterCopied(false), 2000);
    } catch {
      setCounterCopied(false);
    }
  }

  if (!seen || raw === null || dismissed || evaluated === null) return null;

  // The link decoded but the room is still reading positions: do not call it
  // stale yet, or every shared link flashes a stale notice on load.
  if (evaluated.status !== "malformed" && evaluated.status !== "empty" && !roomReady) {
    let decodable = true;
    try {
      decodable = decodeSuggestion(raw) !== null;
    } catch {
      decodable = false;
    }
    if (decodable) {
      return (
        <p className="num rounded-[10px] border border-edge bg-panel px-3 py-2 text-[12px] text-muted" role="status">
          Reading the suggested position from the Exchange contract
        </p>
      );
    }
  }

  if (evaluated.status === "malformed" || evaluated.status === "stale") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-edge bg-panel px-3 py-2">
        <p className="text-[12px] text-muted">{evaluated.reason}</p>
        <button
          type="button"
          onClick={pass}
          className="rounded-[6px] border border-edge px-3 py-1.5 text-[12px] font-medium hover:bg-raised active:scale-[0.97]"
        >
          Pass
        </button>
      </div>
    );
  }

  if (evaluated.status === "empty" || suggestion === null) return null;

  const counterReady =
    ghostPrice !== null &&
    ghostPrice !== undefined &&
    Number.isFinite(ghostPrice) &&
    ghostPrice > 0 &&
    ghostPrice !== suggestion.price;
  const accepted = accept.kind === "ok";

  return (
    <div className="rounded-[10px] border border-edge bg-panel px-3 py-2.5" role="status" aria-label={`Suggestion from ${nameFor(suggestion.from)}`}>
      <p className="num text-[13px]">
        {evaluated.text} <span className="text-muted">PnL from the room position.</span>
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {!accepted && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={doAccept}
              disabled={accept.kind === "sending"}
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] font-medium text-page active:scale-[0.97] disabled:opacity-40"
            >
              {accept.kind === "sending" ? "Waiting for wallet" : "Use browser wallet"}
            </button>
            {passkey && passkeyFunded && (
              <button
                type="button"
                onClick={doAcceptWithPasskey}
                disabled={accept.kind === "sending"}
                className="rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-raised active:scale-[0.97] disabled:opacity-40"
              >
                {accept.kind === "sending" ? "Waiting for passkey" : "Accept with passkey"}
              </button>
            )}
          </div>
        )}
        {!accepted && (
          <div className="max-w-[320px]">
            <PasskeyWallet account={passkey} onAccount={setPasskey} onFunded={setPasskeyFunded} idPrefix="suggest" network={network} />
          </div>
        )}
        {counterReady && !accepted && (
          <button
            type="button"
            onClick={sendCounter}
            className="self-start rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-raised active:scale-[0.97]"
          >
            {counterCopied ? "Copied" : "Send counter link"}
          </button>
        )}
        <button
          type="button"
          onClick={pass}
          className="self-start rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-raised active:scale-[0.97]"
        >
          Pass
        </button>
        {accept.kind === "ok" && (
          <p className="num break-all text-[12px] text-gain">
            Accepted · order {accept.orderId}{" "}
            <a className="underline" href={explorerTxUrl(network, accept.hash)} target="_blank" rel="noreferrer">
              View on the {network === "mainnet" ? "MonadVision" : "testnet"} explorer
            </a>
          </p>
        )}
        {accept.kind === "error" && <p className="text-[12px] text-loss">{accept.message}</p>}
      </div>
    </div>
  );
}
