/// Shareable room codes: a canonical, URL-safe encoding of a trader list.
/// Pipeline: lowercase, dedupe, sort, strip 0x, join as raw bytes, base64url.
/// decodeRoom never throws: anything that is not a list of 1 to 20 valid
/// 20-byte addresses returns [].

export const MAX_ROOM = 20;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const vals = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]);
    if (v < 0) throw new Error("bad char");
    vals[i] = v;
  }
  const out: number[] = [];
  let i = 0;
  for (; i + 4 <= vals.length; i += 4) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const rem = vals.length - i;
  if (rem === 2) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12);
    out.push((n >> 16) & 255);
  } else if (rem === 3) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6);
    out.push((n >> 16) & 255, (n >> 8) & 255);
  } else if (rem !== 0) {
    throw new Error("bad length");
  }
  return new Uint8Array(out);
}

export function encodeRoom(addresses: string[]): string {
  const norm = Array.from(new Set(addresses.map((a) => a.trim().toLowerCase()))).sort();
  for (const a of norm) {
    if (!ADDRESS_RE.test(a)) throw new Error(`not an address: ${a}`);
  }
  if (norm.length > MAX_ROOM) throw new RangeError(`room holds at most ${MAX_ROOM} addresses, got ${norm.length}`);
  if (norm.length === 0) return "";
  const bytes = new Uint8Array(norm.length * 20);
  for (let i = 0; i < norm.length; i++) {
    const hex = norm[i].slice(2);
    for (let j = 0; j < 20; j++) bytes[i * 20 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
  }
  return bytesToB64url(bytes);
}

export function decodeRoom(s: string): string[] {
  try {
    if (typeof s !== "string" || s.length === 0) return [];
    if (!BASE64URL_RE.test(s)) return [];
    if (s.length % 4 === 1) return [];
    const bytes = b64urlToBytes(s);
    if (bytes.length % 20 !== 0) return [];
    const n = bytes.length / 20;
    if (n === 0 || n > MAX_ROOM) return [];
    if (bytesToB64url(bytes) !== s) return [];
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      let hex = "0x";
      for (let j = 0; j < 20; j++) hex += bytes[i * 20 + j].toString(16).padStart(2, "0");
      if (!ADDRESS_RE.test(hex)) return [];
      out.push(hex);
    }
    return out;
  } catch {
    return [];
  }
}
