/// The 1200x630 share card, presentational only: it takes the card data
/// lib/ogcard.ts built and prints it. The route reads the chain; this file
/// only draws, which is why it can be rendered on its own.
import { BeamFace } from "@/lib/beamface";
import { formatUsd } from "@/lib/chart";
import { LONG_RING, SHORT_RING } from "@/lib/faces";
import { callLine } from "@/lib/names";
import type { CardData, CardRow } from "@/lib/ogcard";

const PAGE = "#0A0A0F";
const PANEL = "#13131A";
const INK = "#ECECF1";
const MUTED = "#8B8B9E";
const RULE = "#26263A";
const GAIN = "#2BD67B";
const LOSS = "#FF6B57";
const FACE = 44;

export function Card({ card, chainName }: { card: CardData; chainName: string }) {
  // A room of two with one row shown read as a bug, so the count says how many
  // are in the room and how many hold a position right now.
  const headcount = `${card.traders} ${card.traders === 1 ? "trader" : "traders"} in the room, ${card.open} with an open position`;
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PAGE,
        color: INK,
        padding: "44px 64px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: -2, lineHeight: 1.1 }}>frens</div>
            <div style={{ fontSize: 19, color: MUTED, marginTop: 6 }}>{headcount}</div>
          </div>
          <Market card={card} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 18 }}>
          {card.rows.map((row, i) => (
            <Row key={row.account} row={row} id={`face-${i}`} />
          ))}
          {card.rows.length === 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 58,
                background: PANEL,
                border: `1px solid ${RULE}`,
                borderRadius: 10,
                padding: "0 22px",
                fontSize: 22,
                color: MUTED,
              }}
            >
              {card.live
                ? "No open Perpl positions for these traders right now."
                : "Live positions unavailable right now."}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `1px solid ${RULE}`,
          paddingTop: 14,
        }}
      >
        <span style={{ fontSize: 19, color: MUTED }}>Trade perps with your frens · frenstrade.vercel.app</span>
        <span style={{ fontSize: 15, color: MUTED }}>{chainName} · read-only</span>
      </div>
    </div>
  );
}

/// The market the room is on, with its live mark. Nothing here when nobody
/// holds a position: the card never names a market it has no position in.
function Market({ card }: { card: CardData }) {
  if (!card.market) return <div style={{ display: "flex" }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, fontFamily: "monospace" }}>{card.market}</span>
        {card.mixed && (
          <span
            style={{
              fontSize: 17,
              color: MUTED,
              border: `1px solid ${RULE}`,
              borderRadius: 6,
              padding: "2px 8px",
            }}
          >
            + markets
          </span>
        )}
      </div>
      {card.markPrice !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginTop: 4,
            fontSize: 22,
            color: MUTED,
            fontFamily: "monospace",
          }}
        >
          <span>{formatMark(card.markPrice)}</span>
          <span style={{ fontSize: 16 }}>mark</span>
        </div>
      )}
    </div>
  );
}

/// Mark price at the precision the card has room for: a market quoted in cents
/// should not print four meaningless decimals.
function formatMark(price: number): string {
  return price >= 1000
    ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function Row({ row, id }: { row: CardRow; id: string }) {
  const ring = row.side === "long" ? LONG_RING : SHORT_RING;
  const profit = row.pnl >= 0;
  const calls = callLine(row.calls, 0);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        height: 58,
        background: PANEL,
        borderLeft: `6px solid ${ring}`,
        borderTop: `1px solid ${RULE}`,
        borderRight: `1px solid ${RULE}`,
        borderBottom: `1px solid ${RULE}`,
        borderRadius: 10,
        padding: "0 22px",
      }}
    >
      <BeamFace name={row.account} id={id} size={FACE} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
        <span style={{ fontSize: 26, fontWeight: 700 }}>{row.name}</span>
        {calls !== null && <span style={{ fontSize: 18, color: MUTED }}>{calls}</span>}
      </div>
      {row.offMarket && (
        <span style={{ fontSize: 18, color: MUTED, fontFamily: "monospace" }}>{row.symbol}</span>
      )}
      <span
        style={{
          display: "flex",
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: 1,
          color: PAGE,
          background: ring,
          borderRadius: 6,
          padding: "4px 10px",
        }}
      >
        {row.side === "long" ? "LONG" : "SHORT"}
      </span>
      <span
        style={{
          display: "flex",
          width: 210,
          justifyContent: "flex-end",
          fontSize: 30,
          fontWeight: 700,
          color: profit ? GAIN : LOSS,
          fontFamily: "monospace",
        }}
      >
        {formatUsd(row.pnl)}
      </span>
    </div>
  );
}
