/// Fren nicknames: room links carry optional names in ?n=, one per address in
/// the same order as the room's addresses (decodeRoom order, empty slots for
/// unnamed frens): /r/<room>?n=ana,bo,cy,dee. The room shows the nickname
/// instead of the 4-char address everywhere.
import { shortName } from "./chart";

export const MAX_NAME_LEN = 24;

/// Split ?n= on commas, trimming each slot. Empty slots stay empty so
/// positions keep aligning with the room addresses: "ana,,cy" parses to
/// ["ana", "", "cy"]. Never throws: missing or empty input parses to [].
export function parseNamesParam(value: string | null | undefined): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value.split(",").map((s) => s.trim());
}

/// Join name slots back into ?n= form, preserving empty slots so positions
/// keep aligning with the room addresses. Null slots encode as empty.
export function encodeNamesParam(names: (string | null | undefined)[]): string {
  return names.map((n) => (n ?? "").trim()).join(",");
}

/// A usable nickname: 1 to 24 chars after trimming, no commas (the slot
/// separator) and no control characters. Returns null for anything else.
export function sanitizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0 || t.length > MAX_NAME_LEN) return null;
  if (t.includes(",")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

/// Map room addresses to their nicknames by position: names[i] belongs to
/// addresses[i]. Unnamed slots (empty or unusable) are skipped, so the map
/// only holds frens with a real nickname. Keys are lowercased addresses.
export function namesForAddresses(addresses: string[], names: (string | null | undefined)[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < addresses.length; i++) {
    const clean = sanitizeName(names[i]);
    if (clean) out.set(addresses[i].toLowerCase(), clean);
  }
  return out;
}

export type NamesByAddress = Map<string, string> | Record<string, string>;

/// The name the room shows for an address: the nickname when one is set,
/// else the 4-char short address.
export function displayName(address: string, byAddress?: NamesByAddress): string {
  const lower = address.toLowerCase();
  if (byAddress instanceof Map) {
    const n = byAddress.get(lower);
    if (n) return n;
  } else if (byAddress) {
    const n = (byAddress as Record<string, string>)[lower];
    if (n) return n;
  }
  return shortName(address);
}

/// A resolver for modules that format names (banner text, ghost labels,
/// rail chips): nickname when set, short address otherwise.
export function nameForAddress(byAddress?: NamesByAddress): (addr: string) => string {
  return (addr: string) => displayName(addr, byAddress);
}

/// Call record line for hover and rail cards: "<accepted> calls taken ·
/// <hit> hit". Null when the fren has no accepted calls, so those cards
/// show no line at all.
export function callLine(accepted: number, hit: number): string | null {
  if (!Number.isFinite(accepted) || accepted <= 0) return null;
  return `${accepted} calls taken · ${hit} hit`;
}
