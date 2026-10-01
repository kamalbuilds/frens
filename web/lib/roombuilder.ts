/// First-run room builder: turn freeform [address, name] rows into a room link.
///
/// Rows come from the empty-room panel (start with 3, up to 12). Invalid rows
/// are skipped, duplicates collapse case-insensitively, names pass through
/// sanitizeName and ride keyed ("b379:ana") so they survive the room code
/// sorting its addresses. Pure and never throws: no valid rows means an empty
/// build, and roomPathForRows returns null instead of a link.
import { isAddress } from "viem";
import { encodeKeyedNames, sanitizeName } from "./names";
import { roomLink } from "./network";
import type { Network } from "./perpl";
import { encodeRoom } from "./roomlink";

/// The builder panel caps at 12 frens, below the room code's own limit of 20.
export const MAX_BUILDER_ROWS = 12;

/// Rows the empty-room panel starts with.
export const STARTER_BUILDER_ROWS = 3;

export type RoomRow = { address: string; name: string };

export type RoomBuild = { addresses: string[]; namesQuery: string };

/// Fold rows into sorted lowercase addresses plus the keyed ?n= value.
/// Skips blank or unusable addresses and extra rows past the cap.
export function buildRoomFromRows(rows: RoomRow[]): RoomBuild {
  const seen = new Set<string>();
  const addresses: string[] = [];
  const nameByAddr = new Map<string, string>();
  for (const row of rows) {
    if (addresses.length >= MAX_BUILDER_ROWS) break;
    const addr = row.address.trim();
    if (!isAddress(addr)) continue;
    const lower = addr.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    addresses.push(lower);
    const clean = sanitizeName(row.name);
    if (clean) nameByAddr.set(lower, clean);
  }
  const sorted = [...addresses].sort();
  return { addresses: sorted, namesQuery: encodeKeyedNames(sorted, (a) => nameByAddr.get(a)) };
}

/// The share path for built rows: /r/<room>?net=<net>&n=<keyed names>.
/// Null when no row holds a usable address.
export function roomPathForRows(rows: RoomRow[], net: Network): string | null {
  const { addresses, namesQuery } = buildRoomFromRows(rows);
  if (addresses.length === 0) return null;
  let code = "";
  try {
    code = encodeRoom(addresses);
  } catch {
    return null;
  }
  if (!code) return null;
  return roomLink(code, net, namesQuery || undefined);
}
