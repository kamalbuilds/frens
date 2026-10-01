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

/// Map room addresses to their nicknames. A slot "b379:ana" names the address starting with b379 (4 or more
/// hex chars, case-insensitive), so names survive the room code sorting its addresses; a plain slot "ana"
/// falls back to position: names[i] belongs to addresses[i]. Unusable slots are skipped. Keys are lowercased.
export function namesForAddresses(addresses: string[], names: (string | null | undefined)[]): Map<string, string> {
  const out = new Map<string, string>();
  const lower = addresses.map((a) => a.toLowerCase());
  for (let i = 0; i < names.length; i++) {
    const slot = (names[i] ?? "").trim();
    const m = /^(?:0x)?([0-9a-fA-F]{4,40}):(.*)$/.exec(slot);
    if (m) {
      const clean = sanitizeName(m[2]);
      const hits = lower.filter((a) => a.slice(2).startsWith(m[1].toLowerCase()));
      if (clean && hits.length === 1) out.set(hits[0], clean);
      continue;
    }
    const clean = sanitizeName(slot);
    if (clean && i < lower.length) out.set(lower[i], clean);
  }
  return out;
}

/// Keyed ?n= slots for a room: "b379:ana" per named address, unnamed addresses left out.
export function encodeKeyedNames(addresses: string[], nameOf: (addr: string) => string | undefined): string {
  return addresses
    .map((a) => {
      const n = sanitizeName(nameOf(a.toLowerCase()));
      return n ? `${a.toLowerCase().slice(2, 6)}:${n}` : "";
    })
    .filter(Boolean)
    .join(",");
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
