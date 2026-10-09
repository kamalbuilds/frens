/// The room share card as data, kept out of JSX so every choice the 1200x630
/// render makes can be unit tested. The card is what gets pasted into
/// Telegram and X, so it answers one question and answers it honestly: who
/// is in this room, which way is each of them positioned right now, and how
/// many of their calls have been taken. Nothing on it is invented: positions
/// and marks come from the Exchange, call counts from verified receipts.
import type { Side } from "./faces";
import { displayName, type NamesByAddress } from "./names";
import type { Network } from "./network";

/// Rows on the card. Six fills a 630px card at a readable row height.
export const MAX_CARD_ROWS = 6;

export type CardPosition = {
  account: string;
  side: Side;
  pnl: number;
  symbol: string;
  markPrice: number;
};

export type CardRow = {
  account: string;
  name: string;
  side: Side;
  pnl: number;
  symbol: string;
  markPrice: number;
  /// Calls this fren has had taken, counted from verified receipts.
  calls: number;
  /// True when the row is on a market other than the card's headline one, so
  /// the row names its own market instead of borrowing the headline's.
  offMarket: boolean;
};

export type CardData = {
  /// The market the card leads with, null when nobody holds a position.
  market: string | null;
  /// Live mark of that market, from the top row that trades it.
  markPrice: number | null;
  /// True when the shown rows spread over more than one market.
  mixed: boolean;
  rows: CardRow[];
  /// Traders in the room, open or not.
  traders: number;
  /// How many of them hold an open position right now.
  open: number;
  /// False when positions could not be read at all.
  live: boolean;
  /// Verified accept tx from ?c=, null when no receipts.
  acceptTx: string | null;
};

/// Accepted calls per suggester, keyed by lowercased caller. Receipts only:
/// a hash whose receipt shows no successful OrderRequestV2 call never
/// arrives here, so no count is ever taken on trust.
export function callsByCaller(calls: readonly { caller: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of calls) {
    const key = c.caller.toLowerCase();
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

export type CardInput = {
  /// Every address in the room, whether or not it holds a position.
  accounts: string[];
  /// Live positions read from the Exchange for this room.
  positions: CardPosition[];
  /// Nicknames from ?n=, keyed by address.
  names?: NamesByAddress;
  /// Verified call receipts from ?c=, counted per suggester.
  calls?: readonly { caller: string }[];
  /// Latest verified accept transaction from ?c= (first hash), for the share card.
  latestAcceptTx?: string | null;
  live?: boolean;
};

/// Build the card: the top MAX_CARD_ROWS positions by live PnL, each with its
/// nickname, its side and its verified call count. The headline market is the
/// one most of those rows trade, ties going to the best PnL, so a room split
/// across markets still gets one honest headline and every off-market row
/// names itself.
export function buildCardData(input: CardInput): CardData {
  const calls = input.calls ? callsByCaller(input.calls) : new Map<string, number>();
  const rows: CardRow[] = [...input.positions]
    .sort((a, b) => b.pnl - a.pnl || a.account.toLowerCase().localeCompare(b.account.toLowerCase()))
    .slice(0, MAX_CARD_ROWS)
    .map((p) => ({
      account: p.account,
      name: displayName(p.account, input.names),
      side: p.side,
      pnl: p.pnl,
      symbol: p.symbol,
      markPrice: p.markPrice,
      calls: calls.get(p.account.toLowerCase()) ?? 0,
      offMarket: false,
    }));

  const seen = new Map<string, number>();
  let market: string | null = null;
  let lead = 0;
  for (const r of rows) {
    const n = (seen.get(r.symbol) ?? 0) + 1;
    seen.set(r.symbol, n);
    if (n > lead) {
      lead = n;
      market = r.symbol;
    }
  }
  for (const r of rows) r.offMarket = r.symbol !== market;

  return {
    market,
    markPrice: rows.find((r) => r.symbol === market)?.markPrice ?? null,
    mixed: seen.size > 1,
    rows,
    traders: input.accounts.length,
    open: input.positions.length,
    live: input.live ?? true,
    acceptTx: input.latestAcceptTx ?? null,
  };
}

/// The card URL for a room link, carrying the same network, names and call
/// hashes the room itself shows, so the card is drawn from the room's own
/// data and a shared link never drops a nickname or a call record.
export function ogImagePath(
  room: string,
  network: Network,
  namesQuery?: string,
  callsQuery?: string,
): string {
  const parts = [
    `net=${encodeURIComponent(network)}`,
    namesQuery ? `n=${encodeURIComponent(namesQuery)}` : "",
    callsQuery ? `c=${encodeURIComponent(callsQuery)}` : "",
  ].filter(Boolean);
  return `/api/og/${room}?${parts.join("&")}`;
}
