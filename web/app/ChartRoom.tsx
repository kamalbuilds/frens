"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assignColours, byPnl, chipFor, colourFor, formatPrice, formatUsd, shortName, stackChips, type Candle, type Friend } from "@/lib/chart";
import { encodeRoom } from "@/lib/roomlink";

type Market = { id: number; name: string; priceDecimals: number; lotDecimals: number };
type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const TIMEFRAMES = [
  { label: "15m", res: 900 },
  { label: "1h", res: 3600 },
  { label: "4h", res: 14400 },
  { label: "1d", res: 86400 },
];
const EXCHANGE = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F";
const CHIP_H = 30;

type Overlay = {
  account: string;
  chipY: number;
  entryY: number;
  markY: number;
  bandLeft: number;
  right: number;
};

/// The chart library parses colours itself and rejects CSS color-mix(), which the
/// page tokens use. So the chart gets concrete values computed from the same
/// DESIGN.md hexes: ink #1C1B19 at the token's mix ratios over surface #F3EFE6.
const CHART = {
  ink: "#1C1B19",
  surface: "#F3EFE6",
  accent: "#2F5BEA",
  muted: "rgba(28, 27, 25, 0.62)",
  rule: "rgba(28, 27, 25, 0.14)",
  grid: "rgba(28, 27, 25, 0.06)",
};

export function ChartRoom({ initialAccounts }: { initialAccounts?: string[] }) {
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

  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lines = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const market = markets.state === "ready" ? markets.data.find((m) => m.id === marketId) : undefined;
  const decimals = market?.priceDecimals ?? 2;
  const friends = useMemo(() => (room.state === "ready" ? byPnl(room.data.friends) : []), [room]);
  const palette = useMemo(() => assignColours(friends.map((f) => f.account)), [friends]);
  const hue = (a: string) => palette.get(a.toLowerCase()) ?? colourFor(a);
  const lastClose = candles.state === "ready" && candles.data.length ? candles.data[candles.data.length - 1].close : null;

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
      rightPriceScale: { borderColor: CHART.rule },
      timeScale: { borderColor: CHART.rule, timeVisible: true, rightOffset: 14 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    // Up candles hollow ink, down candles filled ink (DESIGN.md).
    const s = c.addSeries(CandlestickSeries, {
      upColor: surface,
      borderUpColor: ink,
      wickUpColor: ink,
      downColor: ink,
      borderDownColor: ink,
      wickDownColor: ink,
      priceLineColor: CHART.accent,
    });
    chart.current = c;
    series.current = s;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      lines.current.clear();
    };
  }, []);

  // Where every friend's chip, line and band sit, from the chart's own coordinates.
  const layout = useCallback(() => {
    const c = chart.current;
    const s = series.current;
    const el = box.current;
    if (!c || !s || !el || candles.state !== "ready" || !candles.data.length) return setOverlays([]);
    const right = el.clientWidth - c.priceScale("right").width();
    const first = candles.data[0].time;
    const entries = friends.map((f) => s.priceToCoordinate(f.entryPrice));
    const valid = friends.map((f, i) => ({ f, y: entries[i] })).filter((x) => x.y !== null) as { f: Friend; y: number }[];
    const stacked = stackChips(valid.map((v) => v.y - CHIP_H / 2), CHIP_H + 4);
    setOverlays(
      valid.map(({ f, y }, i) => {
        const start = Math.max(f.entryTime ?? first, first) as UTCTimestamp;
        const x = c.timeScale().timeToCoordinate(start);
        return {
          account: f.account,
          entryY: y,
          markY: s.priceToCoordinate(f.markPrice) ?? y,
          chipY: stacked[i],
          bandLeft: x ?? 0,
          right,
        };
      }),
    );
  }, [candles, friends]);

  // Feed candles and friend lines into the chart.
  useEffect(() => {
    const c = chart.current;
    const s = series.current;
    if (!c || !s || candles.state !== "ready") return;
    s.setData(candles.data.map((k) => ({ ...k, time: k.time as UTCTimestamp })));
    for (const l of lines.current.values()) c.removeSeries(l);
    lines.current.clear();
    const data = candles.data;
    if (data.length) {
      for (const f of friends) {
        const startTime = data.find((k) => k.time >= (f.entryTime ?? 0))?.time ?? data[0].time;
        const dim = active && active.toLowerCase() !== f.account.toLowerCase();
        const l = c.addSeries(LineSeries, {
          color: dim ? `${hue(f.account)}40` : hue(f.account),
          lineWidth: active && !dim ? 3 : 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
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

  // Keep overlays glued to the chart on pan, zoom and resize.
  useEffect(() => {
    const c = chart.current;
    if (!c || !box.current) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    c.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(box.current);
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
          <span className="num">{lastClose !== null ? formatPrice(lastClose, decimals) : " "}</span>
        </h1>
        <p className="text-[14px] text-muted">
          {market?.name ?? ""} perpetual on Perpl
          {room.state === "ready" && ` · ${friends.length} of ${room.data.checked} traders in the room hold it`}
        </p>
      </section>

      <main className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative min-h-[420px] border border-ink bg-[var(--surface)] lg:min-h-[560px]">
          <div ref={box} className="absolute inset-0" />
          {/* Bands between each friend's entry and the current price, tinted by PnL. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {overlays.map((o) => {
              const f = friends.find((x) => x.account === o.account);
              if (!f) return null;
              const top = Math.min(o.entryY, o.markY);
              const h = Math.max(1, Math.abs(o.entryY - o.markY));
              // A band for every trader stacks into one wash over the candles; show
              // it only for the trader being inspected.
              if (o.account !== (hover ?? active)) return null;
              return (
                <div
                  key={`band-${o.account}`}
                  className="absolute"
                  style={{
                    left: o.bandLeft,
                    width: Math.max(0, o.right - o.bandLeft),
                    top,
                    height: h,
                    background: f.unrealizedPnl >= 0 ? "var(--gain)" : "var(--loss)",
                    opacity: 0.12,
                  }}
                />
              );
            })}
          </div>
          {/* Chips pinned at each friend's entry price on the right edge. */}
          {overlays.map((o) => {
            const f = friends.find((x) => x.account === o.account);
            if (!f) return null;
            const chip = { ...chipFor(f, decimals), colour: hue(f.account) };
            const dim = active && active !== o.account;
            return (
              <button
                key={`chip-${o.account}`}
                onMouseEnter={() => setHover(o.account)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(o.account)}
                onBlur={() => setHover(null)}
                onClick={() => setActive(active === o.account ? null : o.account)}
                className="chip num absolute flex items-center gap-2 rounded-[6px] border bg-[var(--surface)] px-2 text-[11px] leading-none"
                style={{
                  top: o.chipY,
                  right: `calc(100% - ${o.right - 8}px)`,
                  height: CHIP_H,
                  borderColor: chip.colour,
                  opacity: dim ? 0.35 : 1,
                  zIndex: hover === o.account || active === o.account ? 3 : 2,
                }}
                aria-label={`${chip.label} ${chip.side} entry ${chip.entry}, ${chip.pnl}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: chip.colour }} />
                <span className="font-medium">{chip.label}</span>
                <span className="text-muted">{chip.side}</span>
                <span style={{ color: chip.inProfit ? "var(--gain)" : "var(--loss)" }}>{chip.pnl}</span>
              </button>
            );
          })}
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
            <p className="absolute inset-0 grid place-items-center text-[14px] text-muted">Loading candles from Perpl</p>
          )}
          {candles.state === "error" && (
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-[14px] text-[var(--loss)]">
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
