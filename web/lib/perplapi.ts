// Client for Perpl's authenticated trading API (PerplFoundation/api-docs: authentication.md, integrations.md,
// websocket.md, rest-endpoints.md). Isomorphic: only fetch, WebSocket and crypto.getRandomValues, so a browser
// wallet, a passkey account or a script can all drive it.
//
// An API key is an Ed25519 pair. The wallet signs ONE EIP-712 enrollment payload (any function that signs typed data
// works, see TypedDataSigner); after that every REST call and the WS sign-in is signed with the Ed25519 secret, which
// this module only ever holds as a Uint8Array handed in by the caller. Nothing here logs or serialises it.
//
// Orders go over REST (POST /v1/trading/orders, a batch of OrderSpec). The trading WebSocket is used to read the
// account's snapshot (mt 19 wallet, 23 orders, 26 positions) as a second surface next to the REST reads.
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hashTypedData, hexToBytes, sha256, stringToBytes, type Hex } from "viem";

export type PerplEnv = { name: "testnet" | "mainnet"; chainId: number; apiUrl: string; wsUrl: string };

export const PERPL_ENV: Record<"testnet" | "mainnet", PerplEnv> = {
  testnet: { name: "testnet", chainId: 10143, apiUrl: "https://testnet.perpl.xyz/api", wsUrl: "wss://testnet.perpl.xyz/ws/v1/trading" },
  mainnet: { name: "mainnet", chainId: 143, apiUrl: "https://app.perpl.xyz/api", wsUrl: "wss://app.perpl.xyz/ws/v1/trading" },
};

export const SCOPE_READ = 1;
export const SCOPE_TRADE = 2;
export const MSG_STATUS = 3;
export const MSG_WALLET_SNAPSHOT = 19;
export const MSG_ORDERS_SNAPSHOT = 23;
export const MSG_POSITIONS_SNAPSHOT = 26;
export const MSG_API_KEY_SIGN_IN = 29;

export const ORDER_CLOSE_LONG = 3;
export const ORDER_CLOSE_SHORT = 4;
export const ORDER_CANCEL = 5;
export const ORDER_FLAG_IOC = 4;
export const ORDER_STATUS_FAILED = 7;
export const TRIGGER_GTE_MARK = 3;
export const TRIGGER_LTE_MARK = 4;

