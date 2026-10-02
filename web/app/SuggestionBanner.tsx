"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { formatPrice, type Friend } from "@/lib/chart";
import { acceptedPost, xPostUrl } from "@/lib/share";
import { nameForAddress, type NamesByAddress } from "@/lib/names";
import {
  ACCEPT_BATCH_SUPPORTED,
  buildAcceptOrders,
  decodeSuggestion,
  encodeAcceptBatch,
  encodeCloseOrder,
  encodeSuggestion,
  sizeToLots,
  toCloseOrder,
  TWO_SIGNATURE_NOTICE,
  type CloseOrderDesc,
  type Suggestion,
} from "@/lib/suggest";
import { findRestingCloses, type RestingClose } from "@/lib/resting";
import { buildCounterSuggestion } from "@/lib/ghost";
import type { Position } from "@/lib/readPosition";
import { NETWORKS, publicClient, type Network } from "@/lib/perpl";
import { explorerTxUrl } from "@/lib/network";
import { CALL_STAKE, stakeCalls } from "@/lib/callstake";
import { verifyCallReceipts } from "@/lib/receipts";

const STAKE_HOURS = 48;
import { connect, sendExecOrder, sendExecOrderWith } from "@/lib/wallet";
import { acceptOwnerCheck, alreadyTaken, evaluateSuggestion, replacementNotice } from "@/lib/acceptance";
import { PasskeyWallet } from "./PasskeyWallet";
import type { LocalAccount } from "viem";

type AcceptState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; hash: string; orderId: string }
  | { kind: "error"; message: string };

