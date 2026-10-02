# Perpl builder codes for frens (read 2026-10-02)

Sources: https://docs.perpl.xyz/resources/for-developers/api/builder-codes (read through r.jina.ai), and Perpl's
Arch replying to PERPL_ASK.md on 2026-10-02 15:25 IST (pasted by Kamal). Kamal filled the builder form the same day;
builder id and the API origin whitelist are pending on Perpl.

## What the docs say

- A builder id is a uint8 (1..255), issued by Perpl, bound to an API key AT ENROLLMENT. An order never names its own
  code; the code comes from the authenticating key.
- The fee (`bf`, per_100k, max 100 = 0.1%) is set per order on the trading WebSocket (`mt: 22`). Omitting `bf`
  still attributes the order to the builder at zero fee.
- The fee applies only to size that OPENS or INCREASES a position. Closing or reducing fills carry no builder fee.
- "Builder fees only exist on orders routed through the API. Orders a user sends directly on-chain cannot be
  attributed to a builder."
- The end user signs the EIP-712 enrollment payload (builderId, maxBuilderFeePer100K, and a statement naming the
  builder); frens generates the Ed25519 key pair. Users can revoke the key on their /apikeys page.

## Resolved on chain, 2026-10-02 18:xx: Arch was right

Perpl issued builder id 23 (CORS enabled for the API too). A wallet-signed execOrderV2 with the envelope from the
dex-sdk (abi.encode(uint16 1, abi.encode(uint256 builderId, uint256 feePer100K))) placed resting order 124 that reads
back builderId 23 and builderFeePer100K 50 (tx 0x78f22dc08df837f14f106289eeaa9f8b7ab5a7165e7aadba8322f7e8e76cf189),
then cancelled (0x0696656491d1f7f0fb74d85a2ecd20fb56d610333db659165e8eae8dfb827c9b). spike/builder-probe.ts re-runs
it. So direct wallet orders carry attribution AND a fee (up to 1,000 per 100k = 1%, on the size an order opens or
increases); the API docs page describes only its own WebSocket path. No API key is needed for copies.

## Conflict, reported rather than resolved (superseded by the section above)

Arch answered "yes" to: does execOrderV2 with a builder extension accept attribution on orders a wallet signs
directly, without an API key. The docs say direct on-chain orders cannot be attributed. Better evidenced for
FEES: the docs (specific, and they describe the enforcement). Possibly both true if the on-chain extension carries
attribution but no fee. Settle it on testnet once the id arrives: send one execOrderV2 with the extension and read
whether attribution or a fee appears.

## What this changes for frens

- A taken call is a take-profit, which REDUCES a position, so it carries no builder fee. "A hit pays the caller out
  of builder fees" (the judge's pass-1 fix) does not work through builder codes.
- Copies OPEN positions, so a copy routed through a builder-bound key can carry a fee. The natural payout is to the
  fren being copied: copy rewards, the trader whose position friends copy earns from the copies.
- Stop-loss calls need the API trigger orders and the origin whitelist (Arch: correct; whitelist after the form).

## Plan once the id and whitelist land

1. Enrollment in the app: generate an Ed25519 key in the browser, fetch /v1/api-key/payload with builder_id and a
   ceiling, have the user's wallet sign once, POST /enroll. Passkey wallets sign silently.
2. Route copies through the WebSocket `mt: 22` with `bf` set; keep calls (closes) on the direct execOrder path.
3. Pay the copied fren a share of accrued builder fees, from the builder account, with the split shown in the room.
4. Caller rewards stay separate: either a tip at accept (an aUSD transfer the owner signs alongside Accept) or a
   share of copy fees credited to callers whose calls hit.
