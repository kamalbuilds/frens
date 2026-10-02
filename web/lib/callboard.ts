// The room's call record, best caller first: hits, then calls taken. Built from receipt-verified calls only.
export type BoardRow = { caller: string; taken: number; hit: number; earned: number };

/// `earned` sums aUSD stakes paid to the caller (CallStake), read from chain per call.
export function callBoard(calls: readonly { caller: string; hit?: boolean; stake?: { state: string; amount: number } | null }[]): BoardRow[] {
  const by = new Map<string, BoardRow>();
  for (const c of calls) {
    const k = c.caller.toLowerCase();
    const row = by.get(k) ?? { caller: c.caller, taken: 0, hit: 0, earned: 0 };
    row.taken += 1;
    if (c.hit === true) row.hit += 1;
    if (c.stake?.state === "paid") row.earned += c.stake.amount;
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.hit - a.hit || b.taken - a.taken);
}