export class PerplApiError extends Error {
  constructor(readonly status: number, readonly body: string, what: string) {
    super(`${what}: HTTP ${status} ${body.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- keys and canonical strings

export type ApiKeyPair = { secretKey: Uint8Array; publicKey: Uint8Array; publicKeyHex: Hex };
export type ApiCreds = { apiKey: string; secretKey: Uint8Array };

export function generateApiKeyPair(): ApiKeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { secretKey, publicKey, publicKeyHex: bytesToHex(publicKey) };
}

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomNonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

// <chain_id>\n<METHOD>\n<request-target>\n<timestamp_ms>\n<nonce>\n<sha256(body) hex, no 0x>
// The request target is path + query as sent, WITHOUT the /api prefix (e.g. /v1/trading/orders).
export function restCanonical(p: { chainId: number; method: string; target: string; timestamp: string; nonce: string; body: string }): string {
  const bodyHash = sha256(stringToBytes(p.body)).slice(2);
  return [p.chainId, p.method, p.target, p.timestamp, p.nonce, bodyHash].join("\n");
}

// <chain_id>\ntrading-ws-signin\n<timestamp_ms>\n<nonce>
export function wsSignInCanonical(p: { chainId: number; timestamp: string; nonce: string }): string {
  return [p.chainId, "trading-ws-signin", p.timestamp, p.nonce].join("\n");
}

export function signCanonical(secretKey: Uint8Array, canonical: string): string {
  return base64url(ed25519.sign(stringToBytes(canonical), secretKey));
}

export function restHeaders(
  env: PerplEnv,
  creds: ApiCreds,
  method: string,
  target: string,
  body = "",
  now: number = Date.now(),
  nonce: string = randomNonce(),
): Record<string, string> {
  const timestamp = String(now);
  const canonical = restCanonical({ chainId: env.chainId, method, target, timestamp, nonce, body });
  return {
    "X-API-Key": creds.apiKey,
    "X-API-Timestamp": timestamp,
    "X-API-Nonce": nonce,
    "X-API-Signature": signCanonical(creds.secretKey, canonical),
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
}

export function wsSignInFrame(env: PerplEnv, creds: ApiCreds, now: number = Date.now(), nonce: string = randomNonce()) {
  const timestamp = String(now);
  const canonical = wsSignInCanonical({ chainId: env.chainId, timestamp, nonce });
  return { mt: MSG_API_KEY_SIGN_IN, chain_id: env.chainId, api_key: creds.apiKey, timestamp, nonce, signature: signCanonical(creds.secretKey, canonical) };
}

// ---------------------------------------------------------------- enrollment

export type TypedData = {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
};

// What a wallet needs to sign: EIP-712 typed data with the EIP712Domain type removed (viem, ethers and
// eth_signTypedData_v4 builders all derive it from the domain). A viem account is `(td) => account.signTypedData(td)`.
export type TypedDataSigner = (td: TypedData) => Promise<Hex>;

// Perpl returns uint fields as hex strings ("0x279f", "0x1a0fd853422"); hashTypedData wants numbers or bigints.
function asBigInts(td: TypedData): TypedData {
  const conv = (type: string, v: unknown) => (/^u?int\d*$/.test(type) && typeof v === "string" ? BigInt(v) : v);
  const fields = td.types[td.primaryType] ?? [];
  const domainFields = td.types.EIP712Domain ?? [];
  return {
    ...td,
    domain: Object.fromEntries(Object.entries(td.domain).map(([k, v]) => [k, conv(domainFields.find((f) => f.name === k)?.type ?? "", v)])),
    message: Object.fromEntries(Object.entries(td.message).map(([k, v]) => [k, conv(fields.find((f) => f.name === k)?.type ?? "", v)])),
  };
}

export type EnrollOptions = {
  address: string;
  signTypedData: TypedDataSigner;
  label: string;
  scopeMask?: number; // default trade (which implies read)
  builderId?: number; // frens is 23; omit for an ordinary key
  maxBuilderFeePer100k?: number; // ceiling the user signs, 0 = attribution without a fee
  expiresAt?: number;
  ipCidrs?: string[];
  // Set from a server only: a browser sets Origin itself, and Perpl rejects origins it has not whitelisted.
  origin?: string;
  keyPair?: ApiKeyPair;
};

export type ApiKeyInfo = {
  api_key: string;
  address: string;
  scope_mask: number;
  label: string;
  origin: string;
  expires_at: number;
  builder_id?: number;
  builder_name?: string;
  max_builder_fee_per_100k?: number;
};

async function postJson<T>(env: PerplEnv, path: string, body: unknown, origin?: string): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PerplApiError(res.status, text, `POST ${path}`);
  return JSON.parse(text) as T;
}

export async function requestEnrollmentPayload(env: PerplEnv, pair: ApiKeyPair, o: EnrollOptions): Promise<{ typed_data: TypedData; mac: string }> {
  return postJson(
    env,
    "/v1/api-key/payload",
    {
      chain_id: env.chainId,
      address: o.address,
      public_key: pair.publicKeyHex,
      scope_mask: o.scopeMask ?? SCOPE_TRADE,
      label: o.label,
      ...(o.expiresAt ? { expires_at: o.expiresAt } : {}),
      ...(o.ipCidrs ? { ip_cidrs: o.ipCidrs } : {}),
      ...(o.builderId !== undefined ? { builder_id: o.builderId, max_builder_fee_per_100k: o.maxBuilderFeePer100k ?? 0 } : {}),
    },
    o.origin,
  );
}

// Two signatures over the same typed data: the wallet's (account ownership) and the Ed25519 key's over the EIP-712
// digest (proof of possession). Returns the credentials the REST and WS signers need.
export async function enrollApiKey(env: PerplEnv, o: EnrollOptions): Promise<{ creds: ApiCreds; info: ApiKeyInfo; keyPair: ApiKeyPair }> {
  const keyPair = o.keyPair ?? generateApiKeyPair();
  const { typed_data, mac } = await requestEnrollmentPayload(env, keyPair, o);
  const { EIP712Domain: _domain, ...types } = typed_data.types;
  const typed = asBigInts(typed_data);
  const signature = await o.signTypedData({ ...typed, types });
  const digest = hashTypedData({ ...typed, types } as Parameters<typeof hashTypedData>[0]);
  const popSignature = bytesToHex(ed25519.sign(hexToBytes(digest), keyPair.secretKey));
  const { api_key } = await postJson<{ api_key: ApiKeyInfo }>(
    env,
    "/v1/api-key/enroll",
    { chain_id: env.chainId, address: o.address, typed_data, mac, signature, pop_signature: popSignature },
    o.origin,
  );
  return { creds: { apiKey: api_key.api_key, secretKey: keyPair.secretKey }, info: api_key, keyPair };
}

// ---------------------------------------------------------------- REST reads

export async function signedFetch(env: PerplEnv, creds: ApiCreds, method: "GET" | "POST", target: string, body = ""): Promise<Response> {
  return fetch(`${env.apiUrl}${target}`, { method, headers: restHeaders(env, creds, method, target, body), ...(body ? { body } : {}) });
}

async function signedJson<T>(env: PerplEnv, creds: ApiCreds, method: "GET" | "POST", target: string, body = ""): Promise<T> {
  const res = await signedFetch(env, creds, method, target, body);
  const text = await res.text();
  if (!res.ok) throw new PerplApiError(res.status, text, `${method} ${target}`);
  return JSON.parse(text) as T;
}

export type PerplAccount = { id: number; fw: boolean; lfr: number; b: string };
export type PerplWallet = { mt: 19; sn: number; addr: string; as: PerplAccount[] };
export type PerplPosition = { mkt: number; acc: number; pid: number; st: number; sd: 1 | 2; s: number; ep: number; lv: number; c: string };
export type PerplOrder = {
  rq: number; mkt: number; acc: number; oid: number; st: number; sr: number; fr?: number; t: number; r?: boolean;
  p?: number; os: number; fs: number; tp?: number; tpc?: number; lp?: number; lv: number; bfa?: string;
};
export type PerplMarket = { id: number; symbol: string; order_ttl_blocks: number; config: { price_decimals: number; size_decimals: number }; state: { mrk: number } };

export const getWallet = (env: PerplEnv, c: ApiCreds) => signedJson<PerplWallet>(env, c, "GET", "/v1/trading/wallet");
export const getOpenOrders = (env: PerplEnv, c: ApiCreds) => signedJson<{ sn: number; d: PerplOrder[] }>(env, c, "GET", "/v1/trading/orders");
export const getOpenPositions = (env: PerplEnv, c: ApiCreds) => signedJson<{ sn: number; d: PerplPosition[] }>(env, c, "GET", "/v1/trading/positions");

export async function getMarkets(env: PerplEnv): Promise<PerplMarket[]> {
  const res = await fetch(`${env.apiUrl}/v1/pub/context`);
  if (!res.ok) throw new PerplApiError(res.status, await res.text(), "GET /v1/pub/context");
  return ((await res.json()) as { markets: PerplMarket[] }).markets;
}

// ---------------------------------------------------------------- orders

export type OrderSpec = {
  rq: number; mkt: number; acc: number; oid?: number; t: number; p?: number; s?: number; fl: number; lv: number; lb: number;
  tp?: number; tpc?: number; lp?: number; tif?: number; mnp?: number; bf?: number;
};
export type Status = { code: number; error?: string };

// A batch is not a transaction: HTTP 200 only means the orders were judged, so every per-order status is returned for
// the caller to read. A batch refused as a whole (no trade scope, bad body) throws.
export async function submitOrders(env: PerplEnv, creds: ApiCreds, orders: OrderSpec[]): Promise<Status[]> {
  const reply = await signedJson<{ status: Status; statuses?: Status[] }>(env, creds, "POST", "/v1/trading/orders", JSON.stringify({ d: orders }));
  if (reply.status?.code) throw new PerplApiError(reply.status.code, reply.status.error ?? "", "POST /v1/trading/orders refused");
  const statuses = reply.statuses ?? [];
  if (statuses.length !== orders.length) throw new Error(`expected ${orders.length} order statuses, got ${statuses.length}`);
  return statuses;
}

// rq must be strictly increasing per account and above the account's lfr, and the Exchange stores the account's last
// forwarded and last triggered request ids as uint32. An rq of 2^32 or more (Date.now() in ms is 1.79e12) is accepted by
// the gateway, fails on chain as OrderDescIdTooLow, and the gateway then refuses every smaller rq for that account as
// "below last accepted". Seed from lfr, never from the clock.
export const MAX_REQUEST_ID = 0xffff_ffff;
export function nextRequestId(lfr: number): number {
  const rq = lfr + 1;
  if (rq > MAX_REQUEST_ID) throw new Error(`request id ${rq} does not fit the Exchange's uint32 last-request-id`);
  return rq;
}

export const toScaled = (price: number, decimals: number) => Math.round(price * 10 ** decimals);

// Stop-loss for a long is a CloseLong that fires when mark <= trigger; for a short a CloseShort when mark >= trigger.
// The trigger is a reduce-only close of the whole position, linked to it (lp) so it dies with the position, sent at
// market (p 0) as IOC once it fires. lb 0 is required on trigger orders. Shape per perpl-docs recipes.md "Set a
// take-profit / stop-loss".
export function stopLossSpec(pos: PerplPosition, market: PerplMarket, triggerPrice: number, rq: number, bf?: number): OrderSpec {
  const long = pos.sd === 1;
  const tp = toScaled(triggerPrice, market.config.price_decimals);
  const mark = market.state.mrk;
  if (tp <= 0) throw new Error(`trigger price ${triggerPrice} scales to ${tp}`);
  if (long ? tp >= mark : tp <= mark) {
    throw new Error(`a ${long ? "long" : "short"} stop-loss must trigger ${long ? "below" : "above"} mark ${mark / 10 ** market.config.price_decimals}, got ${triggerPrice}`);
  }
  return {
    rq, mkt: pos.mkt, acc: pos.acc, t: long ? ORDER_CLOSE_LONG : ORDER_CLOSE_SHORT, p: 0, s: pos.s, fl: ORDER_FLAG_IOC, lv: 0, lb: 0,
    tp, tpc: long ? TRIGGER_LTE_MARK : TRIGGER_GTE_MARK, lp: pos.pid,
    ...(bf !== undefined ? { bf } : {}),
  };
}

async function pollUntil<T>(what: string, read: () => Promise<T | null | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// A 0 status only says the gateway took the order. If the exchange then refuses it, the refusal is a st 7 (Failed) entry
// in order history carrying the request id and the reason in sr/fr, and nothing ever appears in open orders.
export const getOrderHistory = (env: PerplEnv, c: ApiCreds, count = 20) => signedJson<{ d: PerplOrder[] }>(env, c, "GET", `/v1/trading/order-history?count=${count}`);

async function failureFor(env: PerplEnv, creds: ApiCreds, rq: number, what: string): Promise<void> {
  const failed = (await getOrderHistory(env, creds)).d.find((o) => o.rq === rq && o.st === ORDER_STATUS_FAILED);
  if (failed) throw new Error(`${what} rq ${rq} failed on the exchange: sr ${failed.sr}${failed.fr ? ` fr ${failed.fr}` : ""}`);
}

async function forwardingAccount(env: PerplEnv, creds: ApiCreds, acc?: number): Promise<PerplAccount> {
  const wallet = await getWallet(env, creds);
  const account = acc === undefined ? wallet.as[0] : wallet.as.find((a) => a.id === acc);
  if (!account) throw new Error("wallet holds no matching exchange account");
  if (!account.fw) throw new Error(`account ${account.id} has order forwarding off: call allowOrderForwarding(true) on the Exchange from the account's wallet`);
  return account;
}

// Places a stop-loss on the caller's open position in `market` and returns the resting trigger order once the
// exchange lists it (a 0 status only acknowledges forwarding). Throws if there is no position, the order is refused,
// or it never appears.
export async function placeStopLoss(env: PerplEnv, creds: ApiCreds, p: { market: number; triggerPrice: number; bf?: number }): Promise<PerplOrder> {
  const [positions, markets, account] = await Promise.all([getOpenPositions(env, creds), getMarkets(env), forwardingAccount(env, creds)]);
  const pos = positions.d.find((x) => x.mkt === p.market && x.acc === account.id);
  if (!pos) throw new Error(`no open position in market ${p.market}`);
  const market = markets.find((m) => m.id === p.market);
  if (!market) throw new Error(`market ${p.market} not in /v1/pub/context`);
  const rq = nextRequestId(account.lfr);
  const [status] = await submitOrders(env, creds, [stopLossSpec(pos, market, p.triggerPrice, rq, p.bf)]);
  if (status.code !== 0) throw new PerplApiError(status.code, status.error ?? "", "stop-loss refused");
  return pollUntil(`stop-loss rq ${rq} in open orders`, async () => {
    const open = (await getOpenOrders(env, creds)).d.find((o) => o.rq === rq);
    if (!open) await failureFor(env, creds, rq, "stop-loss");
    return open;
  });
}

// Cancels a resting or trigger order and waits until it is gone from the open orders. A trigger order is only found by
// the gateway when the cancel repeats its trigger fields (tp, tpc, lp): a bare {t: 5, oid} answers sr 33
// OrderDoesNotExist even though the order is listed, so they are copied from the open order.
export async function cancelOrder(env: PerplEnv, creds: ApiCreds, o: { market: number; orderId: number; acc?: number }): Promise<void> {
  const account = await forwardingAccount(env, creds, o.acc);
  const target = (await getOpenOrders(env, creds)).d.find((x) => x.oid === o.orderId && x.mkt === o.market);
  if (!target) throw new Error(`order ${o.orderId} is not open in market ${o.market}`);
  const rq = nextRequestId(account.lfr);
  const trigger = target.tp ? { tp: target.tp, tpc: target.tpc, lp: target.lp } : {};
  const [status] = await submitOrders(env, creds, [{ rq, mkt: o.market, acc: account.id, oid: o.orderId, t: ORDER_CANCEL, fl: 0, lv: 0, lb: 0, ...trigger }]);
  if (status.code !== 0) throw new PerplApiError(status.code, status.error ?? "", "cancel refused");
  await pollUntil(`order ${o.orderId} gone from open orders`, async () => {
    if (!(await getOpenOrders(env, creds)).d.some((x) => x.oid === o.orderId)) return true;
    await failureFor(env, creds, rq, "cancel");
    return null;
  });
}

// ---------------------------------------------------------------- trading WebSocket

export type TradingSnapshot = { wallet: PerplWallet; orders: { d: PerplOrder[] }; positions: { d: PerplPosition[] } };

// Opens /ws/v1/trading, sends the signed ApiKeySignIn (mt 29) as the first frame and resolves with the three snapshots
// the server pushes after authenticating, then closes. A close before all three arrive rejects with the close code
// (3401 = bad sign-in, 1008 = rate limit or idle timeout).
export function readTradingSnapshot(env: PerplEnv, creds: ApiCreds, timeoutMs = 15_000): Promise<TradingSnapshot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(env.wsUrl);
    const got: Partial<Record<number, unknown>> = {};
    const timer = setTimeout(() => { reject(new Error(`trading ws: no snapshots within ${timeoutMs}ms (got mt ${Object.keys(got).join(",") || "none"})`)); ws.close(); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify(wsSignInFrame(env, creds)));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { mt: number; status?: Status };
      if (m.mt === MSG_STATUS && m.status?.code) { clearTimeout(timer); reject(new Error(`trading ws status ${m.status.code} ${m.status.error ?? ""}`)); ws.close(); return; }
      if ([MSG_WALLET_SNAPSHOT, MSG_ORDERS_SNAPSHOT, MSG_POSITIONS_SNAPSHOT].includes(m.mt)) got[m.mt] = m;
      if (got[MSG_WALLET_SNAPSHOT] && got[MSG_ORDERS_SNAPSHOT] && got[MSG_POSITIONS_SNAPSHOT]) {
        clearTimeout(timer);
        // resolve first: close() can fire onclose synchronously, and its reject must find the promise already settled
        resolve({ wallet: got[MSG_WALLET_SNAPSHOT] as PerplWallet, orders: got[MSG_ORDERS_SNAPSHOT] as { d: PerplOrder[] }, positions: got[MSG_POSITIONS_SNAPSHOT] as { d: PerplPosition[] } });
        ws.close();
      }
    };
    ws.onclose = (ev) => { clearTimeout(timer); reject(new Error(`trading ws closed ${ev.code} ${ev.reason}`)); };
    ws.onerror = () => { /* onclose follows with the code */ };
  });
}
