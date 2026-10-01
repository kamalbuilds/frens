import { ImageResponse } from "next/og";
import type { Address } from "viem";
import { formatUsd, shortName } from "@/lib/chart";
import { LONG_RING, SHORT_RING } from "@/lib/faces";
import { NETWORKS } from "@/lib/perpl";
import { parseNetParam } from "@/lib/network";
import { readPosition, type Position } from "@/lib/readPosition";
import { decodeRoom } from "@/lib/roomlink";
import { clientFor } from "@/lib/server";

export const revalidate = 60;

const PAGE = "#0A0A0F";
const PANEL = "#13131A";
const INK = "#ECECF1";
const ACCENT = "#C8FF3D";
const MUTED = "#8B8B9E";
const RULE = "#26263A";
const GAIN = "#2BD67B";
const LOSS = "#FF6B57";

export async function GET(req: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  const net = parseNetParam(new URL(req.url).searchParams);
  const client = clientFor(net);
  const MARKETS = [...NETWORKS[net].markets];
  const chainName = net === "mainnet" ? "Monad mainnet" : "Monad testnet";

  async function firstPosition(account: string, block?: bigint): Promise<Position | null> {
    for (const m of MARKETS) {
      try {
        const p = await readPosition(account as Address, m, { network: net, client, blockNumber: block });
        if (p) return p;
      } catch {
        continue;
      }
    }
    return null;
  }

  const accounts = decodeRoom(room);
  const shown = accounts.slice(0, 5);

  let rows: { account: string; side: "long" | "short"; pnl: number; symbol: string }[] = [];
  let live = true;
  try {
    const block = await client.getBlockNumber().catch(() => undefined);
    const found = await Promise.all(shown.map((a) => firstPosition(a, block)));
    rows = found.flatMap((p) =>
      p ? [{ account: p.account, side: p.side, pnl: p.unrealizedPnl, symbol: p.symbol }] : [],
    );
  } catch {
    live = false;
  }

  const count = accounts.length;
  // Say how many hold a position right now: a room of two with one row shown read as a bug.
  const label = `${count} ${count === 1 ? "trader" : "traders"} in the room, ${rows.length} with an open position`;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAGE,
          color: INK,
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>frens</div>
          <div style={{ fontSize: 28, color: MUTED }}>Trade perps with your frens.</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: ACCENT, marginTop: 12 }}>{label}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          {rows.map((r) => {
            const c = r.side === "long" ? LONG_RING : SHORT_RING;
            const profit = r.pnl >= 0;
            return (
              <div
                key={r.account}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: PANEL,
                  borderLeft: `8px solid ${c}`,
                  borderTop: `1px solid ${RULE}`,
                  borderRight: `1px solid ${RULE}`,
                  borderBottom: `1px solid ${RULE}`,
                  padding: "12px 20px",
                  fontSize: 26,
                }}
              >
                <div style={{ display: "flex", gap: 16 }}>
                  <span style={{ fontWeight: 700 }}>{shortName(r.account)}</span>
                  <span style={{ color: MUTED }}>
                    {r.side === "long" ? "LONG" : "SHORT"} {r.symbol}
                  </span>
                </div>
                <span style={{ color: profit ? GAIN : LOSS, fontFamily: "monospace" }}>{formatUsd(r.pnl)}</span>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div style={{ fontSize: 24, color: MUTED }}>
              {live ? "No open Perpl positions for these traders right now." : "Live positions unavailable right now."}
            </div>
          )}
        </div>
        <div style={{ fontSize: 20, color: MUTED, marginTop: 24 }}>
          Positions read from Perpl Exchange on {chainName}. Read-only.
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
