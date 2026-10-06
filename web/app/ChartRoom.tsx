"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { byPnl, candleChange, chipFor, entryLinePoints, formatPrice, formatUsd, placeAvatar, sideCounts, subtitleForMarket, visiblePriceRange, volumeColorFor, type Candle, type Friend } from "@/lib/chart";
import { FACE_SIZE, clusterFaces, ringColorFor } from "@/lib/faces";
import { shortMarketLabel } from "@/lib/mobile";
import { clampTpSl, initialTpSl, nudgePrice, pnlAtPrice, priceFromY, validTpSl, type SuggestKind } from "@/lib/drag";
import { encodeCopyOrder, toCopyOrder } from "@/lib/copy";
import { encodeRoom } from "@/lib/roomlink";
import { encodeSuggestion, type Suggestion } from "@/lib/suggest";
import { NETWORKS, type Network } from "@/lib/perpl";
import { explorerTxUrl, roomLink } from "@/lib/network";
import { callLine, displayName, encodeKeyedNames, namesForAddresses, sanitizeName } from "@/lib/names";
import { encodeCallsParam } from "@/lib/receipts";
import type { PricedCall } from "@/lib/receipts";
import { ghostLabelText, hexWithAlpha } from "@/lib/ghost";
import { callBoard } from "@/lib/callboard";
import { ausdBalance, depositCalls, hasPerplAccount, minAccountOpen, toAusdUnits } from "@/lib/onboard";
import { suggestionDescId } from "@/lib/callbook";
import { publicClient } from "@/lib/perpl";
import { ROOM_POST, telegramShareUrl, xPostUrl } from "@/lib/share";
import { connect as connectWallet, sendExecOrder, sendExecOrderWith } from "@/lib/wallet";
import { connect as connectMarketWs, mergeCandle } from "@/lib/marketws";
import { subscribeRoomFeed } from "@/lib/roomfeed";
import { SuggestionBanner } from "./SuggestionBanner";
import { PasskeyWallet } from "./PasskeyWallet";
import { TestFunds } from "./TestFunds";
import { RoomBuilder } from "./RoomBuilder";
import { Face } from "./Face";
import type { LocalAccount } from "viem";

type Market = { id: number; name: string; priceDecimals: number; lotDecimals: number };
type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const TIMEFRAMES = [
  { label: "15m", res: 900 },
  { label: "1h", res: 3600 },
  { label: "4h", res: 14400 },
  { label: "1d", res: 86400 },
];
// The seeded testnet room (products/chartroom/demo/ROOMS.md): four frens, verified call receipts, bo's call waiting.
const DEMO_ROOM = "/r/Bz9HWgDsVBcvOIZLErMuf0gWB-lOtmTx6bfIEt37xBGDJv4-I7fc7ZFCel3hZ-L8dpPOTw8HhKVpW2JEs3kPfrpr2HVxS77X4_nzA4cfDMw?net=testnet&n=b379:ana,9142:bo,4eb6:cy,073f:dee&c=0xc1581071d22d3192a27911a53191b083f166d6b99f4ce2aae95b8d1d1dd751a8,0x850e07e613a53298c1b65df48a477dd2e714b40d00a58e1c4fa68f43388bd2f0,0x4503ba27421f4da209534fc63faf6d1452029e6ac4a031e4b135ea4717a71ad3,0x3627b758d3c5d09f0b444aec37e2aba76227c210f0893ca4834a4b397b651585,0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a&s=WyIweDA3M2Y0NzVhMDBlYzU0MTcyZjM4ODY0YjEyYjMyZTdmNDgxNjA3ZTkiLDE2LCJzaG9ydCIsODM1OTYsbnVsbCwiMHg5MTQyN2E1ZGUxNjdFMkZjNzY5M0NlNEYwZjA3ODRBNTY5NWI2MjQ0IiwxNzkwOTA4MjY5OTQ1XQ";

const DEFAULT_MARKET: Record<Network, number> = { mainnet: 1, testnet: 16 };
// Bottom ~14% of the pane is the volume strip: bottom-pinned faces stack
// upward from just above it, never on top of it.
const VOL_STRIP_FRAC = 0.14;
// Edge-pinned faces stack with a 6px gap between 28px circles.
const EDGE_STEP = FACE_SIZE + 6;

type Overlay = {
  account: string;
  entryY: number;
  markY: number;
  bandLeft: number;
  bandTop: number;
  bandHeight: number;
  right: number;
  avatarX: number | null;
  avatarY: number;
  mode: "candle" | "top" | "bottom";
};

type Ohlc = { o: number; h: number; l: number; c: number; change: number; pct: number; time: number; volume: number };

type CopyResult =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; hash: string }
  | { kind: "needs-account"; signer: "wallet" | "passkey" }
  | { kind: "error"; message: string };

/// The chart library parses colours itself and rejects CSS color-mix(), so the
/// chart gets concrete hex values from the dark system: page #0A0A0F, muted
/// #8B8B9E, grid rgba(255,255,255,0.04), candles green #2BD67B and red
/// #FF6B57 with wicks in the same hue, brand accent #C8FF3D only for the
/// viewer's own price line.
const CHART = {
  page: "#0A0A0F",
  panel: "#13131A",
  raised: "#1B1B24",
  muted: "#8B8B9E",
  edge: "#26263A",
  grid: "rgba(255, 255, 255, 0.04)",
  ink: "#ECECF1",
  accent: "#C8FF3D",
  up: "#2BD67B",
  down: "#FF6B57",
};

