import { ImageResponse } from "next/og";
import type { Address } from "viem";
import { Card } from "./card";
import { namesForAddresses, parseNamesParam } from "@/lib/names";
import { parseNetParam } from "@/lib/network";
import { buildCardData } from "@/lib/ogcard";
import { NETWORKS } from "@/lib/perpl";
import { parseCallsParam, verifyCallReceipts } from "@/lib/receipts";
import { decodeRoom } from "@/lib/roomlink";
import { readPosition, type Position } from "@/lib/readPosition";
import { clientFor } from "@/lib/server";

export const revalidate = 60;

/// The room share card. Everything it prints is measured: the market, its mark
/// and every PnL read from the Exchange at one block, the call counts from
/// the same receipts the room verifies, one per hash in ?c=. The link's own
/// network, nicknames and receipts ride through, so the card shows the same
/// frens the room does.
export async function GET(req: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  const q = new URL(req.url).searchParams;
  const net = parseNetParam(q);
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
  const names = namesForAddresses(accounts, parseNamesParam(q.get("n")));

  // Every trader in the room is read, not just the first few: the card sorts
  // by live PnL, so showing the first addresses would rank the room by
  // nothing. A room holds at most 20 and each account stops at its first
  // market with a position.
  let positions: Position[] = [];
  let live = true;
  try {
    const block = await client.getBlockNumber().catch(() => undefined);
    const found = await Promise.all(accounts.map((a) => firstPosition(a, block)));
    positions = found.filter((p): p is Position => p !== null);
  } catch {
    live = false;
  }

  // A failed receipt read costs the call counts, never the positions.
  const calls = await verifyCallReceipts(net, parseCallsParam(q.get("c")), client).catch(() => []);

  const card = buildCardData({
    accounts,
    positions: positions.map((p) => ({
      account: p.account,
      side: p.side,
      pnl: p.unrealizedPnl,
      symbol: p.symbol,
      markPrice: p.markPrice,
    })),
    names,
    calls,
    latestAcceptTx: calls[0]?.hash ?? null,
    live,
  });

  return new ImageResponse(<Card card={card} chainName={chainName} />, { width: 1200, height: 630 });
}
