"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartRoom } from "@/app/ChartRoom";
import {
  DEMO_CY_DELEGATED_PROXY,
  DEMO_NAMES_QUERY,
  DEMO_ROOM_CODE,
  DEMO_STEPS,
  DEMO_WALLETS,
  demoNames,
  demoRoomAccounts,
  type DemoRole,
} from "@/lib/demoLoop";
import { writeDelegatedProxyToRegistry } from "@/lib/delegated";
import { encodeCallsParam } from "@/lib/receipts";
import { ogImagePath } from "@/lib/ogcard";

export function DemoShell() {
  const [role, setRole] = useState<DemoRole>("bo");
  const [suggestionNonce, setSuggestionNonce] = useState(0);
  const [callHashes, setCallHashes] = useState<string[]>([]);
  const [step, setStep] = useState(1);

  useEffect(() => {
    writeDelegatedProxyToRegistry("testnet", DEMO_WALLETS.cy, DEMO_CY_DELEGATED_PROXY);
  }, []);

  const viewerAddress = role === "bo" ? DEMO_WALLETS.bo : undefined;

  const shareCardPath = useMemo(() => {
    const c = encodeCallsParam(callHashes);
    return ogImagePath(DEMO_ROOM_CODE, "testnet", DEMO_NAMES_QUERY, c || undefined);
  }, [callHashes]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 pb-8 pt-4">
      <header className="rounded-[10px] border border-edge bg-panel px-4 py-3">
        <p className="font-[family-name:var(--font-display)] text-[18px] font-bold">Track 03 demo loop</p>
        <p className="mt-1 text-[13px] text-muted">
          Two wallets, one chart: drag a TP, send the call in-app, accept on Perpl, then share the card.
        </p>
        <ol className="mt-3 space-y-1 text-[13px]">
          {DEMO_STEPS.map((text, i) => (
            <li key={text} className={i + 1 === step ? "text-ink" : "text-muted"}>
              <span className="num mr-2 font-medium">{i + 1}.</span>
              {text}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">You are</span>
          {(["bo", "cy"] as const).map((r) => (
            <button
              key={r}
              type="button"
              data-demo-role={r}
              aria-pressed={role === r}
              onClick={() => {
                setRole(r);
                if (r === "bo") setStep((s) => Math.max(s, 4));
              }}
              className={`min-h-[44px] rounded-[6px] px-3 py-1.5 text-[13px] font-medium sm:min-h-0 ${
                role === r ? "bg-accent text-page" : "border border-edge hover:bg-raised"
              }`}
            >
              {r} ({r === "bo" ? "suggests · operator Accept" : "owner · allowlist sync"})
            </button>
          ))}
        </div>
      </header>

      <ChartRoom
        demoSurface
        initialAccounts={demoRoomAccounts}
        initialNames={demoNames}
        initialCalls={callHashes}
        initialView="frens"
        initialNet="testnet"
        viewerAddress={viewerAddress}
        suggestionNonce={suggestionNonce}
        onDemoStep={(n) => setStep((s) => Math.max(s, n))}
        onDemoCallAccepted={(hash) => {
          setCallHashes((prev) => (prev.some((h) => h.toLowerCase() === hash.toLowerCase()) ? prev : [...prev, hash]));
          setStep(5);
        }}
        onDemoSuggestionDelivered={() => {
          setSuggestionNonce((n) => n + 1);
          setRole("bo");
          setStep(4);
        }}
      />

      <section
        aria-label="Share card preview"
        className="rounded-[10px] border border-edge bg-panel px-4 py-3"
        data-demo-share-card
      >
        <h2 className="font-[family-name:var(--font-display)] text-[16px] font-bold">Share card</h2>
        <p className="mt-1 text-[13px] text-muted">
          FOMO wins on visuals. This 1200×630 card is what posts to X after a taken call.
        </p>
        <div className="mt-3 overflow-hidden rounded-[8px] border border-edge">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shareCardPath}
            alt="frens room share card with bo and cy PnL"
            className="h-auto w-full max-w-[720px]"
          />
        </div>
        {callHashes[0] && (
          <p className="num mt-2 break-all text-[12px] text-ink" data-demo-accept-tx>
            Accept tx {callHashes[0]}
          </p>
        )}
        <p className="num mt-2 break-all text-[12px] text-muted">{shareCardPath}</p>
      </section>
    </div>
  );
}