/// The three tab groups are rendered twice: once inside the desktop header
/// and once as the compact rows below 640px. They live here so both copies
/// read the same list, the same aria labels and the same pressed state.
function NetworkToggle({
  net,
  onSwitch,
  compact = false,
}: {
  net: Network;
  onSwitch: (next: Network) => void;
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Network" className="flex shrink-0 rounded-[6px] border border-edge">
      {(["testnet", "mainnet"] as const).map((n) => (
        <button
          key={n}
          onClick={() => onSwitch(n)}
          aria-pressed={n === net}
          className={`${compact ? "min-h-[44px] px-2.5 text-[11px]" : "px-3 py-1.5 text-[12px]"} ${
            n === net ? "rounded-[6px] bg-raised text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {n === "testnet" ? "Testnet" : "Mainnet"}
        </button>
      ))}
    </div>
  );
}

/// Market tabs. Below 640px the strip scrolls sideways on one line and the
/// venue suffix is cut, so "BTC Perp" reads "BTC" and no tab wraps onto a
/// second row above the chart.
function MarketTabs({
  markets,
  marketId,
  onPick,
  compact = false,
}: {
  markets: Load<Market[]>;
  marketId: number;
  onPick: (id: number) => void;
  compact?: boolean;
}) {
  const off = "text-muted hover:text-ink";
  const on = "rounded-[6px] bg-raised text-ink";
  return (
    <div
      role="group"
      aria-label="Market"
      className={
        compact
          ? "flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain"
          : "flex rounded-[6px] border border-edge"
      }
    >
      {markets.state === "ready" &&
        markets.data.map((m) => (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            aria-pressed={m.id === marketId}
            className={`num ${compact ? "min-h-[44px] shrink-0 whitespace-nowrap px-2.5 text-[12px]" : "px-3 py-1.5 text-[12px]"} ${
              m.id === marketId ? on : off
            }`}
          >
            {compact ? shortMarketLabel(m.name) : m.name}
          </button>
        ))}
      {markets.state === "loading" && (
        <span className={`${compact ? "shrink-0" : ""} px-3 py-1.5 text-[12px] text-muted`}>loading markets</span>
      )}
      {markets.state === "error" && (
        <span className={`${compact ? "shrink-0" : ""} px-3 py-1.5 text-[12px] text-loss`}>{markets.message}</span>
      )}
    </div>
  );
}

function TimeframeTabs({
  res,
  onPick,
  compact = false,
}: {
  res: number;
  onPick: (res: number) => void;
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Timeframe" className="flex shrink-0 rounded-[6px] border border-edge">
      {TIMEFRAMES.map((t) => (
        <button
          key={t.res}
          onClick={() => onPick(t.res)}
          aria-pressed={t.res === res}
          className={`num shrink-0 ${
            compact
              ? `min-h-[44px] px-2 text-[11px] ${t.res === res ? "rounded-[6px] bg-raised text-ink" : "text-muted hover:text-ink"}`
              : `px-2.5 py-1.5 text-[12px] ${t.res === res ? "text-accent underline underline-offset-4" : "text-muted hover:text-ink"}`
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ChartRoom({
  initialAccounts,
  initialNames,
  initialCalls,
  viewerAddress,
  initialView,
  initialNet,
}: {
  initialAccounts?: string[];
  /// Nicknames from the room link (?n=), same order as initialAccounts.
  initialNames?: string[];
  /// Accepted-call transaction hashes from the room link (?c=).
  initialCalls?: string[];
  viewerAddress?: string;
  /// Room links (/r/<room>) open in the saved room; the bare URL defaults to
  /// the live Perpl view so faces sit on recent candles.
  initialView?: "live" | "frens";
  /// Network from the URL (?net=mainnet or ?net=testnet, default testnet),
  /// read server side from searchParams so the first paint is already on the
  /// right deployment.
  initialNet?: Network;
}) {
  const [net, setNet] = useState<Network>(initialNet ?? "testnet");
  const [markets, setMarkets] = useState<Load<Market[]>>({ state: "loading" });
  const [marketId, setMarketId] = useState<number>(() => DEFAULT_MARKET[initialNet ?? "testnet"]);
  // Rooms open on the 15m candles so recent entries sit on visible candles.
  const [res, setRes] = useState(900);
  const [candles, setCandles] = useState<Load<Candle[]>>({ state: "loading" });
  const [room, setRoom] = useState<Load<{ friends: Friend[]; block: string; checked: number }>>({ state: "loading" });
  const [view, setView] = useState<"live" | "frens">(initialView ?? "live");
  const [live, setLive] = useState<Load<{ traders: Friend[]; block: string; hours: number }>>({ state: "loading" });
  const [extra, setExtra] = useState<string[]>(initialAccounts ?? []);
  const [nameByAddr, setNameByAddr] = useState<Map<string, string>>(
    () => namesForAddresses(initialAccounts ?? [], initialNames ?? []),
  );
  const [draft, setDraft] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState("");
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [ohlc, setOhlc] = useState<Ohlc | null>(null);
  const [tp, setTp] = useState<number | null>(null);
  const [sl, setSl] = useState<number | null>(null);
  const [tpY, setTpY] = useState<number | null>(null);
  const [slY, setSlY] = useState<number | null>(null);
  const [focusKind, setFocusKind] = useState<SuggestKind | null>(null);
  const [suggestKind, setSuggestKind] = useState<SuggestKind>("tp");
  const [hoverLine, setHoverLine] = useState<SuggestKind | null>(null);
  const [viewer, setViewer] = useState(viewerAddress ?? "");
  const [viewerError, setViewerError] = useState("");
  const [copiedSuggest, setCopiedSuggest] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [copyFor, setCopyFor] = useState<string | null>(null);
  const [copySize, setCopySize] = useState("");
  const [copySlip, setCopySlip] = useState("50");
  const [copyResult, setCopyResult] = useState<CopyResult>({ kind: "idle" });
  const [passkey, setPasskey] = useState<LocalAccount | null>(null);
  const [passkeyFunded, setPasskeyFunded] = useState(false);
  const [incoming, setIncoming] = useState<Suggestion | null>(null);
  const [ghostPrice, setGhostPrice] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);
  const [ghostAccepted, setGhostAccepted] = useState<{ orderId: string; hash: string } | null>(null);
  const [hoverGhost, setHoverGhost] = useState(false);
  const [acceptReq, setAcceptReq] = useState(0);
  const [passReq, setPassReq] = useState(0);
  const [feedTick, setFeedTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const tpLine = useRef<IPriceLine | null>(null);
  const slLine = useRef<IPriceLine | null>(null);
  const sugLine = useRef<IPriceLine | null>(null);
  const takenLines = useRef<IPriceLine[]>([]);
  const roomKey = useRef("");
  const liveKey = useRef("");
  const dragging = useRef<SuggestKind | "ghost" | null>(null);

  const market = markets.state === "ready" ? markets.data.find((m) => m.id === marketId) : undefined;
  const EXCHANGE = NETWORKS[net].exchange;
  const chainName = net === "mainnet" ? "Monad mainnet" : "Monad testnet";
  // The market list belongs to the network: while the selected market is not
  // on this deployment the per-market fetches wait. The markets effect moves
  // the selection onto a listed market instead of erroring.
  const marketKnown = markets.state !== "ready" || markets.data.some((m) => m.id === marketId);
  const decimals = market?.priceDecimals ?? 2;
  const friends = useMemo(() => {
    if (view === "live") return byPnl(live.state === "ready" ? live.data.traders : []);
    return byPnl(room.state === "ready" ? room.data.friends : []);
  }, [room, live, view]);
  const ring = (f: Pick<Friend, "side">) => ringColorFor(f.side);
  const lastClose = candles.state === "ready" && candles.data.length ? candles.data[candles.data.length - 1].close : null;
  const counts = useMemo(() => sideCounts(friends), [friends]);
  const copyFriend = copyFor ? friends.find((f) => f.account === copyFor) ?? null : null;
  // The room shows nicknames instead of the 4-char address everywhere.
  const display = (addr: string) => displayName(addr, nameByAddr);
  // Accepted-call record per fren, keyed by network and address.
  const [callRecords, setCallRecords] = useState<Record<string, { accepted: number; hit: number }>>({});
  // Trustless call receipts from the room link (?c=): each hash verified
  // against its own transaction receipt, no log scanning.
  const [callHashes, setCallHashes] = useState<string[]>(() => initialCalls ?? []);
  const [receiptCalls, setReceiptCalls] = useState<(PricedCall & { hit?: boolean; resting?: boolean; stake?: { state: string; amount: number } | null })[]>([]);
  const recFor = (addr: string) => {
    const hyper = callRecords[`${net}:${addr.toLowerCase()}`] ?? null;
    if (hyper) return hyper;
    const mine = receiptCalls.filter((c) => c.caller.toLowerCase() === addr.toLowerCase());
    const n = mine.length;
    const h = mine.filter((c) => c.hit === true).length;
    return n > 0 ? { accepted: n, hit: h } : null;
  };
  const board = useMemo(() => callBoard(receiptCalls), [receiptCalls]);
  const accountsKey = useMemo(() => friends.map((f) => f.account.toLowerCase()).sort().join(","), [friends]);

  // The open suggestion link owns the ghost line. The banner decodes and
  // validates; the chart draws and drags. A fresh suggestion resets the
  // dragged price and the accepted receipt.
  // The accepted call survives the room refresh after Accept, which can briefly report no valid suggestion and then
  // the same one again; only a different call clears it.
  const acceptedCall = useRef<string | null>(null);
  const callKey = (s: Suggestion) => `${s.owner}|${s.market}|${s.price}|${s.from}|${s.createdAt}`.toLowerCase();
  function handleSuggestion(s: Suggestion | null) {
    setIncoming(s);
    setGhostPrice(s ? s.price : null);
    if (s && callKey(s) !== acceptedCall.current) {
      acceptedCall.current = null;
      setGhostAccepted(null);
    }
  }

  const ghostFriend = incoming
    ? friends.find((f) => f.account.toLowerCase() === incoming.owner.toLowerCase()) ?? null
    : null;
  const ghostPnl =
    ghostFriend && ghostPrice !== null
      ? pnlAtPrice(ghostPrice, ghostFriend.entryPrice, ghostFriend.size, ghostFriend.side)
      : 0;
  const ghostColour = incoming
    ? ghostAccepted !== null
      ? CHART.accent
      : hexWithAlpha(incoming.kind === "sl" ? CHART.down : CHART.up, 0.6)
    : CHART.muted;
  const ghostLabel =
    incoming && ghostPrice !== null
      ? ghostLabelText({ from: incoming.from, price: ghostPrice, pnl: ghostPnl, priceDecimals: decimals, nameFor: display, kind: incoming.kind })
      : "";

  // Markets per network. When the selection is not on this deployment (for
  // example market 1 after switching to testnet), move it onto the first
  // listed market instead of fetching an unknown market.
  useEffect(() => {
    setMarkets({ state: "loading" });
    fetch(`/api/markets?net=${net}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!ok) {
          setMarkets({ state: "error", message: body.error });
          return;
        }
        setMarkets({ state: "ready", data: body.markets });
        setMarketId((cur) => (body.markets.some((m: Market) => m.id === cur) ? cur : (body.markets[0]?.id ?? cur)));
      })
      .catch((e) => setMarkets({ state: "error", message: String(e) }));
  }, [net]);

  // Candles per market, timeframe and network. The REST load owns history;
  // the market-data socket below patches the last candle live.
  useEffect(() => {
    if (!marketKnown) return;
    setCandles({ state: "loading" });
    fetch(`/api/candles?market=${marketId}&res=${res}&net=${net}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => setCandles(ok ? { state: "ready", data: body.candles } : { state: "error", message: body.error }))
      .catch((e) => setCandles({ state: "error", message: String(e) }));
  }, [marketId, res, net, marketKnown]);

  const historyReady = candles.state === "ready";
  const livePriceDecimals = market?.priceDecimals ?? decimals;

  // Live candles: one market-data socket per market/resolution. Every push
  // updates the last candle through series.update() and folds into state, so
  // a reconnect or a reload never loses history. Reconnects on market, res,
  // network or history readiness; closes on unmount.
  useEffect(() => {
    if (!marketKnown || !historyReady || !market) return;
    const priceDecimals = livePriceDecimals;
    return connectMarketWs({
      net,
      market: marketId,
      res,
      priceDecimals,
      onPush: ({ candles: pushed }) => {
        if (!pushed.length) return;
        setCandles((prev) => {
          if (prev.state !== "ready") return prev;
          let data = prev.data;
          for (const c of pushed) data = mergeCandle(data, c);
          return { state: "ready", data };
        });
        const s = series.current;
        const v = volSeries.current;
        for (const c of pushed) {
          try {
            s?.update({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
          } catch {
            // The series throws when the chart is tearing down; state holds it.
          }
          try {
            v?.update({ time: c.time as UTCTimestamp, value: c.volume, color: volumeColorFor(c) });
          } catch {
            // Same teardown race as above.
          }
        }
      },
    });
  }, [net, marketId, res, marketKnown, historyReady, market, livePriceDecimals]);

  const friendsRef = useRef(friends);
  friendsRef.current = friends;

  // Room activity: monadLogs for OrderRequestV2 on this network's Exchange,
  // filtered to room members (owner or descId caller). Shows a toast for 6 s
  // and refreshes positions. Members read through a ref so room changes do
  // not reconnect the socket.
  useEffect(() => {
    return subscribeRoomFeed({
      net,
      members: () => friendsRef.current.map((f) => f.account),
      priceDecimals: livePriceDecimals,
      onEvent: (ev) => {
        const msg =
          ev.kind === "call-accepted"
            ? `${display(ev.caller ?? ev.owner)}'s call was accepted by ${display(ev.owner)}`
            : `${display(ev.owner)} placed an order`;
        setToast(msg);
        setFeedTick((t) => t + 1);
      },
    });
  }, [net, livePriceDecimals]);

  // Toast lifetime: 6 s on screen, then gone.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Positions per market, room and network: the saved My frens view.
  // feedTick refreshes it when the room feed sees member activity.
  useEffect(() => {
    if (view !== "frens" || !marketKnown) return;
    // A live-feed refresh (same room, market and network) keeps the list on screen until the new one lands;
    // only a different room blanks it. A failed background refresh keeps the last good list too.
    const key = `${marketId}|${extra.join(",")}|${net}`;
    const background = roomKey.current === key;
    roomKey.current = key;
    if (!background) setRoom({ state: "loading" });
    const q = extra.length ? `&accounts=${extra.join(",")}` : "";
    fetch(`/api/positions?market=${marketId}${q}&net=${net}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) =>
        setRoom((prev) => (ok ? { state: "ready", data: body } : background && prev.state === "ready" ? prev : { state: "error", message: body.error })),
      )
      .catch((e) => setRoom((prev) => (background && prev.state === "ready" ? prev : { state: "error", message: String(e) })));
  }, [marketId, extra, view, net, marketKnown, feedTick]);

  // Recent Perpl openers per market and network: the default Live on Perpl view, so faces
  // land on the candles at their entry time. feedTick refreshes it on room feed events.
  useEffect(() => {
    if (view !== "live" || !marketKnown) return;
    const key = `${marketId}|${net}`;
    const background = liveKey.current === key;
    liveKey.current = key;
    if (!background) setLive({ state: "loading" });
    fetch(`/api/live?market=${marketId}&hours=6&net=${net}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) =>
        setLive((prev) => (ok ? { state: "ready", data: body } : background && prev.state === "ready" ? prev : { state: "error", message: body.error })),
      )
      .catch((e) => setLive((prev) => (background && prev.state === "ready" ? prev : { state: "error", message: String(e) })));
  }, [marketId, view, net, marketKnown, feedTick]);

  // Accepted-call record per fren, read from the callbook API when it runs
  // on HyperSync. The RPC log-scan path is retired: Perpl logs are
  // unindexed, so a wide window downloads every order on the venue and never
  // finishes. Without HyperSync the room's ?c= receipts (below) own the
  // record instead, so rpc-sourced rows are discarded here.
  useEffect(() => {
    if (!accountsKey) return;
    let cancelled = false;
    const addrs = accountsKey.split(",");
    for (const a of addrs) {
      const key = `${net}:${a}`;
      if (callRecords[key]) continue;
      fetch(`/api/callbook?suggester=${a}&net=${net}`)
        .then(async (r) => ({ ok: r.ok, body: await r.json() }))
        .then(({ ok, body }) => {
          if (cancelled || !ok) return;
          if (body.source !== "hypersync") return;
          setCallRecords((prev) =>
            prev[key]
              ? prev
              : { ...prev, [key]: { accepted: Number(body.accepted) || 0, hit: Number(body.hit) || 0 } },
          );
        })
        .catch(() => {
          // A missing record hides the line; the card still shows the position.
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey, net]);

  // Trustless call record from the room link: ?c= hashes verified per
  // receipt by /api/calls. Powers the same "<n> calls taken" line where the
  // HyperSync path above has nothing.
  const callsKey = useMemo(() => callHashes.join(","), [callHashes]);
  useEffect(() => {
    if (!callsKey) {
      setReceiptCalls([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/calls?net=${net}&c=${encodeURIComponent(callsKey)}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (cancelled || !ok || !Array.isArray(body.calls)) return;
        setReceiptCalls(body.calls as (PricedCall & { hit?: boolean; resting?: boolean; stake?: { state: string; amount: number } | null })[]);
      })
      .catch(() => {
        // A missing record hides the line; the card still shows the position.
      });
    return () => {
      cancelled = true;
    };
  }, [callsKey, net]);

  // Append an accepted-call hash to the room's ?c= list: state owns the
  // record, the URL follows so the link stays shareable, capped at 50.
  function appendCallHash(hash: string) {
    const t = hash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(t)) return;
    if (callHashes.some((h) => h.toLowerCase() === t.toLowerCase())) return;
    const next = [...callHashes, t].slice(-50);
    setCallHashes(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("c", encodeCallsParam(next));
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // State still holds the hashes even if the URL cannot be rewritten.
    }
  }

  function handleAcceptedChange(info: { orderId: string; hash: string } | null) {
    acceptedCall.current = info && incoming ? callKey(incoming) : null;
    setGhostAccepted(info);
    if (info?.hash) appendCallHash(info.hash);
  }

  // The chart itself, created once.
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: CHART.muted,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: CHART.grid }, horzLines: { color: CHART.grid } },
      rightPriceScale: { borderColor: CHART.edge, scaleMargins: { top: 0.12, bottom: 0.18 } },
      timeScale: { borderColor: CHART.edge, timeVisible: true, rightOffset: 14 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    // Candles filled green and red with wicks in the same hue. The last
    // price draws a dotted line with a solid accent pill: the one accent on
    // the chart, reserved for the viewer's own price.
    const s = c.addSeries(CandlestickSeries, {
      upColor: CHART.up,
      borderUpColor: CHART.up,
      wickUpColor: CHART.up,
      downColor: CHART.down,
      borderDownColor: CHART.down,
      wickDownColor: CHART.down,
      priceLineVisible: true,
      priceLineColor: CHART.accent,
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
    });
    // Volume footer strip inside the same pane on its own scale: the top 0.86
    // margin leaves the bottom ~14 percent for the bars. The scale hides its
    // axis so only one price axis shows.
    const v = c.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 }, visible: false });
    chart.current = c;
    series.current = s;
    volSeries.current = v;
    return () => {
      tpLine.current = null;
      slLine.current = null;
      sugLine.current = null;
      dragging.current = null;
      c.remove();
      chart.current = null;
      series.current = null;
      volSeries.current = null;
      lines.current.clear();
    };
  }, []);

  // Where every friend's face sits, from the chart's own coordinates.
  // The price scale fits the candles plus the selected TP/SL only: friend
  // entries never stretch it. Entries outside the visible range pin to the
  // top or bottom edge via placeAvatar. On-chart faces cluster at render.
  const layout = useCallback(() => {
    const c = chart.current;
    const s = series.current;
    const el = box.current;
    if (!c || !s || !el || candles.state !== "ready" || !candles.data.length) return setOverlays([]);
    const right = el.clientWidth - c.priceScale("right").width();
    const height = el.clientHeight;
    const data = candles.data;
    const first = data[0].time;
    const last = data[data.length - 1].time;
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of data) {
      if (Number.isFinite(k.low)) lo = Math.min(lo, k.low);
      if (Number.isFinite(k.high)) hi = Math.max(hi, k.high);
    }
    const baseRange = Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : null;
    const range = visiblePriceRange(baseRange, tp, sl);
    const viewMin = range?.min ?? Math.min(...data.map((k) => k.low));
    const viewMax = range?.max ?? Math.max(...data.map((k) => k.high));
    const timeToX = (t: number) => c.timeScale().timeToCoordinate(t as UTCTimestamp);
    const priceToY = (p: number) => s.priceToCoordinate(p);
    const placedAll = friends.map((f) =>
      placeAvatar({
        entryTime: f.entryTime,
        entryPrice: f.entryPrice,
        firstTime: first,
        lastTime: last,
        viewMin,
        viewMax,
        timeToX,
        priceToY,
        height,
        avatar: FACE_SIZE,
        barSeconds: res,
      }),
    );
    const topIdx: number[] = [];
    const bottomIdx: number[] = [];
    placedAll.forEach((p, i) => {
      if (p.mode === "top") topIdx.push(i);
      else if (p.mode === "bottom") bottomIdx.push(i);
    });
    const byIndex = new Map<string, { avatarX: number | null; avatarY: number; mode: "candle" | "top" | "bottom" }>();
    friends.forEach((f, i) => {
      const p = placedAll[i];
      if (p.mode === "candle") {
        byIndex.set(f.account, { avatarX: p.x, avatarY: p.y, mode: "candle" });
      }
    });
    topIdx.forEach((fi, k) => {
      // Off-screen faces pin to the right edge, just left of the price scale,
      // stacked: TP/SL line labels live on the left and stay clear.
      byIndex.set(friends[fi].account, {
        avatarX: right - FACE_SIZE / 2 - 8,
        avatarY: FACE_SIZE / 2 + 4 + k * EDGE_STEP,
        mode: "top",
      });
    });
    bottomIdx.forEach((fi, k) => {
      // Bottom faces stack upward from just above the volume strip, which
      // owns the bottom ~14% of the pane, so they never cover the bars.
      const base = height * (1 - VOL_STRIP_FRAC) - FACE_SIZE / 2 - 4;
      byIndex.set(friends[fi].account, {
        avatarX: right - FACE_SIZE / 2 - 8,
        avatarY: base - k * EDGE_STEP,
        mode: "bottom",
      });
    });
    setOverlays(
      friends.map((f) => {
        const pos = byIndex.get(f.account) ?? { avatarX: null, avatarY: 0, mode: "candle" as const };
        const entryY = priceToY(f.entryPrice) ?? (pos.mode === "top" ? -10 : height + 10);
        const markY = priceToY(f.markPrice) ?? entryY;
        const markStart = Math.max(f.entryTime ?? first, first) as UTCTimestamp;
        const bandX = timeToX(markStart) ?? 0;
        // Clip the PnL band to the visible price range so it never washes the
        // whole chart when the entry sits far outside the candles.
        const blo = Math.max(Math.min(f.entryPrice, f.markPrice), viewMin);
        const bhi = Math.min(Math.max(f.entryPrice, f.markPrice), viewMax);
        let bandTop = Math.min(entryY, markY);
        let bandHeight = Math.max(1, Math.abs(entryY - markY));
        if (bhi > blo) {
          const yHi = priceToY(bhi) ?? bandTop;
          const yLo = priceToY(blo) ?? bandTop + bandHeight;
          bandTop = Math.min(yHi, yLo);
          bandHeight = Math.max(1, Math.abs(yHi - yLo));
        } else {
          bandHeight = 0;
        }
        return {
          account: f.account,
          entryY,
          markY,
          bandLeft: bandX,
          bandTop,
          bandHeight,
          right,
          avatarX: pos.avatarX,
          avatarY: pos.avatarY,
          mode: pos.mode,
        };
      }),
    );
  }, [candles, friends, tp, sl]);

  const selectedAccount = hover ?? active;
  const selected =
    (selectedAccount ? friends.find((f) => f.account === selectedAccount) : undefined) ??
    (active ? friends.find((f) => f.account === active) : undefined) ??
    null;
  const selectedRec = selected ? recFor(selected.account) : null;
  const selectedLine = selectedRec ? callLine(selectedRec.accepted, selectedRec.hit) : null;

  // On-chart faces clustered for rendering: faces within 14px overlap, more
  // than 5 in one spot collapse into a +N circle. Clustering runs on the
  // entry price coordinate so stacked layout never hides a cluster.
  const faceClusters = useMemo(() => {
    const pts = overlays.flatMap((o) => {
      if (o.mode !== "candle" || o.avatarX === null) return [];
      const f = friends.find((x) => x.account === o.account);
      if (!f) return [];
      return [{ account: o.account, x: o.avatarX, y: o.entryY, side: f.side }];
    });
    return clusterFaces(pts);
  }, [overlays, friends]);

  function selectStrongest(members: { account: string }[]) {
    let best: string | null = null;
    let bestPnl = -Infinity;
    for (const m of members) {
      const f = friends.find((x) => x.account === m.account);
      const pnl = f?.unrealizedPnl ?? -Infinity;
      if (pnl > bestPnl) {
        bestPnl = pnl;
        best = m.account;
      }
    }
    setActive((cur) => (best && cur !== best ? best : cur === best ? null : best));
  }

  // Motion stays instant when the viewer asked for less of it.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);

  // Fresh TP/SL placement whenever the inspected trader changes.
  useEffect(() => {
    if (!selected) {
      setTp(null);
      setSl(null);
      setFocusKind(null);
      return;
    }
    try {
      const init = initialTpSl(selected.markPrice, selected.side);
      setTp(init.tp);
      setSl(init.sl);
    } catch {
      setTp(null);
      setSl(null);
    }
    setSuggestKind("tp");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.account, selected?.markPrice, selected?.side]);

  // Draggable TP/SL visuals on the candle series, glued on pan, zoom and edit.
  // Each line takes the selected fren's side colour with a filled axis pill:
  // TP solid, SL dashed.
  useEffect(() => {
    const s = series.current;
    if (!s || !selected || tp === null || sl === null) {
      if (s) {
        if (tpLine.current) {
          s.removePriceLine(tpLine.current);
          tpLine.current = null;
        }
        if (slLine.current) {
          s.removePriceLine(slLine.current);
          slLine.current = null;
        }
      }
      setTpY(null);
      setSlY(null);
      return;
    }
    // Profit is drawn in gain colour and the stop in loss colour, whatever the position's side.
    const tpColour = CHART.up;
    const slColour = CHART.down;
    const tpTitle = `TP ${formatPrice(tp, decimals)} (${formatUsd(pnlAtPrice(tp, selected.entryPrice, selected.size, selected.side))})`;
    const slTitle = `SL ${formatPrice(sl, decimals)} (${formatUsd(pnlAtPrice(sl, selected.entryPrice, selected.size, selected.side))})`;
    if (!tpLine.current) {
      tpLine.current = s.createPriceLine({
        price: tp,
        color: tpColour,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        axisLabelColor: tpColour,
        axisLabelTextColor: CHART.page,
        title: tpTitle,
      });
    } else {
      tpLine.current.applyOptions({ price: tp, color: tpColour, axisLabelColor: tpColour, axisLabelTextColor: CHART.page, title: tpTitle });
    }
    if (!slLine.current) {
      slLine.current = s.createPriceLine({
        price: sl,
        color: slColour,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        axisLabelColor: slColour,
        axisLabelTextColor: CHART.page,
        title: slTitle,
      });
    } else {
      slLine.current.applyOptions({ price: sl, color: slColour, axisLabelColor: slColour, axisLabelTextColor: CHART.page, title: slTitle });
    }
    setTpY(s.priceToCoordinate(tp));
    setSlY(s.priceToCoordinate(sl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tp, sl, selected, decimals, overlays]);

  // The open suggestion link is the centrepiece of the owner's chart: a ghost
  // line in the suggested side's colour at 60% opacity (8-digit hex, never
  // CSS color-mix which the chart library cannot parse), dashed, with an axis
  // pill naming the suggester, the TP price and the live signed PnL. The
  // owner drags it to their own price to counter; the pill updates live and
  // the banner offers "Send counter link" on release. After Accept the line
  // stays solid in the brand accent.
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    if (sugLine.current) {
      s.removePriceLine(sugLine.current);
      sugLine.current = null;
    }
    if (!incoming || ghostPrice === null) {
      setGhostY(null);
      return;
    }
    const accepted = ghostAccepted !== null;
    sugLine.current = s.createPriceLine({
      price: ghostPrice,
      color: ghostColour,
      lineWidth: 2,
      lineStyle: accepted ? LineStyle.Solid : LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: ghostColour,
      axisLabelTextColor: CHART.page,
      title: ghostLabel,
    });
    setGhostY(s.priceToCoordinate(ghostPrice) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, ghostPrice, ghostAccepted, decimals, overlays, ghostPnl]);

  // Price lines do not move the candle scale on their own, so a TP/SL or a
  // ghost suggestion outside the candles' range would render off screen. The
  // visible range fits the candles plus the selected TP and SL plus the
  // ghost price: friend entries never stretch the scale (their lines opt out
  // below).
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const fitTp = selected && tp !== null ? tp : null;
    const fitSl = selected && sl !== null ? sl : null;
    if (fitTp === null && fitSl === null && ghostPrice === null) {
      s.applyOptions({ autoscaleInfoProvider: undefined });
      return;
    }
    const ghost = ghostPrice;
    s.applyOptions({
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const info = base();
        const baseRange =
          info?.priceRange == null ? null : { min: info.priceRange.minValue, max: info.priceRange.maxValue };
        let range = visiblePriceRange(baseRange, fitTp, fitSl);
        if (typeof ghost === "number" && Number.isFinite(ghost)) {
          range = visiblePriceRange(range, ghost, null);
        }
        if (!range) return info;
        if (!info || !info.priceRange) return { priceRange: { minValue: range.min, maxValue: range.max } };
        return {
          ...info,
          priceRange: {
            minValue: Math.min(info.priceRange.minValue, range.min),
            maxValue: Math.max(info.priceRange.maxValue, range.max),
          },
        };
      },
    });
    requestAnimationFrame(layout);
  }, [tp, sl, selected, candles, ghostPrice, layout]);

  function ghostHit(y: number): "ghost" | null {
    const s = series.current;
    if (!s || !incoming || ghostPrice === null || ghostAccepted) return null;
    const yG = s.priceToCoordinate(ghostPrice);
    if (yG === null) return null;
    return Math.abs(y - yG) <= 10 ? "ghost" : null;
  }

  function lineHit(y: number): SuggestKind | null {
    const s = series.current;
    if (!s || tp === null || sl === null) return null;
    const yTp = s.priceToCoordinate(tp);
    const ySl = s.priceToCoordinate(sl);
    const dTp = yTp === null ? Infinity : Math.abs(y - yTp);
    const dSl = ySl === null ? Infinity : Math.abs(y - ySl);
    const best = Math.min(dTp, dSl);
    if (best > 10) return null;
    return dTp <= dSl ? "tp" : "sl";
  }

  // The fren card is a hover card on a pointer and a tap target on a phone.
  // A tap on the candles is handled by onChartPointerDown below; a tap on
  // anything else on the page clears the selection here, so a phone can
  // always get the card off the screen without pressing Escape.
  useEffect(() => {
    if (!active) return;
    const clear = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && wrap.current?.contains(target)) return;
      setActive(null);
    };
    document.addEventListener("pointerdown", clear);
    return () => document.removeEventListener("pointerdown", clear);
  }, [active]);

  // Drag listeners live on the wrapping container, not on the chart box: the
  // box is the bottom layer and every overlay above it would otherwise steal
  // the pointer. Decorative overlays are pointer-events-none; only faces,
  // buttons and grips take events, and grips restart the drag through their
  // data-drag-kind. Clamping still starts from the mark, per lib/drag.ts.
  // The ghost line drags the same way with no clamp: the owner drags it to
  // their own price to counter, and the banner offers "Send counter link" on
  // release.
  function onChartPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-nodrag]")) return;
    const grip = target.closest("[data-drag-kind]");
    if (target.closest("button") && !grip) return;
    const el = box.current;
    const s = series.current;
    const c = chart.current;
    if (!el || !s || !c) return;
    const y = e.clientY - el.getBoundingClientRect().top;
    const gripKind = grip?.getAttribute("data-drag-kind");
    if (!gripKind) setActive(null);
    if (gripKind === "ghost") {
      if (!incoming || ghostPrice === null || ghostAccepted) return;
      dragging.current = "ghost";
      c.applyOptions({ handleScroll: false, handleScale: false });
      (e.currentTarget as HTMLElement).style.touchAction = "none";
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (gripKind === "tp" || gripKind === "sl") {
      if (!selected || tp === null || sl === null) return;
      dragging.current = gripKind;
      setFocusKind(gripKind);
      setSuggestKind(gripKind);
      c.applyOptions({ handleScroll: false, handleScale: false });
      (e.currentTarget as HTMLElement).style.touchAction = "none";
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    // No grip: the ghost wins the hit test so the centrepiece stays
    // grabbable where it overlaps a TP/SL line.
    const ghost = ghostHit(y);
    if (ghost) {
      dragging.current = ghost;
      c.applyOptions({ handleScroll: false, handleScale: false });
      (e.currentTarget as HTMLElement).style.touchAction = "none";
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!selected || tp === null || sl === null) return;
    const kind = lineHit(y);
    if (!kind) return;
    dragging.current = kind;
    setFocusKind(kind);
    setSuggestKind(kind);
    c.applyOptions({ handleScroll: false, handleScale: false });
    (e.currentTarget as HTMLElement).style.touchAction = "none";
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onChartPointerMove(e: React.PointerEvent) {
    const el = box.current;
    const s = series.current;
    if (!el || !s) return;
    const y = e.clientY - el.getBoundingClientRect().top;
    const kind = dragging.current;
    if (!kind) {
      setHoverLine(selected && tp !== null && sl !== null ? lineHit(y) : null);
      setHoverGhost(ghostHit(y) !== null);
      return;
    }
    if (kind === "ghost") {
      const price = priceFromY(y, (yy) => {
        const p = s.coordinateToPrice(yy);
        return typeof p === "number" ? p : null;
      });
      if (price === null) return;
      setGhostPrice(price);
      return;
    }
    const price = priceFromY(y, (yy) => {
      const p = s.coordinateToPrice(yy);
      return typeof p === "number" ? p : null;
    });
    if (price === null) return;
    const clamped =
      selected && !validTpSl(kind, price, selected.markPrice, selected.side)
        ? clampTpSl(kind, price, selected.markPrice, selected.side, decimals)
        : price;
    if (kind === "tp") setTp(clamped);
    else setSl(clamped);
    setSuggestKind(kind);
  }

  function endChartDrag(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = null;
    setHoverLine(null);
    setHoverGhost(false);
    chart.current?.applyOptions({ handleScroll: true, handleScale: true });
    (e.currentTarget as HTMLElement).style.touchAction = "";
  }

  function resetLines() {
    if (!selected) return;
    const init = initialTpSl(selected.markPrice, selected.side);
    setTp(init.tp);
    setSl(init.sl);
    setSuggestKind("tp");
  }

  function nudgeFocused(kind: SuggestKind, dir: 1 | -1) {
    const price = kind === "tp" ? tp : sl;
    if (price === null || !selected) return;
    const raw = nudgePrice(price, decimals, dir);
    const next = validTpSl(kind, raw, selected.markPrice, selected.side)
      ? raw
      : clampTpSl(kind, raw, selected.markPrice, selected.side, decimals);
    if (kind === "tp") setTp(next);
    else setSl(next);
    setSuggestKind(kind);
  }

  function onLineKeyDown(kind: SuggestKind, e: React.KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      nudgeFocused(kind, 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nudgeFocused(kind, -1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetLines();
    }
  }

  function onGhostKeyDown(e: React.KeyboardEvent) {
    if (ghostPrice === null || !incoming || ghostAccepted) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setGhostPrice(nudgePrice(ghostPrice, decimals, 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setGhostPrice(nudgePrice(ghostPrice, decimals, -1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setGhostPrice(incoming.price);
    }
  }

  function onViewerChange(v: string) {
    setViewer(v);
    const t = v.trim();
    if (t === "") setViewerError("");
    else if (!/^0x[0-9a-fA-F]{40}$/.test(t) || /^0x0+$/.test(t)) setViewerError("That is not a usable address.");
    else {
      setViewerError("");
      window.localStorage.setItem("frens:caller", t);
    }
  }

  // A returning caller's public address is remembered, so the next call is drag then copy.
  useEffect(() => {
    if (viewerAddress) return;
    const saved = window.localStorage.getItem("frens:caller");
    if (saved && /^0x[0-9a-fA-F]{40}$/.test(saved)) setViewer(saved);
  }, [viewerAddress]);

  const viewerOk = /^0x[0-9a-fA-F]{40}$/.test(viewer.trim()) && !/^0x0+$/.test(viewer.trim());
  const suggestPrice = suggestKind === "tp" ? tp : sl;
  const suggestPnl =
    selected && suggestPrice !== null
      ? pnlAtPrice(suggestPrice, selected.entryPrice, selected.size, selected.side)
      : null;

  const suggestPayload = useMemo(() => {
    if (!selected || suggestPrice === null || !viewerOk) return null;
    try {
      return encodeSuggestion({
        owner: selected.account as Address,
        market: marketId,
        side: selected.side,
        price: suggestPrice,
        from: viewer.trim() as Address,
        createdAt: Date.now(),
        ...(suggestKind === "sl" ? { kind: "sl" as const } : {}),
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.account, selected?.side, suggestPrice, suggestKind, viewerOk, viewer, marketId]);

  // The default room has no hand-added traders, so extra is empty and the old
  // code encoded nothing. Fall back to the room's current accounts so the
  // suggestion link carries the room the viewer is actually looking at.
  const roomCodeForSuggest = useMemo(() => {
    try {
      const addrs = extra.length ? extra : friends.map((f) => f.account);
      return encodeRoom(addrs);
    } catch {
      return "";
    }
  }, [extra, friends]);

  async function copySuggestLink() {
    if (!suggestPayload || typeof window === "undefined") return;
    try {
      const url = roomCodeForSuggest
        ? `${window.location.origin}/r/${roomCodeForSuggest}?s=${suggestPayload}&net=${net}`
        : `${window.location.origin}/?s=${suggestPayload}&net=${net}`;
      await navigator.clipboard.writeText(url);
      setCopiedSuggest(true);
      setTimeout(() => setCopiedSuggest(false), 2000);
    } catch {
      setCopiedSuggest(false);
    }
  }

  function openCopy(account: string) {
    const f = friends.find((x) => x.account === account);
    setCopyFor(account);
    setCopySize(f ? String(f.size) : "");
    setCopySlip("50");
    setCopyResult({ kind: "idle" });
  }

  // One-tap copy: build the taker order for the copier's own size, encode the
  // execOrder calldata, and hand it to the copier's own wallet to sign. No key
  // ever touches the app; the wallet shows the order and the copier can refuse.
  function copyOrderData() {
    if (!copyFriend || !market) throw new Error("pick a position and a market first");
    const size = Number(copySize);
    const slip = Number(copySlip);
    const order = toCopyOrder(
      { market: marketId, side: copyFriend.side },
      { priceDecimals: BigInt(market.priceDecimals), lotDecimals: BigInt(market.lotDecimals) },
      // The copied fren goes in the top bits, so the copy is attributable on chain like a call.
      { size, markPrice: copyFriend.markPrice, maxSlippageBps: slip, orderDescId: suggestionDescId(copyFriend.account as Address, Date.now()) },
    );
    return encodeCopyOrder(order);
  }

  // A broadcast hash is not a trade: wait for the receipt and surface a revert as an error.
  async function settled(hash: `0x${string}`) {
    const r = await publicClient(net).waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`The order reverted on Perpl (tx ${hash.slice(0, 10)}…).`);
  }

  // Wallets Perpl has never seen open an exchange account first (approve + createAccount), then copy.
  const [deposit, setDeposit] = useState("50");
  const [depositFloor, setDepositFloor] = useState<number | null>(null);
  async function raiseDepositToFloor() {
    const floor = Number(await minAccountOpen(publicClient(net), net)) / 1e6;
    setDepositFloor(floor);
    setDeposit((d) => (Number(d) >= floor ? d : String(floor)));
  }

  async function depositThenCopy(signer: "wallet" | "passkey") {
    setCopyResult({ kind: "sending" });
    try {
      const units = toAusdUnits(Number(deposit));
      const floor = await minAccountOpen(publicClient(net), net);
      if (units < floor) throw new Error(`Perpl needs at least ${Number(floor) / 1e6} aUSD to open an account.`);
      const me = signer === "passkey" ? passkey?.address : await connectWallet(net);
      if (!me) throw new Error("Sign in with the passkey first.");
      const held = await ausdBalance(publicClient(net), net, me);
      if (held < units) {
        throw new Error(`This wallet holds ${(Number(held) / 1e6).toLocaleString("en-US")} aUSD; the deposit needs ${deposit}.`);
      }
      for (const call of depositCalls(net, units)) {
        const hash = signer === "passkey" && passkey ? await sendExecOrderWith(passkey, call.to, call.data, net) : await sendExecOrder(call.to, call.data, net);
        await settled(hash);
      }
    } catch (e) {
      setCopyResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    await (signer === "passkey" ? doCopyWithPasskey() : doCopy());
  }

  const [walletAddr, setWalletAddr] = useState<Address | null>(null);

  async function doCopy() {
    setCopyResult({ kind: "sending" });
    try {
      const data = copyOrderData();
      const me = await connectWallet(net);
      setWalletAddr(me);
      if (!(await hasPerplAccount(publicClient(net), net, me))) {
        await raiseDepositToFloor();
        setCopyResult({ kind: "needs-account", signer: "wallet" });
        return;
      }
      const hash = await sendExecOrder(EXCHANGE, data, net);
      await settled(hash);
      setCopyResult({ kind: "ok", hash });
    } catch (e) {
      setCopyResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Passkey sibling of doCopy: the same calldata signed by the in-memory
  // passkey account instead of the injected wallet. The panel only offers
  // this once the passkey address holds MON for gas.
  async function doCopyWithPasskey() {
    if (!passkey) return;
    setCopyResult({ kind: "sending" });
    try {
      const data = copyOrderData();
      if (!(await hasPerplAccount(publicClient(net), net, passkey.address))) {
        await raiseDepositToFloor();
        setCopyResult({ kind: "needs-account", signer: "passkey" });
        return;
      }
      const hash = await sendExecOrderWith(passkey, EXCHANGE, data, net);
      await settled(hash);
      setCopyResult({ kind: "ok", hash });
    } catch (e) {
      setCopyResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Calls taken in this room and still resting on Perpl, read back from chain: the end state of a call,
  // drawn for everyone who opens the link. The open suggestion's own ghost line is not drawn twice.
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    for (const l of takenLines.current) s.removePriceLine(l);
    takenLines.current = [];
    for (const c of receiptCalls) {
      if (!c.resting || c.price === null || c.market !== marketId) continue;
      if (incoming && Math.abs(incoming.price - c.price) < 10 ** -decimals / 2) continue;
      takenLines.current.push(
        s.createPriceLine({
          price: c.price,
          color: hexWithAlpha(CHART.up, 0.75),
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          axisLabelColor: hexWithAlpha(CHART.up, 0.75),
          axisLabelTextColor: CHART.page,
          title: `${display(c.caller)}'s call · resting on Perpl`,
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptCalls, marketId, incoming, decimals, nameByAddr, candles]);

  // Feed candles, volume bars and friend lines into the chart.
  useEffect(() => {
    const c = chart.current;
    const s = series.current;
    const v = volSeries.current;
    if (!c || !s || !v || candles.state !== "ready") return;
    s.setData(candles.data.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    v.setData(
      candles.data.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: volumeColorFor(k) })),
    );
    for (const l of lines.current.values()) c.removeSeries(l);
    lines.current.clear();
    const data = candles.data;
    if (data.length) {
      for (const f of friends) {
        const startTime = data.find((k) => k.time >= (f.entryTime ?? 0))?.time ?? data[0].time;
        const dim = active && active.toLowerCase() !== f.account.toLowerCase();
        const colour = ring(f);
        // Friend entries never move the price scale: the candles plus the
        // selected TP/SL own the range, entries outside it pin to the edge.
        const l = c.addSeries(LineSeries, {
          // Hairlines at rest: entries a few dollars apart must not stack into one band.
          color: dim ? `${colour}30` : active ? colour : `${colour}80`,
          lineWidth: active && !dim ? 2 : 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        });
        l.setData(entryLinePoints(startTime, data[data.length - 1].time, f.entryPrice).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
        lines.current.set(f.account, l);
      }
    }
    requestAnimationFrame(layout);
  }, [candles, friends, active, layout]);

  // OHLC readout follows the crosshair and rests on the last candle.
  useEffect(() => {
    const c = chart.current;
    if (!c || candles.state !== "ready" || !candles.data.length) {
      setOhlc(null);
      return;
    }
    const data = candles.data;
    const rest = () => {
      const k = data[data.length - 1];
      const prev = data.length > 1 ? data[data.length - 2].close : null;
      const { change, pct } = candleChange(k, prev);
      setOhlc({ o: k.open, h: k.high, l: k.low, c: k.close, change, pct, time: k.time, volume: k.volume });
    };
    rest();
    const handler = (param: MouseEventParams<Time>) => {
      const t = typeof param.time === "number" ? param.time : null;
      if (t === null) return rest();
      const idx = data.findIndex((k) => k.time === t);
      if (idx < 0) return rest();
      const k = data[idx];
      const prev = idx > 0 ? data[idx - 1].close : null;
      const { change, pct } = candleChange(k, prev);
      setOhlc({ o: k.open, h: k.high, l: k.low, c: k.close, change, pct, time: k.time, volume: k.volume });
    };
    c.subscribeCrosshairMove(handler);
    return () => c.unsubscribeCrosshairMove(handler);
  }, [candles]);

  // Keep overlays glued to the chart on pan, zoom and resize.
  useEffect(() => {
    const c = chart.current;
    if (!c || !wrap.current) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    c.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap.current);
    return () => {
      c.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [layout]);

  function addTrader(e: React.FormEvent) {
    e.preventDefault();
    const a = draft.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return setDraftError("That is not a Monad address.");
    const clean = sanitizeName(draftName);
    if (draftName.trim() !== "" && !clean) return setDraftError("That name cannot be used. Keep it under 24 characters, no commas.");
    setDraftError("");
    const lower = a.toLowerCase();
    setExtra((x) => (x.includes(lower) ? x : [...x, lower]));
    if (clean) setNameByAddr((m) => new Map(m).set(lower, clean));
    setDraft("");
    setDraftName("");
  }

  // Room links carry nicknames in ?n=, one slot per room address in the same
  // (sorted) order so the room the link opens shows the same names.
  function roomNamesQuery(): string {
    const sorted = [...extra].sort();
    return encodeKeyedNames(sorted, (a) => nameByAddr.get(a));
  }

  // Phones get the OS share sheet (Telegram, X, WhatsApp) instead of the clipboard.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  async function copyRoomLink() {
    try {
      const code = encodeRoom(extra);
      if (!code) return;
      const n = roomNamesQuery();
      const hasNames = n.split(",").some((s) => s !== "");
      const c = encodeCallsParam(callHashes);
      const url = `${window.location.origin}${roomLink(code, net, hasNames ? n : undefined, c || undefined)}`;
      if (canShare) {
        await navigator.share({ title: "frens", text: ROOM_POST, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  // The room link the accept banner shares: same room, same names, plus the
  // ?c= receipts so the next opener sees the accepted call verified.
  const roomSharePath = useMemo(() => {
    try {
      const addrs = extra.length ? extra : friends.map((f) => f.account);
      const code = encodeRoom(addrs);
      if (!code) return null;
      const n = roomNamesQuery();
      const hasNames = n.split(",").some((s) => s !== "");
      const c = encodeCallsParam(callHashes);
      return roomLink(code, net, hasNames ? n : undefined, c || undefined);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra, friends, net, nameByAddr, callHashes]);

  // Rooms opened from a link carry their traders in initialAccounts; the bare
  // page opens without a room. Without a room the "My frens" view grows one
  // through the room builder panel instead of an empty rail.
  const hasInitialRoom = (initialAccounts?.length ?? 0) > 0;
  const showRoomBuilder = view === "frens" && !hasInitialRoom && extra.length === 0;
  const roomCode = useMemo(() => {
    if (!hasInitialRoom) return "";
    try {
      return encodeRoom(initialAccounts ?? []);
    } catch {
      return "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInitialRoom]);
  // One-time share hint on room pages: dismissed per room in localStorage so
  // it shows once per browser. Starts dismissed so the bare page and the
  // first paint never flash it.
  const [hintDismissed, setHintDismissed] = useState(true);
  useEffect(() => {
    if (!roomCode) return;
    try {
      setHintDismissed(window.localStorage.getItem(`frens:room-hint:${roomCode}`) === "1");
    } catch {
      setHintDismissed(false);
    }
  }, [roomCode]);
  function dismissHint() {
    try {
      window.localStorage.setItem(`frens:room-hint:${roomCode}`, "1");
    } catch {
      // The banner hides for this visit either way; storage makes it stick.
    }
    setHintDismissed(true);
  }

  // Switch deployments: the URL owns the network so a refresh, a room link or
  // a suggestion link stays on the same deployment.
  function switchNet(next: Network) {
    if (next === net) return;
    setNet(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("net", next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // State still switches even if the URL cannot be rewritten.
    }
  }

  const totalSides = counts.long + counts.short;
  const lastVolume = candles.state === "ready" && candles.data.length ? candles.data[candles.data.length - 1].volume : null;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1480px] flex-col px-4 pb-6 md:px-8">
      <header className="border-b border-edge">
        {/* Below 640px one compact row: wordmark plus testnet pill left, the
            deployment toggle right. The market strip and the timeframes move
            out from under it so the chart still starts inside the first
            screen of a phone. */}
        <div data-compact-header className="flex items-center justify-between gap-2 py-2 sm:hidden">
          <p className="font-[family-name:var(--font-display)] text-[18px] font-bold leading-none tracking-tight">
            frens
            {net === "testnet" && (
              <span className="num ml-2 rounded-[6px] border border-edge bg-raised px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted">
                testnet
              </span>
            )}
          </p>
          <NetworkToggle net={net} onSwitch={switchNet} compact />
        </div>
        <div className="hidden flex-wrap items-end justify-between gap-4 py-5 sm:flex">
          <div>
            <p className="font-[family-name:var(--font-display)] text-[22px] font-bold tracking-tight">
              frens
              {net === "testnet" && (
                <span className="num ml-2 rounded-[6px] border border-edge bg-raised px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted">
                  testnet
                </span>
              )}
            </p>
            <p className="text-[14px] text-muted">Trade perps with your frens.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NetworkToggle net={net} onSwitch={switchNet} />
            <MarketTabs markets={markets} marketId={marketId} onPick={setMarketId} />
            <TimeframeTabs res={res} onPick={setRes} />
          </div>
        </div>
      </header>

      {/* Below 640px the market strip scrolls on one line with the timeframe
          control pinned to its right, so neither wraps into the chart. */}
      <div className="flex items-center gap-2 pt-2 sm:hidden">
        <MarketTabs markets={markets} marketId={marketId} onPick={setMarketId} compact />
        <TimeframeTabs res={res} onPick={setRes} compact />
      </div>

      <section className="flex flex-col gap-1 pt-2 pb-1 sm:flex-row sm:items-baseline sm:gap-4 sm:pt-6 sm:pb-3">
        <h1 className="font-[family-name:var(--font-display)] text-[36px] font-bold leading-none tracking-tight sm:text-[40px] md:text-[64px]">
          <span className="num">{lastClose !== null ? formatPrice(lastClose, decimals) : " "}</span>
        </h1>
        <p className="min-w-0 truncate text-[14px] text-muted sm:whitespace-normal">
          {market ? subtitleForMarket(market.name) : ""}
          {view === "frens"
            ? room.state === "ready" && ` · ${friends.length} of ${room.data.checked} traders in the room hold it`
            : live.state === "ready" && ` · ${friends.length} live traders opened in the last ${live.data.hours}h`}
        </p>
        {view === "frens" && board.length > 0 && (
          <div data-callboard className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 sm:ml-auto sm:min-w-0 sm:justify-end sm:self-center sm:pt-0">
            <span className="shrink-0 text-[13px] text-muted">Call record</span>
            {board.slice(0, 3).map((r) => {
              const f = friends.find((x) => x.account.toLowerCase() === r.caller.toLowerCase());
              return (
                <span key={r.caller} className="flex shrink-0 items-center gap-2">
                  <Face address={r.caller} side={f?.side ?? "long"} size={26} dot={r.hit > 0} />
                  <span className="text-[15px] font-medium">{display(r.caller)}</span>
                  <span className="num text-[15px]">
                    <span className={r.hit > 0 ? "text-accent" : "text-muted"}>{r.hit} hit</span>
                    <span className="text-muted"> / {r.taken} taken</span>
                    {r.earned > 0 && <span data-earned className="text-gain"> · earned {r.earned} aUSD</span>}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* OHLC readout plus the room long/short split, above the chart. The
          OHLC numbers follow the mouse crosshair, which a phone does not
          have, so below 640px only the long/short split is printed. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-2">
        <p aria-live="off" className="num hidden text-[12px] text-muted sm:block">
          {ohlc ? (
            <>
              <span>O {formatPrice(ohlc.o, decimals)}</span>{" "}
              <span>H {formatPrice(ohlc.h, decimals)}</span>{" "}
              <span>L {formatPrice(ohlc.l, decimals)}</span>{" "}
              <span>C {formatPrice(ohlc.c, decimals)}</span>{" "}
              <span className={ohlc.change >= 0 ? "text-gain" : "text-loss"}>
                {ohlc.change >= 0 ? "+" : "-"}{formatPrice(Math.abs(ohlc.change), decimals)} ({ohlc.pct >= 0 ? "+" : "-"}{Math.abs(ohlc.pct).toFixed(2)}%)
              </span>
            </>
          ) : candles.state === "loading" ? (
            "Loading candles from Perpl"
          ) : (
            "No candles"
          )}
        </p>
        {totalSides > 0 && (
          <div className="flex min-w-[200px] flex-1 items-center gap-2">
            <span className="num whitespace-nowrap text-[12px] text-muted">
              {counts.long} long · {counts.short} short
            </span>
            <div
              className="flex h-2 min-w-12 flex-1 overflow-hidden rounded-full"
              role="img"
              aria-label={`${counts.long} traders long, ${counts.short} traders short`}
            >
              <div className="bg-gain" style={{ width: `${(counts.long / totalSides) * 100}%` }} />
              <div className="bg-loss" style={{ width: `${(counts.short / totalSides) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <main className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* The share hint and the suggestion banner are room chrome, not price:
            above the chart they push it most of a phone screen down. Below
            640px they print after it instead, each as a one-line strip. */}
        <div className="flex min-w-0 flex-col">
          <div className="order-2 pt-2 sm:order-none sm:pb-2 sm:pt-0">
            <SuggestionBanner
              friends={friends}
              roomReady={room.state === "ready"}
              marketId={marketId}
              network={net}
              priceDecimals={decimals}
              lotDecimals={market?.lotDecimals ?? 0}
              names={nameByAddr}
              onSuggestion={handleSuggestion}
              ghostPrice={ghostPrice}
              onAcceptedChange={handleAcceptedChange}
              roomShareLink={roomSharePath}
              acceptRequest={acceptReq}
              chartActions={ghostY !== null && ghostAccepted === null}
              passRequest={passReq}
            />
          </div>
          {hasInitialRoom && roomCode && !hintDismissed && !incoming && (
            <div className="order-3 mt-2 flex items-center gap-2 rounded-[10px] border border-edge bg-panel px-3 py-2 sm:order-none sm:mb-3 sm:mt-0 sm:flex-wrap sm:gap-3 sm:px-4 sm:py-3">
              <p className="min-w-0 flex-1 truncate text-[13px] sm:min-w-[200px]">
                Send this link to your frens. When one of them drags a TP onto your position, you&apos;ll see it here.
              </p>
              <button
                type="button"
                onClick={copyRoomLink}
                className="min-h-[44px] shrink-0 rounded-[6px] bg-accent px-3 py-1.5 text-[13px] font-medium text-page active:scale-[0.97] sm:min-h-0"
              >
                {copied ? "Copied" : canShare ? "Share room" : "Copy room link"}
              </button>
              {roomSharePath && (
                <>
                  <button
                    type="button"
                    data-share="x"
                    onClick={() => window.open(xPostUrl(ROOM_POST, `${window.location.origin}${roomSharePath}`), "_blank", "noopener")}
                    className="hidden shrink-0 rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-raised active:scale-[0.97] sm:inline-block"
                  >
                    Post on X
                  </button>
                  <button
                    type="button"
                    data-share="telegram"
                    onClick={() => window.open(telegramShareUrl(ROOM_POST, `${window.location.origin}${roomSharePath}`), "_blank", "noopener")}
                    className="hidden shrink-0 rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-raised active:scale-[0.97] sm:inline-block"
                  >
                    Telegram
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={dismissHint}
                aria-label="Dismiss the share hint"
                className="min-h-[44px] shrink-0 rounded-[6px] px-2 py-1.5 text-[13px] text-muted hover:text-ink sm:min-h-0"
              >
                <span aria-hidden className="text-[16px] leading-none sm:hidden">×</span>
                <span className="hidden sm:inline">Dismiss</span>
              </button>
            </div>
          )}
        <div
          ref={wrap}
          className="relative order-1 h-[40vh] min-h-[320px] rounded-[10px] border border-edge bg-panel sm:order-none sm:h-[60vh] sm:max-h-[70vh] sm:min-h-[420px]"
          onPointerDown={onChartPointerDown}
          onPointerMove={onChartPointerMove}
          onPointerUp={endChartDrag}
          onPointerCancel={endChartDrag}
          style={{ cursor: dragging.current ? "grabbing" : hoverLine || hoverGhost ? "ns-resize" : undefined, touchAction: "pan-x pan-y" }}
        >
          <div ref={box} className="absolute inset-0" />
          {toast && (
            <p role="status" className="num absolute left-1/2 top-2 z-20 max-w-[calc(100%-16px)] -translate-x-1/2 truncate rounded-[6px] border border-edge bg-raised px-2.5 py-1.5 text-[12px] text-ink">
              {toast}
            </p>
          )}
          {/* PnL marker for the selected trader. On-chart entries keep the
              clipped wash band; an entry off-screen would stretch that wash
              from the mark to the chart edge, so it becomes a 6px bar at the
              right edge of the plot area instead, solid in gain/loss. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f) return null;
              // A band for every trader stacks into one wash over the candles; show
              // it only for the trader being inspected.
              if (o.account !== selected?.account) return null;
              if (o.bandHeight <= 0) return null;
              const gain = f.unrealizedPnl >= 0;
              const wash = gain ? CHART.up : CHART.down;
              if (o.mode !== "candle") {
                const barStyle =
                  o.mode === "top"
                    ? { left: o.right - 6, width: 6, top: 0, height: Math.max(0, o.markY) }
                    : { left: o.right - 6, width: 6, top: Math.max(0, o.markY), bottom: 0 };
                return (
                  <div
                    key={`band-${o.account}`}
                    className="absolute"
                    style={{ ...barStyle, background: wash }}
                  />
                );
              }
              return (
                <div key={`band-${o.account}`} className="absolute" style={{ left: o.bandLeft, width: Math.max(0, o.right - o.bandLeft), top: o.bandTop, height: o.bandHeight }}>
                  <div className="absolute inset-0" style={{ background: wash, opacity: 0.12 }} />
                </div>
              );
            })}
          </div>
          {/* Fren faces ON the chart at each entry. The layer is decorative;
              only the face buttons take events. Faces within 14px cluster
              with an overlap offset; more than 5 collapse into a +N circle. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {faceClusters.map((c) =>
              c.collapsed ? (
                <div
                  key={`cluster-${c.key}`}
                  className="marker-anim absolute left-0 top-0"
                  style={{ transform: `translate(${c.x - FACE_SIZE / 2}px, ${c.y - FACE_SIZE / 2}px)` }}
                >
                  <button
                    onClick={() => selectStrongest(c.members)}
                    aria-label={`${c.members.length} frens entered here. Show the strongest position.`}
                    title={`${c.members.length} frens entered here`}
                    className="num pointer-events-auto flex items-center justify-center rounded-full bg-raised text-[11px] font-medium text-ink"
                    style={{ width: FACE_SIZE, height: FACE_SIZE, boxShadow: `0 0 0 2px ${CHART.page}` }}
                  >
                    +{c.members.length}
                  </button>
                </div>
              ) : (
                c.members.map((m) => {
                  const f = friends.find((x) => x.account === m.account);
                  if (!f) return null;
                  const dim = active !== null && active !== m.account;
                  const raised = hover === m.account || active === m.account;
                  const rec = recFor(m.account);
                  return (
                    <div
                      key={`face-${m.account}`}
                      className="marker-anim absolute left-0 top-0"
                      style={{
                        transform: `translate(${c.x + m.dx - FACE_SIZE / 2}px, ${c.y - FACE_SIZE / 2}px)`,
                        zIndex: raised ? 4 : 3,
                      }}
                    >
                      <button
                        onMouseEnter={() => setHover(m.account)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(m.account)}
                        onBlur={() => setHover(null)}
                        onClick={() => setActive(active === m.account ? null : m.account)}
                        aria-pressed={active === m.account}
                        aria-label={`${display(f.account)} ${f.side} entry ${formatPrice(f.entryPrice, decimals)}`}
                        className="pointer-events-auto block rounded-full"
                      >
                        <Face address={f.account} side={f.side} dim={dim} dot={(rec?.accepted ?? 0) > 0} />
                      </button>
                    </div>
                  );
                })
              ),
            )}
          </div>
          {/* Edge markers for entries outside the visible range: the fren's
              face pinned to the right edge, just left of the price scale, with
              an arrow and the entry price, so off-screen entries never stretch
              the scale and never cover the TP/SL labels on the left. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f || o.mode === "candle" || o.avatarX === null) return null;
              const arrow = o.mode === "top" ? "↑" : "↓";
              const dim = active !== null && active !== o.account;
              const rec = recFor(o.account);
              return (
                <div
                  key={`edge-${o.account}`}
                  className="absolute z-[3]"
                  style={{ left: o.avatarX - FACE_SIZE / 2, top: o.avatarY - FACE_SIZE / 2 }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="num pointer-events-none rounded-[6px] bg-raised px-1.5 py-0.5 text-[11px] text-muted">
                      {arrow} {formatPrice(f.entryPrice, decimals)}
                    </span>
                    <button
                      onMouseEnter={() => setHover(o.account)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(o.account)}
                      onBlur={() => setHover(null)}
                      onClick={() => setActive(active === o.account ? null : o.account)}
                      aria-pressed={active === o.account}
                      aria-label={`${display(f.account)} entry ${formatPrice(f.entryPrice, decimals)} ${o.mode === "top" ? "above" : "below"} the visible range`}
                      className="pointer-events-auto block rounded-full"
                    >
                      <Face address={f.account} side={f.side} dim={dim} dot={(rec?.accepted ?? 0) > 0} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* TP/SL floating tags glide with the lines. Decorative. */}
          {selected && tp !== null && tpY !== null && (
            <div
              className="marker-anim num pointer-events-none absolute left-8 z-10 rounded-[6px] border border-edge bg-raised px-2 py-1 text-[11px]"
              style={{ transform: `translateY(${tpY - 13}px)`, top: 0, borderColor: CHART.up, transition: reducedMotion ? "none" : undefined }}
            >
              TP {formatPrice(tp, decimals)} · {formatUsd(pnlAtPrice(tp, selected.entryPrice, selected.size, selected.side))}
            </div>
          )}
          {selected && sl !== null && slY !== null && (
            <div
              className="marker-anim num pointer-events-none absolute left-8 z-10 rounded-[6px] border border-dashed bg-raised px-2 py-1 text-[11px]"
              style={{ transform: `translateY(${slY - 13}px)`, top: 0, borderColor: CHART.down, transition: reducedMotion ? "none" : undefined }}
            >
              SL {formatPrice(sl, decimals)} · {formatUsd(pnlAtPrice(sl, selected.entryPrice, selected.size, selected.side))}
            </div>
          )}
          {/* Grip circles at the left end of each TP/SL line: the visible drag
              handle. Each grip is a button so it keeps keyboard and touch. */}
          {selected && tp !== null && tpY !== null && (
            <button
              data-drag-kind="tp"
              onKeyDown={(e) => onLineKeyDown("tp", e)}
              onFocus={() => setFocusKind("tp")}
              aria-label={`Drag take-profit line at ${formatPrice(tp, decimals)}. Arrow keys nudge by one tick. Escape resets.`}
              className="marker-anim absolute left-2 z-10 flex cursor-ns-resize items-center justify-center rounded-full"
              style={{ transform: `translateY(${tpY - 14}px)`, top: 0, width: 28, height: 28, transition: reducedMotion ? "none" : undefined }}
            >
              <span className="block h-[10px] w-[10px] rounded-full border-2 bg-page" style={{ borderColor: CHART.up }} />
            </button>
          )}
          {selected && sl !== null && slY !== null && (
            <button
              data-drag-kind="sl"
              onKeyDown={(e) => onLineKeyDown("sl", e)}
              onFocus={() => setFocusKind("sl")}
              aria-label={`Drag stop-loss line at ${formatPrice(sl, decimals)}. Arrow keys nudge by one tick. Escape resets.`}
              className="marker-anim absolute left-2 z-10 flex cursor-ns-resize items-center justify-center rounded-full"
              style={{ transform: `translateY(${slY - 14}px)`, top: 0, width: 28, height: 28, transition: reducedMotion ? "none" : undefined }}
            >
              <span className="block h-[10px] w-[10px] rounded-full border-2 border-dashed bg-page" style={{ borderColor: CHART.down }} />
            </button>
          )}
          {/* Ghost suggestion: the caller's face sits ON the dashed line at
              its left end and drags it to a counter price. The pill names the
              caller with the live TP price and signed PnL; Accept and Pass
              resolve right on the chart, and the banner mirrors all three. */}
          {incoming && ghostPrice !== null && ghostY !== null && (
            <button
              data-drag-kind="ghost"
              disabled={ghostAccepted !== null}
              onKeyDown={onGhostKeyDown}
              aria-label={`Suggested ${incoming.kind === "sl" ? "stop-loss" : "take-profit"} at ${formatPrice(ghostPrice, decimals)} from ${display(incoming.from)}. Drag to counter, arrow keys nudge by one tick. Escape resets.`}
              className="marker-anim absolute left-2 z-10 block cursor-ns-resize rounded-full disabled:cursor-default"
              style={{ transform: `translateY(${ghostY - 14}px)`, top: 0, width: 28, height: 28, transition: reducedMotion ? "none" : undefined }}
            >
              <Face address={incoming.from} side={incoming.side} dot={(recFor(incoming.from)?.accepted ?? 0) > 0} />
            </button>
          )}
          {incoming && ghostPrice !== null && ghostY !== null && (
            <div
              className="marker-anim num pointer-events-none absolute left-12 z-10 rounded-[6px] border bg-raised px-2 py-1 text-[11px]"
              style={{ transform: `translateY(${ghostY - 13}px)`, top: 0, borderColor: ghostColour, transition: reducedMotion ? "none" : undefined }}
            >
              {ghostLabel}
            </div>
          )}
          {incoming && ghostPrice !== null && ghostY !== null && (
            <div
              className="absolute left-12 z-10 flex gap-1.5"
              // Below the line by default; above it when below would land on the volume strip (bottom 14%).
              style={{
                transform: `translateY(${ghostY + 18 + 44 > (box.current?.clientHeight ?? Infinity) * 0.86 ? ghostY - 54 : ghostY + 18}px)`,
                top: 0,
              }}
            >
              {ghostAccepted === null && (
                <button
                  type="button"
                  data-nodrag
                  onClick={() => setAcceptReq((r) => r + 1)}
                  aria-label={`Accept the suggestion at ${formatPrice(ghostPrice, decimals)}`}
                  className="min-h-[36px] rounded-[6px] bg-accent px-3.5 py-1 text-[13px] font-medium text-page active:scale-[0.97] sm:min-h-0 sm:px-2.5 sm:text-[12px]"
                >
                  Accept
                </button>
              )}
              <button
                type="button"
                data-nodrag
                onClick={() => setPassReq((r) => r + 1)}
                aria-label="Pass on this suggestion"
                className="min-h-[36px] rounded-[6px] border border-edge bg-panel px-3.5 py-1 text-[13px] font-medium hover:bg-raised active:scale-[0.97] sm:min-h-0 sm:px-2.5 sm:text-[12px]"
              >
                Pass
              </button>
            </div>
          )}
          {/* Volume label, top-left of the footer strip: the last candle's
              volume from the candles API field v. Decorative. */}
          {lastVolume !== null && (
            <p className="num pointer-events-none absolute left-3 z-10 text-[11px] text-muted" style={{ bottom: "calc(14% - 20px)" }}>
              Volume {lastVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </p>
          )}
          {/* Copy confirm popover. The one interactive panel on the chart. */}
          {copyFriend && market && (
            <div
              role="dialog"
              aria-label={`Copy ${display(copyFriend.account)}`}
              data-nodrag
              className="absolute right-2 top-2 z-20 w-[min(280px,calc(100%-16px))] rounded-[10px] border border-edge bg-raised p-3 text-[13px]"
              onKeyDown={(e) => {
                if (e.key === "Escape") setCopyFor(null);
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="font-[family-name:var(--font-display)] text-[14px] font-bold">
                  Copy <span style={{ color: ring(copyFriend) }}>{display(copyFriend.account)}</span>{" "}
                  <span className="text-muted">{copyFriend.side === "long" ? "LONG" : "SHORT"} {market.name}</span>
                </p>
                <button onClick={() => setCopyFor(null)} aria-label="Close copy dialog" className="px-2 py-1 text-[12px] text-muted hover:text-ink">Close</button>
              </div>
              <p className="num mb-2 text-[12px] text-muted">
                Mark <span className="text-ink">{formatPrice(copyFriend.markPrice, decimals)}</span>
              </p>
              <label htmlFor="copy-size" className="mb-1 block text-[12px] font-medium">Your size (base units)</label>
              <input
                id="copy-size"
                autoFocus
                inputMode="decimal"
                value={copySize}
                onChange={(e) => setCopySize(e.target.value)}
                placeholder={String(copyFriend.size)}
                className="num mb-2 w-full rounded-[6px] border border-edge bg-page px-2.5 py-2 text-[12px]"
              />
              <label htmlFor="copy-slip" className="mb-1 block text-[12px] font-medium">Max slippage (bps)</label>
              <input
                id="copy-slip"
                inputMode="numeric"
                value={copySlip}
                onChange={(e) => setCopySlip(e.target.value)}
                placeholder="50"
                className="num mb-3 w-full rounded-[6px] border border-edge bg-page px-2.5 py-2 text-[12px]"
              />
              <button
                onClick={doCopy}
                disabled={copyResult.kind === "sending"}
                className="w-full rounded-[6px] bg-accent px-3 py-2 text-[13px] font-medium text-page active:scale-[0.97] disabled:opacity-40"
              >
                {copyResult.kind === "sending" ? "Waiting for wallet" : "Copy with wallet"}
              </button>
              <div className="mt-2">
                <PasskeyWallet account={passkey} onAccount={setPasskey} onFunded={setPasskeyFunded} idPrefix="copy" network={net} />
              </div>
              {passkey && passkeyFunded && (
                <button
                  onClick={doCopyWithPasskey}
                  disabled={copyResult.kind === "sending"}
                  className="mt-2 w-full rounded-[6px] border border-edge px-3 py-2 text-[13px] font-medium hover:bg-panel active:scale-[0.97] disabled:opacity-40"
                >
                  {copyResult.kind === "sending"
                    ? "Waiting for passkey"
                    : `Copy ${copyFriend.side === "long" ? "long" : "short"} with passkey`}
                </button>
              )}
              {copyResult.kind === "ok" && (
                <p className="num mt-2 break-all text-[12px] text-gain">
                  Sent. <a className="underline" href={explorerTxUrl(net, copyResult.hash)} target="_blank" rel="noreferrer">View on the {net === "mainnet" ? "MonadVision" : "testnet"} explorer</a>
                </p>
              )}
              {copyResult.kind === "needs-account" && (
                <div data-needs-account className="mt-2 flex flex-col gap-2 text-[12px]">
                  <p className="text-muted">
                    Perpl has no account for this wallet yet. Deposit aUSD to open one
                    {depositFloor !== null ? ` (Perpl's minimum is ${depositFloor} aUSD)` : ""}; the copy goes through right after.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value)}
                      inputMode="decimal"
                      aria-label="Deposit in aUSD"
                      className="num w-20 rounded-[6px] border border-edge bg-panel px-2 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => depositThenCopy(copyResult.signer)}
                      className="rounded-[6px] bg-accent px-3 py-1.5 font-medium text-page active:scale-[0.97]"
                    >
                      Deposit {deposit} aUSD and copy
                    </button>
                  </div>
                  <TestFunds
                    network={net}
                    address={copyResult.signer === "passkey" ? (passkey?.address ?? null) : walletAddr}
                    send={(to, data) => (copyResult.signer === "passkey" && passkey ? sendExecOrderWith(passkey, to, data, net) : sendExecOrder(to, data, net))}
                  />
                </div>
              )}
              {copyResult.kind === "error" && (
                <p className="mt-2 text-[12px] text-loss">{copyResult.message}</p>
              )}
            </div>
          )}
          {/* Hover card for the inspected fren: face, side pill, size, entry
              and live PnL, with Call exit (selects the fren and shows their
              TP/SL drag lines) and Copy (opens the copy popover). Tapping a
              face selects it so the card stays put on touch. */}
          {selected && (
            <div
              data-nodrag
              className="absolute left-3 top-3 z-10 w-[240px] rounded-[10px] border border-edge bg-raised p-3"
              onMouseEnter={() => setHover(selected.account)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex items-center gap-2.5">
                <Face address={selected.account} side={selected.side} dot={(selectedRec?.accepted ?? 0) > 0} />
                <div className="min-w-0">
                  <p className="num text-[13px] font-medium leading-tight">{display(selected.account)}</p>
                  <span
                    className="num mt-1 inline-block rounded border px-1.5 py-px text-[10px] font-medium"
                    style={{ color: ring(selected), borderColor: ring(selected) }}
                  >
                    {selected.side === "long" ? "LONG" : "SHORT"}
                  </span>
                </div>
                <span
                  className="num ml-auto text-[13px]"
                  style={{ color: selected.unrealizedPnl >= 0 ? CHART.up : CHART.down }}
                >
                  {formatUsd(selected.unrealizedPnl)}
                </span>
              </div>
              <dl className="num mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-muted">Size</dt><dd className="text-right">{selected.size}</dd>
                <dt className="text-muted">Entry</dt><dd className="text-right">{formatPrice(selected.entryPrice, decimals)}</dd>
              </dl>
              {selectedLine && (
                <p className="num mt-1.5 text-[12px] text-muted">{selectedLine}</p>
              )}
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  data-nodrag
                  onClick={() => setActive(selected.account)}
                  className="min-h-[44px] flex-1 rounded-[6px] bg-accent px-3 py-1.5 text-[13px] font-medium text-page active:scale-[0.97] sm:min-h-0"
                >
                  Call exit
                </button>
                <button
                  type="button"
                  data-nodrag
                  onClick={() => openCopy(selected.account)}
                  className="min-h-[44px] flex-1 rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-panel active:scale-[0.97] sm:min-h-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          {candles.state === "loading" && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-[14px] text-muted">Loading candles from Perpl</p>
          )}
          {candles.state === "error" && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-[14px] text-loss">
              Could not load candles: {candles.message}
            </p>
          )}
        </div>
        </div>

        <aside aria-label={view === "live" ? "Live on Perpl" : "In the room"} className="flex flex-col gap-4">
          {/* Trader source: live Perpl openers sit on the candles at entry
              time; My frens keeps the saved room behaviour. */}
          <div role="group" aria-label="Trader source" className="flex rounded-[6px] border border-edge">
            {(
              [
                { id: "live", label: "Live on Perpl" },
                { id: "frens", label: "My frens" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                aria-pressed={view === t.id}
                className={`flex-1 px-3 py-1.5 text-[12px] ${view === t.id ? "rounded-[6px] bg-raised text-ink" : "text-muted hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-baseline justify-between border-b border-edge pb-2">
            <h2 className="font-[family-name:var(--font-display)] text-[20px] font-bold">{view === "live" ? "Live on Perpl" : "In the room"}</h2>
            <span className="num text-[12px] text-muted">by unrealised PnL</span>
          </div>
          {showRoomBuilder ? (
            <RoomBuilder net={net} />
          ) : (
          <>
          {view === "frens" && room.state === "loading" && <p className="text-[14px] text-muted">Reading positions from the Exchange contract</p>}
          {view === "frens" && room.state === "error" && <p className="text-[14px] text-loss">Could not read positions: {room.message}</p>}
          {view === "frens" && room.state === "ready" && friends.length === 0 && (
            <p className="text-[14px] text-muted">
              Nobody in the room holds {market?.name ?? "this market"} right now. Try another market, or add a trader below.
            </p>
          )}
          {view === "live" && live.state === "loading" && <p className="text-[14px] text-muted">Reading recent Perpl positions</p>}
          {view === "live" && live.state === "error" && <p className="text-[14px] text-loss">Could not read live positions: {live.message}</p>}
          {view === "live" && live.state === "ready" && friends.length === 0 && (
            <p className="text-[14px] text-muted">
              Nobody opened {market?.name ?? "this market"} on Perpl in the last {live.data.hours} hours.{" "}
              {net === "testnet" ? (
                <a data-demo-room href={DEMO_ROOM} className="font-medium text-accent underline underline-offset-2">
                  See a room where a fren's call is waiting
                </a>
              ) : (
                "Try another market."
              )}
            </p>
          )}
          <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {friends.map((f) => {
              const chip = chipFor(f, decimals, display(f.account));
              const on = active === f.account;
              const rec = recFor(f.account);
              const line = rec ? callLine(rec.accepted, rec.hit) : null;
              const restingCall = receiptCalls.find(
                (c) => c.resting && c.price !== null && c.market === marketId && c.owner.toLowerCase() === f.account.toLowerCase(),
              );
              return (
                <li key={f.account} className="min-w-[210px] lg:min-w-0">
                  <button
                    onClick={() => setActive(on ? null : f.account)}
                    aria-pressed={on}
                    className="num flex w-full items-center gap-2.5 rounded-[10px] border bg-panel p-2.5 text-left text-[13px] hover:bg-raised"
                    style={{ borderColor: on ? CHART.accent : CHART.edge }}
                  >
                    <Face address={f.account} side={f.side} dot={(rec?.accepted ?? 0) > 0} />
                    <span className="min-w-0">
                      <span className="block font-medium">{chip.label}</span>
                      <span
                        className="mt-0.5 inline-block rounded border px-1.5 py-px text-[10px] font-medium"
                        style={{ color: ring(f), borderColor: ring(f) }}
                      >
                        {chip.side}
                      </span>
                      {line && <span className="mt-0.5 block text-[11px] text-muted">{line}</span>}
                      {restingCall && (
                        <span data-resting-call className="mt-0.5 block text-[11px] text-gain">
                          TP {formatPrice(restingCall.price as number, decimals)} from {display(restingCall.caller)} · resting on Perpl
                          {restingCall.stake?.state === "open" ? ` · ${restingCall.stake.amount} aUSD staked` : ""}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto" style={{ color: chip.inProfit ? CHART.up : CHART.down }}>{chip.pnl}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <section aria-label="Suggest TP or SL" className="flex flex-col gap-2 border-t border-edge pt-4">
            <h3 className="font-[family-name:var(--font-display)] text-[16px] font-bold">Suggest TP or SL</h3>
            {!selected && (
              <p className="text-[13px] text-muted">Select a trader to drag TP and SL lines for them.</p>
            )}
            {selected && tp !== null && sl !== null && (
              <>
                <p className="text-[13px] text-muted">
                  For {display(selected.account)}, {selected.side === "long" ? "Long" : "Short"} in at{" "}
                  <span className="num">{formatPrice(selected.entryPrice, decimals)}</span>. Drag the lines on the
                  chart, or focus one below and use arrow keys. Escape resets.
                </p>
                <div className="flex gap-2">
                  {(["tp", "sl"] as SuggestKind[]).map((kind) => {
                    const price = kind === "tp" ? tp : sl;
                    const pnl = pnlAtPrice(price, selected.entryPrice, selected.size, selected.side);
                    const on = suggestKind === kind;
                    return (
                      <button
                        key={kind}
                        onClick={() => {
                          setFocusKind(kind);
                          setSuggestKind(kind);
                        }}
                        onFocus={() => setFocusKind(kind)}
                        onKeyDown={(e) => onLineKeyDown(kind, e)}
                        aria-pressed={on}
                        aria-label={`${kind === "tp" ? "Take profit" : "Stop loss"} line at ${formatPrice(price, decimals)}, ${formatUsd(pnl)}. Arrow keys nudge by one tick. Escape resets.`}
                        className="num flex-1 rounded-[6px] border px-2.5 py-2 text-left text-[12px] hover:bg-raised"
                        style={{
                          borderColor: kind === "tp" ? CHART.up : CHART.down,
                          outline: focusKind === kind ? `2px solid ${kind === "tp" ? CHART.up : CHART.down}` : undefined,
                          background: on ? CHART.raised : undefined,
                        }}
                      >
                        <span className="block font-medium">{kind === "tp" ? "TP" : "SL"} {formatPrice(price, decimals)}</span>
                        <span className="block" style={{ color: pnl >= 0 ? CHART.up : CHART.down }}>
                          {formatUsd(pnl)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="num text-[12px] text-muted">
                  Suggesting {suggestKind === "tp" ? "TP" : "SL"} at{" "}
                  {suggestPrice !== null ? formatPrice(suggestPrice, decimals) : "…"}
                  {suggestPnl !== null ? ` (${formatUsd(suggestPnl)})` : ""}. PnL from the room position.
                </p>
                <label htmlFor="viewer" className="text-[13px] font-medium">Your address</label>
                <input
                  id="viewer"
                  value={viewer}
                  onChange={(e) => onViewerChange(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  className="num min-w-0 flex-1 rounded-[6px] border border-edge bg-panel px-2.5 py-2 text-[12px]"
                />
                {viewerError && <p className="text-[12px] text-loss">{viewerError}</p>}
                {viewerOk && suggestPayload ? (
                  <button
                    type="button"
                    onClick={copySuggestLink}
                    title="Copy a link with this suggestion"
                    className="rounded-[6px] border border-edge px-3 py-2 text-[13px] font-medium hover:bg-raised active:scale-[0.97]"
                  >
                    {copiedSuggest ? "Copied" : "Copy suggestion link"}
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] text-muted">Your address goes on the call, so it is credited to you when they take it. Nothing is signed.</p>
                    <button
                      type="button"
                      data-call-wallet
                      onClick={() => connectWallet(net).then(onViewerChange, (e) => setViewerError(e instanceof Error ? e.message : String(e)))}
                      className="rounded-[6px] border border-edge px-3 py-2 text-[13px] font-medium hover:bg-raised active:scale-[0.97]"
                    >
                      Use browser wallet
                    </button>
                    <PasskeyWallet account={passkey} onAccount={(a) => { setPasskey(a); if (a) onViewerChange(a.address); }} onFunded={setPasskeyFunded} idPrefix="call" network={net} />
                  </div>
                )}
              </>
            )}
          </section>
          {view === "frens" && (
          <form onSubmit={addTrader} className="mt-auto flex flex-col gap-2 border-t border-edge pt-4">
            <label htmlFor="add" className="text-[13px] font-medium">Add a fren by address</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="add"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="num min-w-0 basis-full rounded-[6px] border border-edge bg-panel px-2.5 py-2 text-[12px]"
              />
              <input
                id="fren-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="name"
                spellCheck={false}
                maxLength={24}
                aria-label="Nickname for this fren"
                className="min-w-0 flex-1 rounded-[6px] border border-edge bg-panel px-2.5 py-2 text-[12px]"
              />
              <button className="rounded-[6px] bg-accent px-3 text-[13px] font-medium text-page active:scale-[0.97]">Add</button>
              <button
                type="button"
                onClick={copyRoomLink}
                disabled={extra.length === 0}
                title={extra.length === 0 ? "Add a trader first, then share the room" : "Copy a link to this room"}
                className="rounded-[6px] border border-edge px-3 text-[13px] font-medium hover:bg-raised active:scale-[0.97] disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy room link"}
              </button>
            </div>
            {draftError && <p className="text-[12px] text-loss">{draftError}</p>}
          </form>
          )}
          </>
          )}
        </aside>
      </main>

      <footer className="mt-6 border-t border-edge pt-3 text-[12px] text-muted">
        {view === "live" ? "Live traders opened" : "Positions read"} from Perpl&apos;s Exchange contract{" "}
        <span className="num">{EXCHANGE.slice(0, 6)}…{EXCHANGE.slice(-4)}</span> on {chainName}
        {view === "live"
          ? live.state === "ready" && <> at block <span className="num">{Number(live.data.block).toLocaleString("en-US")}</span>, last {live.data.hours} hours</>
          : room.state === "ready" && <> at block <span className="num">{Number(room.data.block).toLocaleString("en-US")}</span></>}. Calls and copies are orders you sign from your own wallet.
        Candles from Perpl&apos;s public market data.
      </footer>
    </div>
  );
}
