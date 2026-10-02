import { afterEach, describe, expect, it } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hashTypedData, hexToBytes, stringToBytes } from "viem";
import {
  MAX_REQUEST_ID,
  ORDER_CLOSE_LONG,
  ORDER_CLOSE_SHORT,
  PERPL_ENV,
  TRIGGER_GTE_MARK,
  TRIGGER_LTE_MARK,
  base64url,
  enrollApiKey,
  generateApiKeyPair,
  nextRequestId,
  randomNonce,
  restCanonical,
  restHeaders,
  signCanonical,
  stopLossSpec,
  wsSignInCanonical,
  wsSignInFrame,
  type PerplMarket,
  type PerplPosition,
  type TypedData,
} from "./perplapi";

const env = PERPL_ENV.testnet;
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const verify = (sig: string, canonical: string, pub: Uint8Array) => ed25519.verify(b64urlToBytes(sig), stringToBytes(canonical), pub);

describe("canonical strings", () => {
  it("REST: chain id, method, target, timestamp, nonce, sha256(body) joined by newlines", () => {
    const c = restCanonical({ chainId: 10143, method: "GET", target: "/v1/trading/fills?count=100", timestamp: "1790960000000", nonce: "bm9uY2U", body: "" });
    expect(c).toBe(["10143", "GET", "/v1/trading/fills?count=100", "1790960000000", "bm9uY2U", SHA256_EMPTY].join("\n"));
    expect(c.split("\n")).toHaveLength(6);
  });

  it("REST: hashes the raw body, hex without 0x", () => {
    const c = restCanonical({ chainId: 10143, method: "POST", target: "/v1/trading/orders", timestamp: "1", nonce: "n", body: "abc" });
    // sha256("abc") from FIPS 180-2
    expect(c.split("\n")[5]).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("WS sign-in: chain id, literal tag, timestamp, nonce", () => {
    expect(wsSignInCanonical({ chainId: 10143, timestamp: "1790960000000", nonce: "bm9uY2U" })).toBe("10143\ntrading-ws-signin\n1790960000000\nbm9uY2U");
  });
});

describe("Ed25519 signing", () => {
  it("matches RFC 8032 test vector 1 (empty message), base64url without padding", () => {
    const sk = hexToBytes("0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    expect(bytesToHex(ed25519.getPublicKey(sk))).toBe("0xd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    const sig = signCanonical(sk, "");
    expect(bytesToHex(b64urlToBytes(sig))).toBe(
      "0xe5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
    expect(sig).not.toMatch(/[=+/]/);
  });

  it("REST headers carry a signature over exactly the canonical string, and no other", () => {
    const pair = generateApiKeyPair();
    const creds = { apiKey: "tok", secretKey: pair.secretKey };
    const body = JSON.stringify({ d: [] });
    const h = restHeaders(env, creds, "POST", "/v1/trading/orders", body, 1790960000000, "bm9uY2U");
    expect(h["X-API-Key"]).toBe("tok");
    expect(h["X-API-Timestamp"]).toBe("1790960000000");
    expect(h["X-API-Nonce"]).toBe("bm9uY2U");
    const good = restCanonical({ chainId: 10143, method: "POST", target: "/v1/trading/orders", timestamp: "1790960000000", nonce: "bm9uY2U", body });
    expect(verify(h["X-API-Signature"]!, good, pair.publicKey)).toBe(true);
    // the same signature must fail against every field the server would read differently
    for (const wrong of [
      good.replace("10143", "143"),
      good.replace("POST", "GET"),
      good.replace("/v1/trading/orders", "/api/v1/trading/orders"),
      good.replace("1790960000000", "1790960000001"),
      good.replace("bm9uY2U", "bm9uY2V"),
      restCanonical({ chainId: 10143, method: "POST", target: "/v1/trading/orders", timestamp: "1790960000000", nonce: "bm9uY2U", body: "" }),
      good.split("\n").join("\r\n"),
    ]) {
      expect(verify(h["X-API-Signature"]!, wrong, pair.publicKey)).toBe(false);
    }
  });

  it("sets Content-Type only when there is a body", () => {
    const creds = { apiKey: "tok", secretKey: generateApiKeyPair().secretKey };
    expect(restHeaders(env, creds, "GET", "/v1/trading/wallet")["Content-Type"]).toBeUndefined();
    expect(restHeaders(env, creds, "POST", "/v1/trading/orders", "{}")["Content-Type"]).toBe("application/json");
  });

  it("WS sign-in frame is mt 29 with a signature over the WS canonical string", () => {
    const pair = generateApiKeyPair();
    const f = wsSignInFrame(env, { apiKey: "tok", secretKey: pair.secretKey }, 1790960000000, "bm9uY2U");
    expect(f).toMatchObject({ mt: 29, chain_id: 10143, api_key: "tok", timestamp: "1790960000000", nonce: "bm9uY2U" });
    expect(verify(f.signature, "10143\ntrading-ws-signin\n1790960000000\nbm9uY2U", pair.publicKey)).toBe(true);
    expect(verify(f.signature, "10143\ntrading-ws-signin\n1790960000001\nbm9uY2U", pair.publicKey)).toBe(false);
  });

  it("nonces are 16 random bytes as unpadded base64url and never repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, randomNonce));
    expect(seen.size).toBe(50);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe("-__-");
  });
});

// Payload shape captured from POST https://testnet.perpl.xyz/api/v1/api-key/payload (2026-10-02): uint fields come back as hex strings.
const livePayload: { typed_data: TypedData; mac: string } = {
  typed_data: {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
        { name: "salt", type: "bytes32" },
      ],
      PerplRegisterApiKey: [
        { name: "signer", type: "address" },
        { name: "statement", type: "string" },
        { name: "publicKey", type: "string" },
        { name: "scope", type: "string" },
        { name: "label", type: "string" },
        { name: "expiresAt", type: "string" },
        { name: "ipCidrs", type: "string" },
        { name: "origin", type: "string" },
        { name: "builderId", type: "string" },
        { name: "maxBuilderFeePer100K", type: "string" },
        { name: "time", type: "uint64" },
      ],
    },
    primaryType: "PerplRegisterApiKey",
    domain: { name: "perpl.xyz", version: "1", chainId: "0x279f", verifyingContract: "0x0000000000000000000000000000000000000000", salt: "0x00000000000000000000000000000000000000006abfe090def173c38d3e795a" },
    message: {
      builderId: "0", expiresAt: "0", ipCidrs: "", label: "frens probe", maxBuilderFeePer100K: "0", origin: "",
      publicKey: "uASwsP20YgwO-jDbFZv7F1us1raKhLJVyxvvM5OAoYA", scope: "3", signer: "0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953",
      statement: "I authorize the creation of Perpl API key with the specified scope and parameters", time: "0x1a0fd853422",
    },
  },
  mac: "0x9acd2ef07bc27006959f6c2faa62b484a46f892b79b4c53f6f31c4cd613593fa",
};

describe("enrollment", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("sends the wallet the typed data without EIP712Domain, proves key possession over the EIP-712 digest, echoes typed_data and mac", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), body });
      const reply = String(url).endsWith("/payload") ? livePayload : { api_key: { api_key: "tok", address: "0xabc", scope_mask: 2, label: "x", origin: "", expires_at: 0 } };
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;

    let signed: TypedData | undefined;
    const pair = generateApiKeyPair();
    const { creds, info } = await enrollApiKey(env, {
      address: "0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953", label: "frens probe", builderId: 23, maxBuilderFeePer100k: 0, keyPair: pair,
      signTypedData: async (td) => { signed = td; return "0xdeadbeef"; },
    });

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/v1/api-key/payload", "/api/v1/api-key/enroll"]);
    expect(calls[0]!.body).toMatchObject({ chain_id: 10143, public_key: pair.publicKeyHex, scope_mask: 2, label: "frens probe", builder_id: 23, max_builder_fee_per_100k: 0 });
    expect(Object.keys(signed!.types)).toEqual(["PerplRegisterApiKey"]);
    expect(signed!.domain.chainId).toBe(10143n);
    expect(signed!.message.time).toBe(0x1a0fd853422n);

    const enroll = calls[1]!.body;
    expect(enroll.typed_data).toEqual(livePayload.typed_data);
    expect(enroll.mac).toBe(livePayload.mac);
    expect(enroll.signature).toBe("0xdeadbeef");
    const digest = hashTypedData({ domain: signed!.domain, types: signed!.types, primaryType: signed!.primaryType, message: signed!.message } as Parameters<typeof hashTypedData>[0]);
    const pop = hexToBytes(enroll.pop_signature as `0x${string}`);
    expect(ed25519.verify(pop, hexToBytes(digest), pair.publicKey)).toBe(true);
    expect(ed25519.verify(pop, hexToBytes(digest.replace(/.$/, digest.endsWith("0") ? "1" : "0") as `0x${string}`), pair.publicKey)).toBe(false);
    expect(creds.apiKey).toBe("tok");
    expect(info.scope_mask).toBe(2);
  });
});

