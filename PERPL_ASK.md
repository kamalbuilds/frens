DRAFT, not sent. For the Perpl team (Discord builder channel, per `builderApplyUrl` in /api/v1/pub/context, or @perpltrade).

---

Hi Perpl team,

We're building Chartroom for Monad Metropolis. It's a chart-first Perpl frontend where friends see each other's live positions on the candles, suggest a TP or SL on your position, and open their own position on top of yours. It's aimed at your "Best use of Perpl's API" bounty.

So far we have:
- a reader that decodes any account's open position from `getPositionV2` (side, size, entry, mark, uPnL), checked against your own delta PnL on mainnet
- open, resting take-profit, close and cancel through `execOrder`, tested on a fork of testnet Exchange `0x1964...80cc`

We'd like to ask for three things:

1. **Testnet aUSD for `0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953`.** About 500 would be plenty. The Agora faucet at `0xd236c18d274e54faccc3dd9dda4b27965a73ee6c` reverts `InsufficientFunds()`. It holds exactly one drip and `requestFunds` needs more than that. Without aUSD we can't open a testnet account (min 100).
2. **API origin whitelisting** for programmatic key enrollment (`/v1/api-key/payload` + `/enroll`). Stop losses and trigger take-profits only exist as API trigger orders, so a user accepting a friend's SL has to go through a trade-scoped key our app enrolls for them. Origins: `http://localhost:3000` for testnet now, and our production domain once it's deployed.
3. **A builder code.** Display name "Chartroom", payout to the Perpl account of `0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953`. We plan to send part of the builder fee to the friend whose suggested TP/SL gets accepted. That way a good call earns its author something.

Two quick questions:
- Do trigger orders placed by a builder-bound key show in `position-history`, with enough detail to credit the suggester?
- Does `execOrderV2` with a builder extension accept attribution on orders a wallet signs directly, without an API key? The dex-sdk `prepare_v2` suggests it does.

Thanks!
