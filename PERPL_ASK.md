DRAFT, not sent (Kamal sends). For the Perpl team: Discord builder channel (`builderApplyUrl` in /api/v1/pub/context),
@perpltrade, or gvan (Head of Growth), who already has our builder_id question through the Metropolis mentor channel.
Rewritten 2026-10-02; the 2026-09-26 version asked for the same builder code under the old name Chartroom.

---

Hi Perpl team,

We're building frens for Monad Metropolis: your friends' real Perpl positions as faces on one live chart. A friend drags a take-profit onto your position and sends it, you take it with one signature as a real resting close on Perpl, and the caller's address rides in the order's orderDescId, so every caller's record (calls taken, hits) is
read from chain. One-tap copy places the copier's own order, tagged with the fren they copied.
Live on testnet: https://frens-eosin.vercel.app

Verified on your testnet Exchange (0x1964...80cc), all through our UI or our scripts:
- a call taken and filled (a hit): tx 0x7bff5155..., caller read back from orderDescId
- a brand-new passkey wallet opening its Perpl account inside frens, copying a fren (0x9801c9cb...) and taking
  a call from the chart (0x2d17f22d...)
- a call that replaces an existing TP: cancel and new close in one execOrders batch

Three asks, most important first:

1. **A builder code, with the fee able to reach the caller.** Display name "frens", payout to the Perpl account
   of 0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953 (it has a testnet account; we open the mainnet one as soon as
   the code is issued). We want a hit to pay the friend who called it: when a taken
   call fills, part of the builder fee goes to the caller. Can the builder fee recipient be set per order (so we
   name the caller on each accepted TP), or is it fixed per builder account, in which case we pay callers out of
   our builder fees ourselves?
2. **Testnet aUSD for 0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953.** About 2,000. The Agora faucet
   (0xd236c18d274e54faccc3dd9dda4b27965a73ee6c) has been empty for weeks, and judges and first users need funded
   passkey wallets to try a call (your testnet minimum to open an account is 100 aUSD).
3. **A slot in front of your traders.** A post or a room with traders who already share PnL, or a pointer to the
   right Telegram group, so our first rooms are with real Perpl traders rather than our demo wallets.

Two technical questions:
- Does `execOrderV2` with a builder extension accept attribution on orders a wallet signs directly, without an
  API key? The dex-sdk `prepare_v2` suggests yes.
- Stop-losses only exist as API trigger orders. Is an origin whitelist for programmatic key enrollment
  (`/v1/api-key/payload` + `/enroll`) still the route, and would you whitelist https://frens-eosin.vercel.app?

Thanks!
