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
import { assignColours, avatarLabel, byPnl, candleChange, chipFor, colourFor, formatPrice, formatUsd, placeAvatar, shortName, sideCounts, stackChips, visiblePriceRange, volumeColorFor, type Candle, type Friend } from "@/lib/chart";
import { clampTpSl, initialTpSl, nudgePrice, pnlAtPrice, priceFromY, validTpSl, type SuggestKind } from "@/lib/drag";
import { encodeCopyOrder, toCopyOrder } from "@/lib/copy";
import { encodeRoom } from "@/lib/roomlink";
import { encodeSuggestion, type Suggestion } from "@/lib/suggest";
import { connect, sendExecOrder } from "@/lib/wallet";
import { SuggestionBanner } from "./SuggestionBanner";

type Market = { id: number; name: string; priceDecimals: number; lotDecimals: number };
type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const TIMEFRAMES = [
  { label: "15m", res: 900 },
  { label: "1h", res: 3600 },
  { label: "4h", res: 14400 },
  { label: "1d", res: 86400 },
];
const EXCHANGE = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F";
const MONAD_VISION = "https://monadvision.com/tx";
const CHIP_H = 30;
const AVATAR = 22;
const AVATAR_GAP = AVATAR + 4;

type Overlay = {
  account: string;
  chipY: number;
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

type CopyResult = { kind: "idle" } | { kind: "sending" } | { kind: "ok"; hash: string } | { kind: "error"; message: string };

/// The chart library parses colours itself and rejects CSS color-mix(), which the
/// page tokens use. So the chart gets concrete values computed from the same
/// DESIGN.md hexes: ink #1C1B19 at the token's mix ratios over surface #F3EFE6.
const CHART = {
  ink: "#1C1B19",
  surface: "#F3EFE6",
  accent: "#2F5BEA",
  muted: "rgba(28, 27, 25, 0.62)",
  rule: "rgba(28, 27, 25, 0.14)",
  grid: "rgba(28, 27, 25, 0.03)",
  upWash: "#DCEEDD",
  downWash: "#F6DCD3",
};

export function ChartRoom({ initialAccounts, viewerAddress }: { initialAccounts?: string[]; viewerAddress?: string }) {
  const [markets, setMarkets] = useState<Load<Market[]>>({ state: "loading" });
  const [marketId, setMarketId] = useState(1);
  const [res, setRes] = useState(3600);
  const [candles, setCandles] = useState<Load<Candle[]>>({ state: "loading" });
  const [room, setRoom] = useState<Load<{ friends: Friend[]; block: string; checked: number }>>({ state: "loading" });
  const [extra, setExtra] = useState<string[]>(initialAccounts ?? []);
  const [draft, setDraft] = useState("");
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
  const [incoming, setIncoming] = useState<Suggestion | null>(null);

  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const tpLine = useRef<IPriceLine | null>(null);
  const slLine = useRef<IPriceLine | null>(null);
  const sugLine = useRef<IPriceLine | null>(null);
  const dragging = useRef<SuggestKind | null>(null);

  const market = markets.state === "ready" ? markets.data.find((m) => m.id === marketId) : undefined;
  const decimals = market?.priceDecimals ?? 2;
  const friends = useMemo(() => (room.state === "ready" ? byPnl(room.data.friends) : []), [room]);
  const palette = useMemo(() => assignColours(friends.map((f) => f.account)), [friends]);
  const hue = (a: string) => palette.get(a.toLowerCase()) ?? colourFor(a);
  const lastClose = candles.state === "ready" && candles.data.length ? candles.data[candles.data.length - 1].close : null;
  const counts = useMemo(() => sideCounts(friends), [friends]);
  const copyFriend = copyFor ? friends.find((f) => f.account === copyFor) ?? null : null;

  // Markets once.
  useEffect(() => {
    fetch("/api/markets")
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => setMarkets(ok ? { state: "ready", data: body.markets } : { state: "error", message: body.error }))
      .catch((e) => setMarkets({ state: "error", message: String(e) }));
  }, []);

  // Candles per market and timeframe.
  useEffect(() => {
    setCandles({ state: "loading" });
    fetch(`/api/candles?market=${marketId}&res=${res}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => setCandles(ok ? { state: "ready", data: body.candles } : { state: "error", message: body.error }))
      .catch((e) => setCandles({ state: "error", message: String(e) }));
  }, [marketId, res]);

  // Positions per market and room.
  useEffect(() => {
    setRoom({ state: "loading" });
    const q = extra.length ? `&accounts=${extra.join(",")}` : "";
    fetch(`/api/positions?market=${marketId}${q}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => setRoom(ok ? { state: "ready", data: body } : { state: "error", message: body.error }))
      .catch((e) => setRoom({ state: "error", message: String(e) }));
  }, [marketId, extra]);

  // The chart itself, created once.
  useEffect(() => {
    if (!box.current) return;
    const ink = CHART.ink;
    const surface = CHART.surface;
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
      rightPriceScale: { borderColor: CHART.rule, scaleMargins: { top: 0.12, bottom: 0.18 } },
      timeScale: { borderColor: CHART.rule, timeVisible: true, rightOffset: 14 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    // Candles in the DESIGN.md washes with ink borders and wicks. The last
    // price draws a dotted line with a solid accent pill: the one accent on
    // the chart, reserved for the viewer's own price.
    const s = c.addSeries(CandlestickSeries, {
      upColor: CHART.upWash,
      borderUpColor: ink,
      wickUpColor: ink,
      downColor: CHART.downWash,
      borderDownColor: ink,
      wickDownColor: ink,
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

  // Where every friend's chip, line and band sit, from the chart's own coordinates.
  // The price scale fits the candles plus the selected TP/SL only: friend
  // entries never stretch it. Entries outside the visible range pin to the
  // top or bottom edge via placeAvatar.
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
      }),
    );
    const candleIdx: number[] = [];
    const topIdx: number[] = [];
    const bottomIdx: number[] = [];
    placedAll.forEach((p, i) => {
      if (p.mode === "candle") candleIdx.push(i);
      else if (p.mode === "top") topIdx.push(i);
      else bottomIdx.push(i);
    });
    const candleStack = stackChips(
      candleIdx.map((i) => placedAll[i].y - CHIP_H / 2),
      CHIP_H + 4,
    );
    const candleAvatarStack = stackChips(
      candleIdx.map((i) => placedAll[i].y - AVATAR / 2),
      AVATAR_GAP,
    );
    const byIndex = new Map<string, { chipY: number; avatarX: number | null; avatarY: number; mode: "candle" | "top" | "bottom" }>();
    candleIdx.forEach((fi, k) => {
      byIndex.set(friends[fi].account, {
        chipY: candleStack[k],
        avatarX: placedAll[fi].x,
        avatarY: candleAvatarStack[k],
        mode: "candle",
      });
    });
    topIdx.forEach((fi, k) => {
      byIndex.set(friends[fi].account, {
        chipY: 4 + k * (CHIP_H + 4),
        avatarX: null,
        avatarY: 4 + AVATAR / 2 + k * (CHIP_H + 4),
        mode: "top",
      });
    });
    bottomIdx.forEach((fi, k) => {
      byIndex.set(friends[fi].account, {
        chipY: height - CHIP_H - 4 - k * (CHIP_H + 4),
        avatarX: null,
        avatarY: height - AVATAR / 2 - 4 - k * (CHIP_H + 4),
        mode: "bottom",
      });
    });
    setOverlays(
      friends.map((f) => {
        const pos = byIndex.get(f.account) ?? { chipY: 0, avatarX: null, avatarY: 0, mode: "candle" as const };
        const entryY = priceToY(f.entryPrice) ?? (pos.mode === "top" ? -10 : height + 10);
        const markY = priceToY(f.markPrice) ?? entryY;
        const markStart = Math.max(f.entryTime ?? first, first) as UTCTimestamp;
        const bandX = timeToX(markStart) ?? 0;
        // Clip the PnL band to the visible price range so it never washes the
        // whole chart when the entry sits far outside the candles.
        const lo = Math.max(Math.min(f.entryPrice, f.markPrice), viewMin);
        const hi = Math.min(Math.max(f.entryPrice, f.markPrice), viewMax);
        let bandTop = Math.min(entryY, markY);
        let bandHeight = Math.max(1, Math.abs(entryY - markY));
        if (hi > lo) {
          const yHi = priceToY(hi) ?? bandTop;
          const yLo = priceToY(lo) ?? bandTop + bandHeight;
          bandTop = Math.min(yHi, yLo);
          bandHeight = Math.max(1, Math.abs(yHi - yLo));
        } else {
          bandHeight = 0;
        }
        return {
          account: f.account,
          entryY,
          markY,
          chipY: pos.chipY,
          avatarX: pos.avatarX,
          avatarY: pos.avatarY,
          bandLeft: bandX,
          bandTop,
          bandHeight,
          right,
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
  // Each line takes the selected friend's hue with a filled axis pill: TP
  // solid, SL dashed.
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
    const colour = hue(selected.account);
    const tpTitle = `TP ${formatPrice(tp, decimals)} (${formatUsd(pnlAtPrice(tp, selected.entryPrice, selected.size, selected.side))})`;
    const slTitle = `SL ${formatPrice(sl, decimals)} (${formatUsd(pnlAtPrice(sl, selected.entryPrice, selected.size, selected.side))})`;
    if (!tpLine.current) {
      tpLine.current = s.createPriceLine({
        price: tp,
        color: colour,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        axisLabelColor: colour,
        axisLabelTextColor: CHART.surface,
        title: tpTitle,
      });
    } else {
      tpLine.current.applyOptions({ price: tp, color: colour, axisLabelColor: colour, axisLabelTextColor: CHART.surface, title: tpTitle });
    }
    if (!slLine.current) {
      slLine.current = s.createPriceLine({
        price: sl,
        color: colour,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        axisLabelColor: colour,
        axisLabelTextColor: CHART.surface,
        title: slTitle,
      });
    } else {
      slLine.current.applyOptions({ price: sl, color: colour, axisLabelColor: colour, axisLabelTextColor: CHART.surface, title: slTitle });
    }
    setTpY(s.priceToCoordinate(tp));
    setSlY(s.priceToCoordinate(sl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tp, sl, selected, decimals, overlays]);

  // A shared suggestion link draws its price on the chart in the suggester's
  // hue, dashed, with an axis pill naming who suggested it. The banner owns
  // the decode and validity check; this only draws what it approved.
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    if (sugLine.current) {
      s.removePriceLine(sugLine.current);
      sugLine.current = null;
    }
    if (!incoming) return;
    const colour = colourFor(incoming.from);
    sugLine.current = s.createPriceLine({
      price: incoming.price,
      color: colour,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: colour,
      axisLabelTextColor: CHART.surface,
      title: `suggested by ${shortName(incoming.from)}`,
    });
  }, [incoming]);

  // Price lines do not move the candle scale on their own, so a TP/SL
  // outside the candles' range would render off screen. The visible range
  // fits the candles plus the selected TP and SL only: friend entries never
  // stretch the scale (their lines opt out below).
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    if (!selected || tp === null || sl === null) {
      s.applyOptions({ autoscaleInfoProvider: undefined });
      return;
    }
    s.applyOptions({
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const info = base();
        const baseRange =
          info?.priceRange == null ? null : { min: info.priceRange.minValue, max: info.priceRange.maxValue };
        const range = visiblePriceRange(baseRange, tp, sl);
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
  }, [tp, sl, selected, candles, layout]);

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

  // Drag listeners live on the wrapping container, not on the chart box: the
  // box is the bottom layer and every overlay above it would otherwise steal
  // the pointer. Decorative overlays are pointer-events-none; only chips,
  // avatars, Copy buttons and grips take events, and grips restart the drag
  // through their data-drag-kind. Clamping still starts from the mark, per
  // lib/drag.ts.
  function onChartPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-nodrag]")) return;
    const grip = target.closest("[data-drag-kind]");
    if (target.closest("button") && !grip) return;
    const el = box.current;
    const s = series.current;
    const c = chart.current;
    if (!el || !s || !c || !selected || tp === null || sl === null) return;
    const y = e.clientY - el.getBoundingClientRect().top;
    const kind = ((grip?.getAttribute("data-drag-kind") as SuggestKind | null) ?? lineHit(y));
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

  function onViewerChange(v: string) {
    setViewer(v);
    const t = v.trim();
    if (t === "") setViewerError("");
    else if (!/^0x[0-9a-fA-F]{40}$/.test(t) || /^0x0+$/.test(t)) setViewerError("That is not a usable address.");
    else setViewerError("");
  }

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
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.account, selected?.side, suggestPrice, viewerOk, viewer, marketId]);

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
        ? `${window.location.origin}/r/${roomCodeForSuggest}?s=${suggestPayload}`
        : `${window.location.origin}/?s=${suggestPayload}`;
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
  async function doCopy() {
    if (!copyFriend || !market) return;
    setCopyResult({ kind: "sending" });
    try {
      const size = Number(copySize);
      const slip = Number(copySlip);
      const order = toCopyOrder(
        { market: marketId, side: copyFriend.side },
        { priceDecimals: BigInt(market.priceDecimals), lotDecimals: BigInt(market.lotDecimals) },
        { size, markPrice: copyFriend.markPrice, maxSlippageBps: slip, orderDescId: BigInt(Date.now()) },
      );
      const data = encodeCopyOrder(order);
      await connect();
      const hash = await sendExecOrder(EXCHANGE as Address, data);
      setCopyResult({ kind: "ok", hash });
    } catch (e) {
      setCopyResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

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
        // Friend entries never move the price scale: the candles plus the
        // selected TP/SL own the range, entries outside it pin to the edge.
        const l = c.addSeries(LineSeries, {
          color: dim ? `${hue(f.account)}40` : hue(f.account),
          lineWidth: active && !dim ? 3 : 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        });
        l.setData([
          { time: startTime as UTCTimestamp, value: f.entryPrice },
          { time: data[data.length - 1].time as UTCTimestamp, value: f.entryPrice },
        ]);
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
    setDraftError("");
    setExtra((x) => (x.includes(a.toLowerCase()) ? x : [...x, a.toLowerCase()]));
    setDraft("");
  }

  async function copyRoomLink() {
    try {
      const code = encodeRoom(extra);
      if (!code) return;
      await navigator.clipboard.writeText(`${window.location.origin}/r/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const hovered = friends.find((f) => f.account === hover);
  const totalSides = counts.long + counts.short;
  const lastVolume = candles.state === "ready" && candles.data.length ? candles.data[candles.data.length - 1].volume : null;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1480px] flex-col px-4 pb-6 md:px-8">
      {/* N9 edge-aligned nav: brand left, controls right, no centre links. */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule py-5">
        <div>
          <p className="font-[family-name:var(--font-display)] text-[20px] font-bold tracking-tight">Chartroom</p>
          <p className="text-[14px] text-muted">Your friends, on the chart.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Market" className="flex border border-ink">
            {markets.state === "ready" &&
              markets.data.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMarketId(m.id)}
                  aria-pressed={m.id === marketId}
                  className={`num px-3 py-1.5 text-[12px] ${m.id === marketId ? "bg-ink text-surface" : "hover:bg-rule"}`}
                >
                  {m.name}
                </button>
              ))}
            {markets.state === "loading" && <span className="px-3 py-1.5 text-[12px] text-muted">loading markets</span>}
            {markets.state === "error" && <span className="px-3 py-1.5 text-[12px] text-[var(--loss)]">{markets.message}</span>}
          </div>
          <div role="group" aria-label="Timeframe" className="flex border border-rule">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.res}
                onClick={() => setRes(t.res)}
                aria-pressed={t.res === res}
                className={`num px-2.5 py-1.5 text-[12px] ${t.res === res ? "text-accent underline underline-offset-4" : "text-muted hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="flex items-baseline gap-4 pt-6 pb-3">
        <h1 className="font-[family-name:var(--font-display)] text-[40px] font-bold leading-none tracking-tight md:text-[64px]">
          <span className="num">{lastClose !== null ? formatPrice(lastClose, decimals) : " "}</span>
        </h1>
        <p className="text-[14px] text-muted">
          {market?.name ?? ""} perpetual on Perpl
          {room.state === "ready" && ` · ${friends.length} of ${room.data.checked} traders in the room hold it`}
        </p>
      </section>

      {/* OHLC readout plus the room long/short split, above the chart. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-2">
        <p aria-live="off" className="num text-[12px] text-muted">
          {ohlc ? (
            <>
              <span>O {formatPrice(ohlc.o, decimals)}</span>{" "}
              <span>H {formatPrice(ohlc.h, decimals)}</span>{" "}
              <span>L {formatPrice(ohlc.l, decimals)}</span>{" "}
              <span>C {formatPrice(ohlc.c, decimals)}</span>{" "}
              <span style={{ color: ohlc.change >= 0 ? "var(--gain)" : "var(--loss)" }}>
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
              className="flex h-2 min-w-12 flex-1 overflow-hidden"
              role="img"
              aria-label={`${counts.long} traders long, ${counts.short} traders short`}
            >
              <div style={{ width: `${(counts.long / totalSides) * 100}%`, background: "var(--gain)" }} />
              <div style={{ width: `${(counts.short / totalSides) * 100}%`, background: "var(--loss)" }} />
            </div>
          </div>
        )}
      </div>

      <div className="pb-2">
        <SuggestionBanner
          friends={friends}
          roomReady={room.state === "ready"}
          marketId={marketId}
          priceDecimals={decimals}
          lotDecimals={market?.lotDecimals ?? 0}
          onSuggestion={setIncoming}
        />
      </div>

      <main className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div
          ref={wrap}
          className="relative h-[60vh] max-h-[70vh] min-h-[420px] border border-ink bg-[var(--surface)] lg:min-h-[420px]"
          onPointerDown={onChartPointerDown}
          onPointerMove={onChartPointerMove}
          onPointerUp={endChartDrag}
          onPointerCancel={endChartDrag}
          style={{ cursor: dragging.current ? "grabbing" : hoverLine ? "ns-resize" : undefined, touchAction: "pan-x pan-y" }}
        >
          <div ref={box} className="absolute inset-0" />
          {/* Bands between each friend's entry and the current price. Decorative:
              never takes pointer events. Only the selected trader gets a band,
              clipped to the visible price range, with a 45deg hatch over the
              PnL wash at half strength. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f) return null;
              // A band for every trader stacks into one wash over the candles; show
              // it only for the trader being inspected.
              if (o.account !== selected?.account) return null;
              if (o.bandHeight <= 0) return null;
              const colour = hue(f.account);
              return (
                <div key={`band-${o.account}`} className="absolute" style={{ left: o.bandLeft, width: Math.max(0, o.right - o.bandLeft), top: o.bandTop, height: o.bandHeight }}>
                  <div className="absolute inset-0" style={{ background: f.unrealizedPnl >= 0 ? "var(--gain)" : "var(--loss)", opacity: 0.12 }} />
                  <div
                    className="absolute inset-0"
                    style={{ backgroundImage: `repeating-linear-gradient(45deg, ${colour}2B 0 6px, transparent 6px 12px)` }}
                  />
                </div>
              );
            })}
          </div>
          {/* Avatars sit ON the chart at each friend's entry time and price.
              The layer is decorative; only the avatar and Copy buttons take events.
              Friends outside the visible range pin to the edge layer below. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f || o.avatarX === null || o.mode !== "candle") return null;
              const colour = hue(f.account);
              const dim = active && active !== o.account;
              return (
                <div
                  key={`avatar-${o.account}`}
                  className="marker-anim absolute left-0 top-0 flex items-center"
                  style={{
                    transform: `translate(${o.avatarX - AVATAR / 2}px, ${o.avatarY - AVATAR / 2}px)`,
                    opacity: dim ? 0.35 : 1,
                    zIndex: hover === o.account || active === o.account ? 4 : 3,
                  }}
                >
                  <button
                    onMouseEnter={() => setHover(o.account)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(o.account)}
                    onBlur={() => setHover(null)}
                    onClick={() => setActive(active === o.account ? null : o.account)}
                    aria-pressed={active === o.account}
                    aria-label={`${shortName(f.account)} ${f.side} entry ${formatPrice(f.entryPrice, decimals)}`}
                    className="pointer-events-auto block rounded-full text-center font-bold"
                    style={{
                      width: AVATAR,
                      height: AVATAR,
                      background: colour,
                      color: CHART.surface,
                      fontSize: 9,
                      lineHeight: `${AVATAR}px`,
                      boxShadow: `0 0 0 1px ${CHART.surface}`,
                    }}
                  >
                    {avatarLabel(f.account)}
                  </button>
                  <CopyButton account={o.account} friend={f} decimals={decimals} onCopy={() => openCopy(o.account)} />
                </div>
              );
            })}
          </div>
          {/* Edge markers for entries outside the visible range: pinned to the
              top or bottom edge with an arrow and the entry price, so they
              never stretch the scale. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f || o.mode === "candle") return null;
              const colour = hue(f.account);
              const arrow = o.mode === "top" ? "↑" : "↓";
              return (
                <div
                  key={`edge-${o.account}`}
                  className="absolute left-3 z-[3]"
                  style={{ top: o.mode === "top" ? 8 : undefined, bottom: o.mode === "bottom" ? 8 : undefined }}
                >
                  <button
                    onMouseEnter={() => setHover(o.account)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(o.account)}
                    onBlur={() => setHover(null)}
                    onClick={() => setActive(active === o.account ? null : o.account)}
                    aria-pressed={active === o.account}
                    aria-label={`${shortName(f.account)} entry ${formatPrice(f.entryPrice, decimals)} ${o.mode === "top" ? "above" : "below"} the visible range`}
                    className="num pointer-events-auto flex items-center gap-1.5 rounded-[6px] border bg-[var(--surface)] px-2 py-1 text-[11px]"
                    style={{ borderColor: colour }}
                  >
                    <span className="font-medium">{shortName(f.account)} entry {formatPrice(f.entryPrice, decimals)} {arrow}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {/* Chips pinned at each friend's entry price on the right edge. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f) return null;
              const chip = { ...chipFor(f, decimals), colour: hue(f.account) };
              const dim = active && active !== o.account;
              const arrow = o.mode === "top" ? " ↑" : o.mode === "bottom" ? " ↓" : "";
              return (
                <div
                  key={`chip-${o.account}`}
                  className="absolute flex items-center"
                  style={{ top: o.chipY, right: `calc(100% - ${o.right - 8}px)`, height: CHIP_H }}
                >
                  <button
                    onMouseEnter={() => setHover(o.account)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(o.account)}
                    onBlur={() => setHover(null)}
                    onClick={() => setActive(active === o.account ? null : o.account)}
                    className="chip num pointer-events-auto flex items-center gap-2 rounded-[6px] border bg-[var(--surface)] px-2 text-[11px] leading-none"
                    style={{
                      height: CHIP_H,
                      borderColor: chip.colour,
                      opacity: dim ? 0.35 : 1,
                      zIndex: hover === o.account || active === o.account ? 3 : 2,
                    }}
                    aria-label={`${chip.label} ${chip.side} entry ${chip.entry}${arrow}, ${chip.pnl}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: chip.colour }} />
                    <span className="font-medium">{chip.label}</span>
                    <span className="text-muted">{chip.side}</span>
                    <span style={{ color: chip.inProfit ? "var(--gain)" : "var(--loss)" }}>{chip.pnl}</span>
                    {arrow && <span className="text-muted">{arrow.trim()}</span>}
                  </button>
                  <CopyButton account={o.account} friend={f} decimals={decimals} onCopy={() => openCopy(o.account)} />
                </div>
              );
            })}
          </div>
          {/* TP/SL floating tags glide with the lines. Decorative. */}
          {selected && tp !== null && tpY !== null && (
            <div
              className="marker-anim num pointer-events-none absolute left-8 z-10 border bg-[var(--surface)] px-2 py-1 text-[11px]"
              style={{ transform: `translateY(${tpY - 13}px)`, top: 0, borderColor: hue(selected.account), transition: reducedMotion ? "none" : undefined }}
            >
              TP {formatPrice(tp, decimals)} · {formatUsd(pnlAtPrice(tp, selected.entryPrice, selected.size, selected.side))}
            </div>
          )}
          {selected && sl !== null && slY !== null && (
            <div
              className="marker-anim num pointer-events-none absolute left-8 z-10 border border-dashed bg-[var(--surface)] px-2 py-1 text-[11px]"
              style={{ transform: `translateY(${slY - 13}px)`, top: 0, borderColor: hue(selected.account), transition: reducedMotion ? "none" : undefined }}
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
              <span className="block h-[10px] w-[10px] rounded-full border-2 bg-[var(--surface)]" style={{ borderColor: hue(selected.account) }} />
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
              <span className="block h-[10px] w-[10px] rounded-full border-2 border-dashed bg-[var(--surface)]" style={{ borderColor: hue(selected.account) }} />
            </button>
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
              aria-label={`Copy ${shortName(copyFriend.account)}`}
              data-nodrag
              className="absolute right-2 top-2 z-20 w-[min(280px,calc(100%-16px))] border border-ink bg-[var(--surface)] p-3 text-[13px]"
              onKeyDown={(e) => {
                if (e.key === "Escape") setCopyFor(null);
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="font-[family-name:var(--font-display)] text-[14px] font-bold">
                  Copy <span style={{ color: hue(copyFriend.account) }}>{shortName(copyFriend.account)}</span>{" "}
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
                className="num mb-2 w-full rounded-[6px] border border-ink bg-[var(--surface)] px-2.5 py-2 text-[12px]"
              />
              <label htmlFor="copy-slip" className="mb-1 block text-[12px] font-medium">Max slippage (bps)</label>
              <input
                id="copy-slip"
                inputMode="numeric"
                value={copySlip}
                onChange={(e) => setCopySlip(e.target.value)}
                placeholder="50"
                className="num mb-3 w-full rounded-[6px] border border-ink bg-[var(--surface)] px-2.5 py-2 text-[12px]"
              />
              <button
                onClick={doCopy}
                disabled={copyResult.kind === "sending"}
                className="w-full rounded-[6px] bg-ink px-3 py-2 text-[13px] font-medium text-surface active:scale-[0.97] disabled:opacity-40"
              >
                {copyResult.kind === "sending" ? "Waiting for wallet" : `Copy ${copyFriend.side === "long" ? "long" : "short"}`}
              </button>
              {copyResult.kind === "ok" && (
                <p className="num mt-2 break-all text-[12px]" style={{ color: "var(--gain)" }}>
                  Sent. <a className="underline" href={`${MONAD_VISION}/${copyResult.hash}`} target="_blank" rel="noreferrer">View on MonadVision</a>
                </p>
              )}
              {copyResult.kind === "error" && (
                <p className="mt-2 text-[12px] text-[var(--loss)]">{copyResult.message}</p>
              )}
            </div>
          )}
          {hovered && (
            <div className="num pointer-events-none absolute left-3 top-3 z-10 w-[240px] border border-ink bg-[var(--surface)] p-3 text-[12px]">
              <p className="mb-2 font-[family-name:var(--font-display)] text-[14px] font-bold" style={{ color: hue(hovered.account) }}>
                {shortName(hovered.account)} · {hovered.side === "long" ? "Long" : "Short"}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted">Entry</dt><dd className="text-right">{formatPrice(hovered.entryPrice, decimals)}</dd>
                <dt className="text-muted">Size</dt><dd className="text-right">{hovered.size}</dd>
                <dt className="text-muted">Unrealised</dt>
                <dd className="text-right" style={{ color: hovered.unrealizedPnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{formatUsd(hovered.unrealizedPnl)}</dd>
                <dt className="text-muted">Funding</dt><dd className="text-right">{formatUsd(hovered.fundingPnl)}</dd>
                <dt className="text-muted">Entry block</dt><dd className="text-right">{Number(hovered.entryBlock).toLocaleString("en-US")}</dd>
              </dl>
            </div>
          )}
          {candles.state === "loading" && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-[14px] text-muted">Loading candles from Perpl</p>
          )}
          {candles.state === "error" && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-[14px] text-[var(--loss)]">
              Could not load candles: {candles.message}
            </p>
          )}
        </div>

        <aside aria-label="In the room" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between border-b border-ink pb-2">
            <h2 className="font-[family-name:var(--font-display)] text-[20px] font-bold">In the room</h2>
            <span className="num text-[12px] text-muted">by unrealised PnL</span>
          </div>
          {room.state === "loading" && <p className="text-[14px] text-muted">Reading positions from the Exchange contract</p>}
          {room.state === "error" && <p className="text-[14px] text-[var(--loss)]">Could not read positions: {room.message}</p>}
          {room.state === "ready" && friends.length === 0 && (
            <p className="text-[14px] text-muted">
              Nobody in the room holds {market?.name ?? "this market"} right now. Try another market, or add a trader below.
            </p>
          )}
          <ol className="flex gap-3 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {friends.map((f) => {
              const chip = { ...chipFor(f, decimals), colour: hue(f.account) };
              const on = active === f.account;
              return (
                <li key={f.account} className="min-w-[210px] lg:min-w-0">
                  <button
                    onClick={() => setActive(on ? null : f.account)}
                    aria-pressed={on}
                    className="num flex w-full items-center justify-between gap-3 border-l-4 bg-[var(--surface)] px-3 py-2.5 text-left text-[13px] hover:bg-rule"
                    style={{ borderLeftColor: chip.colour, outline: on ? `2px solid ${chip.colour}` : undefined }}
                  >
                    <span>
                      <span className="block font-medium">{chip.label} <span className="text-muted">{chip.side}</span></span>
                      <span className="block text-[12px] text-muted">in at {chip.entry}</span>
                    </span>
                    <span style={{ color: chip.inProfit ? "var(--gain)" : "var(--loss)" }}>{chip.pnl}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <section aria-label="Suggest TP or SL" className="flex flex-col gap-2 border-t border-rule pt-4">
            <h3 className="font-[family-name:var(--font-display)] text-[16px] font-bold">Suggest TP or SL</h3>
            {!selected && (
              <p className="text-[13px] text-muted">Select a trader to drag TP and SL lines for them.</p>
            )}
            {selected && tp !== null && sl !== null && (
              <>
                <p className="text-[13px] text-muted">
                  For {shortName(selected.account)}, {selected.side === "long" ? "Long" : "Short"} in at{" "}
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
                        className="num flex-1 rounded-[6px] border px-2.5 py-2 text-left text-[12px] hover:bg-rule"
                        style={{
                          borderColor: hue(selected.account),
                          outline: focusKind === kind ? `2px solid ${hue(selected.account)}` : undefined,
                          background: on ? "var(--surface)" : undefined,
                        }}
                      >
                        <span className="block font-medium">{kind === "tp" ? "TP" : "SL"} {formatPrice(price, decimals)}</span>
                        <span className="block" style={{ color: pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>
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
                  className="num min-w-0 flex-1 rounded-[6px] border border-ink bg-[var(--surface)] px-2.5 py-2 text-[12px]"
                />
                {viewerError && <p className="text-[12px] text-[var(--loss)]">{viewerError}</p>}
                {viewerOk && suggestPayload ? (
                  <button
                    type="button"
                    onClick={copySuggestLink}
                    title="Copy a link with this suggestion"
                    className="rounded-[6px] border border-ink px-3 py-2 text-[13px] font-medium hover:bg-rule active:scale-[0.97]"
                  >
                    {copiedSuggest ? "Copied" : "Copy suggestion link"}
                  </button>
                ) : (
                  <p className="text-[13px] text-muted">Connect a wallet to suggest. Paste your address above.</p>
                )}
              </>
            )}
          </section>
          <form onSubmit={addTrader} className="mt-auto flex flex-col gap-2 border-t border-rule pt-4">
            <label htmlFor="add" className="text-[13px] font-medium">Add a trader by address</label>
            <div className="flex gap-2">
              <input
                id="add"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="num min-w-0 flex-1 rounded-[6px] border border-ink bg-[var(--surface)] px-2.5 py-2 text-[12px]"
              />
              <button className="rounded-[6px] bg-ink px-3 text-[13px] font-medium text-surface active:scale-[0.97]">Add</button>
              <button
                type="button"
                onClick={copyRoomLink}
                disabled={extra.length === 0}
                title={extra.length === 0 ? "Add a trader first, then share the room" : "Copy a link to this room"}
                className="rounded-[6px] border border-ink px-3 text-[13px] font-medium hover:bg-rule active:scale-[0.97] disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy room link"}
              </button>
            </div>
            {draftError && <p className="text-[12px] text-[var(--loss)]">{draftError}</p>}
          </form>
        </aside>
      </main>

      <footer className="mt-6 border-t border-rule pt-3 text-[12px] text-muted">
        Positions read from Perpl&apos;s Exchange contract{" "}
        <span className="num">{EXCHANGE.slice(0, 6)}…{EXCHANGE.slice(-4)}</span> on Monad mainnet
        {room.state === "ready" && <> at block <span className="num">{Number(room.data.block).toLocaleString("en-US")}</span></>}. Read-only.
        Candles from Perpl&apos;s public market data.
      </footer>
    </div>
  );
}

/// Copy affordance for one on-chart avatar or chip: an icon at rest, the word
/// Copy on hover or focus, and a 44px hit area on touch (padding with negative
/// margin keeps the visual size while the tap target stays full size).
function CopyButton({ account, friend, decimals, onCopy }: { account: string; friend: Friend; decimals: number; onCopy: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
      aria-label={`Copy ${shortName(friend.account)} ${friend.side} at ${formatPrice(friend.entryPrice, decimals)}`}
      title={`Copy ${shortName(friend.account)} ${friend.side}`}
      className="copy-btn pointer-events-auto rounded-[6px] text-muted hover:text-ink"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="copy-label text-[11px] font-medium">Copy</span>
      <span className="sr-only">{account}</span>
    </button>
  );
}