// Below 640px the banner prints under the chart as a strip: one line of
// copy, then the actions on a single wrapping row at a touch height. At
// 640px and up every button takes the roomy stacked layout back.
const STRIP_BTN =
  "min-h-[44px] shrink-0 rounded-[6px] px-2.5 py-1 text-[12px] font-medium active:scale-[0.97] sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-[13px]";

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
  roomShareLink,
  callHashes,
  acceptRequest,
  chartActions,
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
  /// Room link carrying the ?c= receipts, offered for sharing after Accept.
  roomShareLink?: string | null;
  /// The room's accepted-call receipts (?c=): resting TPs created through frens are found from these.
  callHashes?: readonly string[];
  acceptRequest?: number;
  /// The chart is drawing this call with its own Accept and Pass: the banner drops its duplicate buttons.
  chartActions?: boolean;
  passRequest?: number;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });
  const [counterCopied, setCounterCopied] = useState(false);
  const [roomCopied, setRoomCopied] = useState(false);
  const [passkey, setPasskey] = useState<LocalAccount | null>(null);
  const [passkeyFunded, setPasskeyFunded] = useState(false);
  const [resting, setResting] = useState<RestingClose[] | null>(null);
  const [twoSigs, setTwoSigs] = useState(false);

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

  // A fresh suggestion link resets the accept and counter state. Keyed on the link's payload, not on the
  // suggestion being valid: after Accept the room refreshes and the suggestion can briefly re-validate,
  // which must not wipe the "Accepted" receipt the acceptor is looking at.
  useEffect(() => {
    setAccept({ kind: "idle" });
    setCounterCopied(false);
    setRoomCopied(false);
    setResting(null);
    setTwoSigs(false);
    onAcceptedRef.current?.(null);
  }, [raw]);

  // Read the owner's resting closes for the banner line. Best effort: a
  // failed read leaves no replacing notice and Accept re-reads anyway.
  useEffect(() => {
    if (!suggestion) return;
    let live = true;
    setResting(null);
    findRestingCloses(network, publicClient(network), suggestion.owner, marketId, { knownTxs: (callHashes ?? []) as `0x${string}`[] })
      .then((all) => {
        if (!live || !suggestion) return;
        const want = suggestion.side === "long" ? "close-long" : "close-short";
        setResting(all.filter((r) => r.side === want));
      })
      .catch(() => {
        if (live) setResting([]);
      });
    return () => {
      live = false;
    };
  }, [suggestion?.owner, suggestion?.market, suggestion?.side, marketId, network]);

  function pass() {
    setDismissed(true);
    setAccept({ kind: "idle" });
    setCounterCopied(false);
    onAcceptedRef.current?.(null);
    removeParam();
    onSuggestionRef.current?.(null);
  }

  // Order id of the close order built by buildCloseOrder, read back by the
  // accept wrappers below so both wallet paths report the same receipt.
  const lastCloseOrderId = useRef("");

  function buildCloseOrder(): CloseOrderDesc {
    if (!suggestion || !ownerFriend) throw new Error("that suggestion is no longer open");
    const fullSizeLots = sizeToLots(ownerFriend.size, lotDecimals);
    if (fullSizeLots <= 0n) {
      throw new Error("The owner position is under one whole lot, so there is nothing to close.");
    }
    return toCloseOrder(
      { ...suggestion, sizeLots: undefined },
      { priceDecimals: BigInt(priceDecimals), lotDecimals: BigInt(lotDecimals) },
      { fullSizeLots },
    );
  }

  function matchingSide(r: RestingClose): boolean {
    if (!suggestion) return false;
    return suggestion.side === "long" ? r.side === "close-long" : r.side === "close-short";
  }

  // Shared Accept body: cancel the owner's resting closes for this position
  // and place the new close. With the batch entrypoint this is one signature
  // ([CANCEL..., close] via execOrders); without it the cancels go first and
  // the banner says so. The send callback is the only wallet-specific part.
  async function acceptWith(broadcast: (data: Hex) => Promise<string>) {
    if (!suggestion || !ownerFriend) return;
    // Accepted means mined and successful, not broadcast: a reverted close must not read as taken.
    const send = async (data: Hex) => {
      const hash = (await broadcast(data)) as Hex;
      const r = await publicClient(network).waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (r.status !== "success") throw new Error(`The order reverted on Perpl (tx ${hash.slice(0, 10)}…).`);
      return hash;
    };
    setAccept({ kind: "sending" });
    setTwoSigs(false);
    const close = buildCloseOrder();
    let restingNow: RestingClose[] = [];
    try {
      restingNow = (await findRestingCloses(network, publicClient(network), suggestion.owner, marketId, { knownTxs: (callHashes ?? []) as `0x${string}`[] })).filter(matchingSide);
    } catch {
      restingNow = [];
    }
    const orders = buildAcceptOrders(
      close,
      restingNow.map((r) => r.orderId),
    );
    try {
      if (orders.length === 1) {
        const hash = await send(encodeCloseOrder(orders[0] as CloseOrderDesc));
        const orderId = (orders[0] as CloseOrderDesc).orderDescId.toString();
        lastCloseOrderId.current = orderId;
        setResting(restingNow);
        setAccept({ kind: "ok", hash, orderId });
        onAcceptedRef.current?.({ orderId, hash });
        return;
      }
      if (ACCEPT_BATCH_SUPPORTED) {
        const hash = await send(encodeAcceptBatch(orders, true));
        const orderId = (orders[orders.length - 1] as CloseOrderDesc).orderDescId.toString();
        lastCloseOrderId.current = orderId;
        setResting(restingNow);
        setAccept({ kind: "ok", hash, orderId });
        onAcceptedRef.current?.({ orderId, hash });
        return;
      }
      for (const cancel of orders.slice(0, -1)) {
        await send(encodeCloseOrder(cancel));
      }
      const last = orders[orders.length - 1] as CloseOrderDesc;
      const hash = await send(encodeCloseOrder(last));
      const orderId = last.orderDescId.toString();
      lastCloseOrderId.current = orderId;
      setResting(restingNow);
      setTwoSigs(true);
      setAccept({ kind: "ok", hash, orderId });
      onAcceptedRef.current?.({ orderId, hash });
    } catch (e) {
      setAccept({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Backing a taken call with a CallStake (testnet): the same signer that accepted stakes aUSD that pays the caller
  // only if Perpl's mark reaches the TP before expiry, and returns to the owner otherwise.
  const acceptedWith = useRef<"wallet" | "passkey">("wallet");
  const [stakeAmt, setStakeAmt] = useState("2");
  const [stakeRes, setStakeRes] = useState<{ kind: "idle" | "sending" } | { kind: "ok"; hash: string; expiry: number } | { kind: "error"; message: string }>({ kind: "idle" });
  async function doStake(acceptHash: string) {
    setStakeRes({ kind: "sending" });
    try {
      const [call] = await verifyCallReceipts(network, [acceptHash], publicClient(network));
      if (!call || call.orderId === null) throw new Error("The accepted order is not resting on Perpl any more, so there is nothing left to stake on.");
      const expiry = Math.floor(Date.now() / 1000) + STAKE_HOURS * 3600;
      let last = "";
      for (const tx of stakeCalls(network, { ...call, orderId: call.orderId }, Number(stakeAmt), expiry)) {
        const hash = (acceptedWith.current === "passkey" && passkey
          ? await sendExecOrderWith(passkey, tx.to, tx.data, network)
          : await sendExecOrder(tx.to, tx.data, network)) as Hex;
        const r = await publicClient(network).waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (r.status !== "success") throw new Error(`The stake reverted (tx ${hash.slice(0, 10)}…).`);
        last = hash;
      }
      setStakeRes({ kind: "ok", hash: last, expiry });
    } catch (e) {
      setStakeRes({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
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
      acceptedWith.current = "wallet";
      await acceptWith((data) => sendExecOrder(NETWORKS[network].exchange, data, network));
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
      const key = passkey;
      acceptedWith.current = "passkey";
      await acceptWith((data) => sendExecOrderWith(key, NETWORKS[network].exchange, data, network));
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
    acceptRef.current = passkey && passkeyFunded ? doAcceptWithPasskey : doAccept;
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

  // After Accept the room link carries the new ?c= receipt, so the next
  // opener sees the accepted call verified. The chart owns the hash list;
  // the banner only copies the link it is given.
  async function copyRoomLink() {
    if (!roomShareLink || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${roomShareLink}`);
      setRoomCopied(true);
      setTimeout(() => setRoomCopied(false), 2000);
    } catch {
      setRoomCopied(false);
    }
  }

  // The owner already took this call: tell the chart so the ghost shows it as accepted.
  const takenOrderId =
    suggestion && resting && accept.kind !== "ok"
      ? resting.find((r) => alreadyTaken([r], suggestion.price, priceDecimals))?.orderId.toString() ?? null
      : null;
  useEffect(() => {
    if (takenOrderId) onAcceptedRef.current?.({ orderId: takenOrderId, hash: "" });
  }, [takenOrderId]);

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
  const replacing = (resting ?? []).filter((r) =>
    suggestion.side === "long" ? r.side === "close-long" : r.side === "close-short",
  );
  const taken = takenOrderId !== null;
  const accepted = accept.kind === "ok" || taken;

  return (
    <div className="rounded-[10px] border border-edge bg-panel px-3 py-2 sm:py-2.5" role="status" aria-label={`Suggestion from ${nameFor(suggestion.from)}`}>
      <p className="num truncate text-[12px] sm:text-[13px] sm:whitespace-normal">
        {evaluated.text} <span className="hidden text-muted sm:inline">PnL from the room position.</span>
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:mt-2 sm:gap-2">
        {!accepted && chartActions && (
          <p className="order-1 text-[12px] text-muted sm:order-none sm:text-[13px]">Accept or pass on the chart.</p>
        )}
        {!accepted && !chartActions && (
          <div className="order-1 flex shrink-0 flex-wrap items-center gap-1.5 sm:order-none sm:gap-2">
            <button
              type="button"
              onClick={doAccept}
              disabled={accept.kind === "sending"}
              className={`${STRIP_BTN} bg-accent text-page disabled:opacity-40`}
            >
              {accept.kind === "sending" ? "Waiting for wallet" : "Use browser wallet"}
            </button>
            {passkey && passkeyFunded && (
              <button
                type="button"
                onClick={doAcceptWithPasskey}
                disabled={accept.kind === "sending"}
                className={`${STRIP_BTN} border border-edge hover:bg-raised disabled:opacity-40`}
              >
                {accept.kind === "sending" ? "Waiting for passkey" : "Accept with passkey"}
              </button>
            )}
          </div>
        )}
        {counterReady && !accepted && (
          <button
            type="button"
            onClick={sendCounter}
            className={`${STRIP_BTN} order-2 border border-edge hover:bg-raised sm:order-none`}
          >
            {counterCopied ? "Copied" : "Send counter link"}
          </button>
        )}
        {!chartActions && (
          <button
            type="button"
            onClick={pass}
            className={`${STRIP_BTN} order-3 border border-edge hover:bg-raised sm:order-none`}
          >
            Pass
          </button>
        )}
        {replacing.length > 0 && !accepted && (
          <p className="num order-4 basis-full text-[12px] text-muted sm:order-none sm:basis-auto sm:mt-1">
            {replacementNotice(replacing[0]!.price, priceDecimals, nameFor(suggestion.owner))}
            {replacing.length > 1 ? ` (+${replacing.length - 1} more)` : ""}
            {!ACCEPT_BATCH_SUPPORTED ? ` · ${TWO_SIGNATURE_NOTICE}` : ""}
          </p>
        )}
        {!accepted && (
          <div className="order-5 w-full shrink-0 sm:order-none sm:w-auto">
            <div className="max-w-[320px]">
              <PasskeyWallet account={passkey} onAccount={setPasskey} onFunded={setPasskeyFunded} idPrefix="suggest" network={network} />
            </div>
          </div>
        )}
        {taken && (
          <p data-already-taken className="num order-4 basis-full text-[12px] text-gain sm:order-none sm:basis-auto sm:mt-1">
            {nameFor(suggestion.owner)} took this call · TP resting at {formatPrice(suggestion.price, priceDecimals)}
          </p>
        )}
        {accept.kind === "ok" && (
          <p className="num order-6 w-full shrink-0 break-all text-[12px] text-gain sm:order-none sm:w-auto sm:mt-2">
            Accepted · your TP is resting on Perpl ·{" "}
            <a className="underline" href={explorerTxUrl(network, accept.hash)} target="_blank" rel="noreferrer">
              View on the {network === "mainnet" ? "MonadVision" : "testnet"} explorer
            </a>
            {twoSigs ? ` · ${TWO_SIGNATURE_NOTICE}` : ""}
          </p>
        )}
        {accept.kind === "ok" && CALL_STAKE[network] && (
          <div data-stake className="order-6 flex w-full flex-wrap items-center gap-2 text-[12px] sm:order-none">
            {stakeRes.kind === "ok" ? (
              <p className="num text-gain">
                {stakeAmt} aUSD staked: paid to {nameFor(suggestion.from)} only if the price reaches {formatPrice(suggestion.price, priceDecimals)} by{" "}
                {new Date(stakeRes.expiry * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })},
                back to you otherwise.{" "}
                <a className="underline" href={explorerTxUrl(network, stakeRes.hash)} target="_blank" rel="noreferrer">tx</a>
              </p>
            ) : (
              <>
                <span>Back {nameFor(suggestion.from)}&apos;s call: they earn it only if the price gets there.</span>
                <input
                  value={stakeAmt}
                  onChange={(e) => setStakeAmt(e.target.value)}
                  inputMode="decimal"
                  aria-label="Stake in aUSD"
                  className="num w-14 rounded-[6px] border border-edge bg-panel px-2 py-1"
                />
                <button
                  type="button"
                  onClick={() => doStake(accept.hash)}
                  disabled={stakeRes.kind === "sending"}
                  className={`${STRIP_BTN} bg-accent text-page disabled:opacity-40`}
                >
                  {stakeRes.kind === "sending" ? "Staking" : `Stake ${stakeAmt} aUSD`}
                </button>
                {stakeRes.kind === "error" && <span className="text-loss">{stakeRes.message}</span>}
              </>
            )}
          </div>
        )}
        {accept.kind === "ok" && roomShareLink && (
          <button
            type="button"
            onClick={copyRoomLink}
            className={`${STRIP_BTN} order-7 w-full border border-edge hover:bg-raised sm:order-none sm:w-auto sm:self-start`}
          >
            {roomCopied ? "Copied" : "Copy room link"}
          </button>
        )}
        {accept.kind === "ok" && roomShareLink && (
          <button
            type="button"
            data-share="x-accepted"
            onClick={() =>
              window.open(
                xPostUrl(acceptedPost(nameFor(suggestion.from), formatPrice(suggestion.price, priceDecimals)), `${window.location.origin}${roomShareLink}`),
                "_blank",
                "noopener",
              )
            }
            className={`${STRIP_BTN} order-7 w-full border border-edge hover:bg-raised sm:order-none sm:w-auto sm:self-start`}
          >
            Post on X
          </button>
        )}
        {accept.kind === "error" && (
          <p className="order-8 w-full shrink-0 text-[12px] text-loss sm:order-none sm:w-auto">{accept.message}</p>
        )}
      </div>
    </div>
  );
}