describe("stop-loss order", () => {
  const market: PerplMarket = { id: 16, symbol: "BTC", order_ttl_blocks: 20, config: { price_decimals: 1, size_decimals: 5 }, state: { mrk: 852350 } };
  const long: PerplPosition = { mkt: 16, acc: 777, pid: 4430093352961, st: 1, sd: 1, s: 100, ep: 852319, lv: 300, c: "28430634" };
  const short: PerplPosition = { ...long, sd: 2 };

  it("long: CloseLong, LTEMark trigger below mark, whole size, linked to the position, lb 0", () => {
    expect(stopLossSpec(long, market, 82680.9, 5)).toEqual({
      rq: 5, mkt: 16, acc: 777, t: ORDER_CLOSE_LONG, p: 0, s: 100, fl: 4, lv: 0, lb: 0, tp: 826809, tpc: TRIGGER_LTE_MARK, lp: 4430093352961,
    });
  });

  it("short: CloseShort, GTEMark trigger above mark", () => {
    const spec = stopLossSpec(short, market, 87000, 6);
    expect(spec).toMatchObject({ t: ORDER_CLOSE_SHORT, tp: 870000, tpc: TRIGGER_GTE_MARK });
  });

  it("refuses a trigger on the winning side or at the mark", () => {
    expect(() => stopLossSpec(long, market, 87000, 1)).toThrow(/below mark/);
    expect(() => stopLossSpec(long, market, 85235, 1)).toThrow(/below mark/);
    expect(() => stopLossSpec(short, market, 80000, 1)).toThrow(/above mark/);
  });

  it("carries the builder fee only when asked", () => {
    expect(stopLossSpec(long, market, 82680.9, 5).bf).toBeUndefined();
    expect(stopLossSpec(long, market, 82680.9, 5, 10).bf).toBe(10);
  });
});

describe("request ids", () => {
  it("are lfr + 1 and refuse to leave the Exchange's uint32", () => {
    expect(nextRequestId(0)).toBe(1);
    expect(nextRequestId(41)).toBe(42);
    expect(nextRequestId(MAX_REQUEST_ID - 1)).toBe(MAX_REQUEST_ID);
    expect(() => nextRequestId(MAX_REQUEST_ID)).toThrow(/uint32/);
    // Date.now() in ms is what the gateway accepted and the Exchange failed with OrderDescIdTooLow
    expect(() => nextRequestId(1790960025946)).toThrow(/uint32/);
  });
});
