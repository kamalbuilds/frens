// The room's call record, best caller first: hits, then calls taken. Built from receipt-verified calls only.
export type BoardRow = { caller: string; taken: number; hit: number };

export function callBoard(calls: readonly { caller: string; hit?: boolean }[]): BoardRow[] {
  const by = new Map<string, BoardRow>();
  for (const c of calls) {
    const k = c.caller.toLowerCase();
    const row = by.get(k) ?? { caller: c.caller, taken: 0, hit: 0 };
    row.taken += 1;
    if (c.hit === true) row.hit += 1;
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.hit - a.hit || b.taken - a.taken);
}
