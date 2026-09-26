"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { Friend } from "@/lib/chart";
import { shortName } from "@/lib/chart";
import { decodeSuggestion, encodeCloseOrder, sizeToLots, toCloseOrder, type Suggestion } from "@/lib/suggest";
import type { Position } from "@/lib/readPosition";
import { NETWORKS } from "@/lib/perpl";
import { connect, sendExecOrder } from "@/lib/wallet";
import { acceptOwnerCheck, evaluateSuggestion } from "@/lib/acceptance";

type AcceptState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; hash: string }
  | { kind: "error"; message: string };

const MONAD_VISION = "https://monadvision.com/tx";

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
  priceDecimals,
  lotDecimals,
  onSuggestion,
}: {
  friends: Friend[];
  roomReady: boolean;
  marketId: number;
  priceDecimals: number;
  lotDecimals: number;
  onSuggestion?: (s: Suggestion | null) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });

  useEffect(() => {
    setRaw(readRawParam());
    setSeen(true);
  }, []);

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
      });
    } catch {
      return { status: "malformed" as const, reason: "That suggestion link is malformed and cannot be opened." };
    }
  }, [seen, raw, friends, marketId, priceDecimals, lotDecimals]);

  const validSuggestion = evaluated && evaluated.status === "valid" ? evaluated.suggestion : null;

  useEffect(() => {
    onSuggestion?.(validSuggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSuggestion?.owner, validSuggestion?.price, validSuggestion?.market, validSuggestion?.from]);

  if (!seen || raw === null || dismissed || evaluated === null) return null;

  function dismiss() {
    setDismissed(true);
    setAccept({ kind: "idle" });
    removeParam();
    onSuggestion?.(null);
  }

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
        <p className="num border border-rule bg-[var(--surface)] px-3 py-2 text-[12px] text-muted" role="status">
          Reading the suggested position from the Exchange contract
        </p>
      );
    }
  }

  if (evaluated.status === "malformed" || evaluated.status === "stale") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border border-rule bg-[var(--surface)] px-3 py-2">
        <p className="text-[12px] text-muted">{evaluated.reason}</p>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-[6px] border border-ink px-3 py-1.5 text-[12px] font-medium hover:bg-rule active:scale-[0.97]"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (evaluated.status === "empty") return null;

  const suggestion = evaluated.suggestion;
  const ownerFriend = friends.find((x) => x.account.toLowerCase() === suggestion.owner.toLowerCase()) ?? null;

  async function doAccept() {
    if (!ownerFriend) return;
    setAccept({ kind: "sending" });
    try {
      const connected = await connect();
      const gate = acceptOwnerCheck(connected, suggestion);
      if (!gate.ok) {
        setAccept({ kind: "error", message: gate.reason });
        return;
      }
      const fullSizeLots = sizeToLots(ownerFriend.size, lotDecimals);
      if (fullSizeLots <= 0n) {
        setAccept({ kind: "error", message: "The owner position is under one whole lot, so there is nothing to close." });
        return;
      }
      const order = toCloseOrder(
        { ...suggestion, sizeLots: undefined },
        { priceDecimals: BigInt(priceDecimals), lotDecimals: BigInt(lotDecimals) },
        { fullSizeLots },
      );
      const data = encodeCloseOrder(order);
      const hash = await sendExecOrder(NETWORKS.mainnet.exchange, data);
      setAccept({ kind: "ok", hash });
    } catch (e) {
      setAccept({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="border border-ink bg-[var(--surface)] px-3 py-2.5" role="status" aria-label={`Suggestion from ${shortName(suggestion.from)}`}>
      <p className="num text-[13px]">
        {evaluated.text} <span className="text-muted">PnL from the room position.</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={doAccept}
          disabled={accept.kind === "sending"}
          className="rounded-[6px] bg-ink px-3 py-1.5 text-[13px] font-medium text-surface active:scale-[0.97] disabled:opacity-40"
        >
          {accept.kind === "sending" ? "Waiting for wallet" : "Accept"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-[6px] border border-ink px-3 py-1.5 text-[13px] font-medium hover:bg-rule active:scale-[0.97]"
        >
          Dismiss
        </button>
        {accept.kind === "ok" && (
          <p className="num break-all text-[12px]" style={{ color: "var(--gain)" }}>
            Sent.{" "}
            <a className="underline" href={`${MONAD_VISION}/${accept.hash}`} target="_blank" rel="noreferrer">
              View on MonadVision
            </a>
          </p>
        )}
        {accept.kind === "error" && <p className="text-[12px] text-[var(--loss)]">{accept.message}</p>}
      </div>
    </div>
  );
}
