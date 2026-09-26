# Perpl builder codes: how attribution actually works

Date of research: 2026-09-26. Mainnet Exchange proxy `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`, RPC `https://rpc.monad.xyz`.

## 1. How a builder code is attached

Two independent attachment paths exist, one on-chain and one off-chain (API). Neither is what our local `src/exchange.abi.json` (REVISION `rc_v1.1.7-203-g0e5902dd`) shows: that copy is a hand-pruned subset of the real ABI and is missing the V2 entrypoints entirely.

### On-chain path: `execOrderV2` (a different function, not a struct field)

Source: `PerplFoundation/dex-sdk`, `crates/sdk/abi/dex/Exchange.json` (raw: https://raw.githubusercontent.com/PerplFoundation/dex-sdk/main/crates/sdk/abi/dex/Exchange.json) and `crates/sdk/src/types/extension.rs` (https://github.com/PerplFoundation/dex-sdk/blob/main/crates/sdk/src/types/extension.rs).

The live Exchange contract exposes, on top of the functions our local ABI already has:

- `execOrderV2(OrderDesc orderDesc, bytes extension)`
- `execOrdersV2(OrderDesc[] orderDescs, bool revertOnFail, bytes[] extensions)`
- `execFwdPositionOpsV2(FwdOrderDesc[] forwardedOrders, bytes[] extensions)` (this one **is** already in our local ABI, just not the singular `execOrderV2`)
- event `OrderExtensionRejected(uint256 perpId, uint256 accountId)`

`extension` is not a new struct field on `OrderDesc`, it is an opaque `bytes` argument. Its encoding, per `extension.rs`:

```
abi.encode(uint16 version, bytes payload)   // version = 1
payload = abi.encode(uint256 builderId, uint256 builderFeePer100K)
```

`builderId` must fit `uint8` (1..255), `builderFeePer100K` must be `<= 1000` (1%, `MAX_BUILDER_FEE_PER_100K` in the SDK, i.e. the contract-level ceiling; the API's own key-level ceiling is stricter, see below). An empty `extension` (`0x`) is the explicit no-builder fast path. A structurally malformed or oversized (>256 bytes) envelope reverts the whole call; an unsupported version or out-of-range fee on the batched/forwarded paths just skips that one order and emits `OrderExtensionRejected`, it does not revert the batch.

**On-chain verification (block 108200991):**
- EIP-1967 implementation slot on the proxy (`cast storage 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url https://rpc.monad.xyz`) resolves to implementation `0xa9Ab97A404A0bCA04d6A5b4a39995feA9E791b2A`.
- `cast sig "execOrderV2((uint256,uint256,uint8,uint256,uint256,uint256,uint256,bool,bool,bool,uint256,uint256,uint256,uint256,uint256),bytes)"` → selector `0x28d18da3`.
- `cast sig "execOrdersV2((uint256,uint256,uint8,uint256,uint256,uint256,uint256,bool,bool,bool,uint256,uint256,uint256,uint256,uint256)[],bool,bytes[])"` → selector `0x81e54cba`.
- Both selectors are present verbatim in `cast code 0xa9Ab97A404A0bCA04d6A5b4a39995feA9E791b2A --rpc-url https://rpc.monad.xyz` at block 108200991. This confirms `execOrderV2`/`execOrdersV2` are deployed on mainnet today, not just documented.
- monadscan/etherscan-v2 ABI endpoints were tried and returned "deprecated V1 endpoint" / "Missing/Invalid API Key" respectively; no verified-source ABI was retrievable that way. The GitHub source (above) plus the live selector match substitute for it here.
- Our local ABI's `getOrderV2(perpId, orderId)` return struct already carries `builderId (uint8)` and `builderFeePer100K (uint16)` on the `OrderV2` struct, so the order-storage layout already reflects builder attribution; this part of our copy is current, only the write-side `execOrderV2`/`execOrdersV2` functions are missing from it.

### Off-chain path: API key enrollment + `bf` field (this is the one Perpl expects integrations to use)

Source: `PerplFoundation/perpl-docs`, `docs/resources/for-developers/api/builder-codes.md` and `PerplFoundation/api-docs`, `integrations.md` (both public repos, fetched via `gh api repos/.../contents/...`).

- A builder id (`1..255`) is bound to a specific enrolled API key **at enrollment time**, via two extra fields on the `POST /api/v1/api-key/payload` request: `builder_id` and `max_builder_fee_per_100k`.
- Orders are placed over the trading WebSocket (`mt: 22`), and a builder-bound key adds a `bf` field (fee in `per_100k`, must be `<=` the key's enrolled ceiling). There is deliberately **no `builder_id` on the order request** — attribution comes from which key signed it, so one integration cannot attribute another's flow to itself.
- This is the documented, supported way for an app like ours to attach a builder code; the on-chain `execOrderV2` extension exists as the underlying settlement mechanism the API's `bf` field compiles down to for API-routed orders, but Perpl's own docs say plainly: **"Builder fees only exist on orders routed through the API. Orders a user sends directly on-chain cannot be attributed to a builder."** So a wallet-signed direct `execOrderV2` call from an end user's own wallet, outside the API/key flow, is not eligible for builder attribution even though the ABI supports the extension bytes, per this doc. (This directly answers the second open question in our own `PERPL_ASK.md` draft: no, a bare wallet-signed `execOrderV2` call does not get attributed, only orders through an enrolled builder-bound API key do.)

## 2. Registration and fee mechanics

- **Registering as a builder is not self-service.** Contact Perpl; they issue a `builder id` (1..255) against a display name and a Perpl account address that accrued fees settle to. (`builder-codes.md`)
- **Fee unit:** `per_100k`, 1 = 0.1 bps = 0.001%. Max a key can be enrolled with is `100` (0.1%) per the API docs' key-ceiling table (a separate, environment-level ceiling can be lower); the on-chain envelope's own hard ceiling is `1000` per_100k (1%, `MAX_BUILDER_FEE_PER_100K` in `extension.rs`).
- **User must approve a ceiling, Hyperliquid-style, yes.** The enrollment is a single EIP-712 wallet signature over a payload whose fields include `builderId` and `maxBuilderFeePer100K`, plus a human-readable `statement` naming the builder and the ceiling as a percentage, this is what the user actually reads before signing. `/api-key/enroll` re-derives that statement from the builder registry and rejects the enrollment if it doesn't match what was signed (so a builder can't quietly rename itself post-signature). There is no separate builder-side approval, the user's one signature is both the key enrollment and the fee authorization.
- `max_builder_fee_per_100k: 0` with a `builder_id` set is valid: attribution with zero fee (useful for `read`-scope keys or for volume credit without charging).
- Each order can charge anywhere from 0 up to the enrolled ceiling via `bf`; a fee above the ceiling is rejected outright (400, `builder fee not permitted for this api key`), never silently clamped.
- The builder fee applies to size that opens/increases a position (per `builder-codes.md` in `perpl-docs`; the `api-docs` integrations.md copy of the same page instead says it applies to every position-changing fill including closes, the two docs disagree on this one point, flagging it as UNVERIFIED which is authoritative pending a Perpl reply).
- Fees settle **per builder code, on a periodic epoch schedule**, to the registered Perpl account. No fixed cadence is published (contrast with the separate referral program, which explicitly snapshots weekly and pays biweekly).
- This is a **separate program from referrals** (`docs/exchange/referrals.md`): referrals reward inviting traders (10% first-degree / 5% second-degree of fees) and are self-service via an invite code; builder codes reward routing order flow through your integration and require operator registration.

## 3. Restrictions on copy trading / third-party order placement

- No restriction specific to copy trading or third-party order placement was found in Perpl's docs repos (`perpl-docs`, `api-docs`) or in the Terms of Use.
- `perpl.xyz/terms-of-use` section 3.1.8 ("Automated or High-Frequency Abuses") is the only relevant clause: it prohibits bots/scripts that "exceed reasonable usage," bypass rate limits, cause denial-of-service, or disrupt normal operation, it is an abuse/rate-limit clause, not a ban on automation, copy trading, or third-party order placement as such.
- The API docs explicitly design for third-party integrations placing orders on a user's behalf: `integrations.md` opens with "This page is for third-party services, trading terminals, bots, portfolio trackers, that integrate with Perpl on behalf of a user's wallet," and requires only origin whitelisting (contact Perpl) plus the wallet-signed key enrollment above. No prohibition on copy trading found. UNVERIFIED beyond this: whether a not-yet-published risk/compliance policy (e.g. a Restricted Persons list referenced elsewhere in the ToU) affects specific jurisdictions; not fetched in full.
- Separately, `PerplFoundation/delegated-account` (https://github.com/PerplFoundation/delegated-account) ships a `DelegatedAccount` contract for exactly this "someone else places your orders" pattern: owner (fund custody, withdrawals) vs. operator (hot wallet, can call `execOrder`/`execOrders` and a few others via an on-chain selector allowlist, cannot withdraw). Its default operator allowlist does **not** include `execOrderV2`/`execOrdersV2` (only the pre-builder-code `execOrder`/`execOrders`), so a DelegatedAccount owner would need to explicitly add the V2 selectors via `setOperatorAllowlist` to let an operator place builder-attributed on-chain orders on their behalf, another point cutting against relying on the on-chain path.

## Sources

- https://github.com/PerplFoundation/perpl-docs/blob/main/docs/resources/for-developers/api/builder-codes.md
- https://github.com/PerplFoundation/api-docs/blob/main/integrations.md
- https://github.com/PerplFoundation/dex-sdk/blob/main/crates/sdk/src/types/extension.rs
- https://raw.githubusercontent.com/PerplFoundation/dex-sdk/main/crates/sdk/abi/dex/Exchange.json (method list + selectors, checked 2026-09-26)
- https://github.com/PerplFoundation/perpl-docs/blob/main/docs/exchange/referrals.md
- https://github.com/PerplFoundation/delegated-account (README, default operator allowlist)
- `cast storage` / `cast code` / `cast sig` against `https://rpc.monad.xyz`, block 108200991, 2026-09-26 (commands above)
- https://perpl.xyz/terms-of-use, section 3.1.8 and 1.3
- https://x.com/perpltrade/status/2096261814812115309 (August Updates: "builder codes program live, with a leaderboard"), fetched via `bhn deepsurge`, 2026-09-26
- Our own draft outreach, `PERPL_ASK.md`, for the open questions this closes

## Blind spots

- No verified/audited ABI could be pulled from a block explorer (monadscan v1 deprecated, etherscan-v2 needs a key we don't have); the GitHub source is not independently notarized against the deployed bytecode beyond the selector match performed here. A full 4-byte-selector sweep of the implementation's jump table (rather than a grep for two known selectors) was not done.
- No real builder-attributed order was observed on mainnet (no known perpId/orderId with a nonzero `builderId`/`builderFeePer100K` was queried via `getOrderV2`), so the mechanism is verified structurally (bytecode + docs + SDK code) but not by a live example.
- `builder-codes.md` (perpl-docs) and `integrations.md` (api-docs) disagree on whether the builder fee applies only to opening/increasing fills or to every position-changing fill; flagged above, unresolved.
- Whether Perpl enforces any jurisdiction/compliance restriction on copy trading beyond the generic automated-abuse clause was not confirmed; the full Terms of Use was read via a single AI-summarized fetch, not verbatim line by line.
- The environment-level cap on `max_builder_fee_per_100k` (the docs say "above the environment ceiling" is a 400) was not independently determined; only the documented default max of `100` (0.1%) and the contract-level `1000` (1%) ceiling are confirmed.
