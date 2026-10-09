import type { Network } from "./network";

export function normalizeRoomAccounts(accounts: readonly string[]): string[] {
  return accounts.map((a) => a.trim().toLowerCase()).filter(Boolean);
}

export function roomPositionsKey(marketId: number, accounts: readonly string[], net: Network): string {
  return `${marketId}|${normalizeRoomAccounts(accounts).join(",")}|${net}`;
}

export function roomPositionsUrl(marketId: number, accounts: readonly string[], net: Network): string {
  const norm = normalizeRoomAccounts(accounts);
  const q = norm.length ? `&accounts=${norm.join(",")}` : "";
  return `/api/positions?market=${marketId}${q}&net=${net}`;
}

/// Room positions only need a market id. Waiting for the markets catalog must not block the
/// Exchange read, or the UI can sit on "Reading positions…" while /api/positions already returns data.
export function shouldFetchRoomPositions(view: "live" | "frens", marketId: number): boolean {
  return view === "frens" && Number.isFinite(marketId) && marketId > 0;
}
