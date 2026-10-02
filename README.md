# frens

Your frens' Perpl perps on one live chart. Call their exit; they take it with one signature.

**Live:** https://frenstrade.vercel.app (Monad testnet by default, Testnet and Mainnet switch at the top right)

**Demo room with a call waiting:** open the live site, pick a testnet market nobody traded in the last six
hours, and follow "See a room where a fren's call is waiting", or use the first link in `demo/ROOMS.md`.

## What it does

- **Faces on the candles.** Every fren's real Perpl position appears as their face at the candle where they
  entered, ringed green for long and red for short, with live PnL. Positions are read from Perpl's Exchange
  contract on Monad, so they cannot be posted as a screenshot or faked.
- **Calls.** Drag a take-profit onto a fren's position and send the link. They see your face riding the line
  on their chart and tap Accept: one signature places a real resting close order on Perpl. When they already
  hold a take-profit, the cancel and the new close go out in one `execOrders` batch.
- **A call record nobody can fake.** The caller's address is written into the order's `orderDescId`. Room links
  carry the accept receipts, and frens verifies each one against the chain: calls taken, and hits, where a hit
  means Perpl's price reached the caller's TP after it was taken. Taken calls still on Perpl's book are drawn on
  the chart and on the owner's card.
- **Put money behind a call.** After taking a call, the owner can stake aUSD on it. The stake pays the caller only
  if Perpl's own mark price reaches the call's TP before expiry, and returns to the owner otherwise. The contract
  reads the TP, side and owner from the resting Perpl order itself, so a stake always matches the real order, and
  anyone can trigger the payout once the price is there. Callers' earnings show next to their record in the room.
- **One-tap copy.** Copy a fren's trade at your own size from your own wallet; the order carries the copied
  fren in `orderDescId`, so copies are attributable on chain the same way calls are.
- **No wallet needed to start.** Sign in with a passkey (Category Labs Mera: no extension, no seed phrase). A
  wallet Perpl has never seen opens its Perpl account inside frens at Perpl's live minimum deposit, then copies.
- **Rooms that spread.** Share a room to X or Telegram with a card showing the frens, their sides, PnL and calls
  taken; phones get the native share sheet. Rooms update within a second from Monad's monadLogs push.
- **Live on Perpl.** A read-only view of every trader who opened a position in the last six hours, mainnet or
  testnet, to find people worth calling.

## Proof on chain (Monad testnet, Perpl Exchange 0x1964C32f0bE608E7D29302AFF5E61268E72080cc)

| What | Transaction |
|---|---|
| A call taken and filled (a hit), caller read back from `orderDescId` | 0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a |
| A call that replaced a resting TP in one batch | 0xeb51040c5bc7cd08695750d237eed7d3cef3a80b0d18e976c19bbcdb5814d2e4 |
| A passkey wallet created in the browser, Perpl account opened in frens, fren copied | 0x9801c9cb20fc3a901c59d24b0d2862ef333a6c45e7fb8ddb27f77cd4a826ef93 |
| The same passkey wallet taking a fren's call from the chart | 0x2d17f22d7081323c6a2e3146091ba51b19cb55ffd9530305801fb7cdd5bbc120 |
| CallStake deployed (0x0E8CbE0902067a49d98961A1440419AEcAf0C5Bc) | 0xbb66d0dbcd0a760c5b5d017500b95baab4ebfa620f1d538b00d9b30e9a468325 |
| A stake on cy's call, TP read from bo's resting Perpl order | 0xc6913d2e44066a12a43e57b1edd1dee2d6440c822b648ef6bc5144b8ce1ee861 |

Every row is re-checkable: `bun run demo/check-hit.ts <tx>` decodes the caller and checks the hit against
Perpl's candles; `bun run demo/adoption.ts testnet <hours>` counts orders carrying a frens `orderDescId`.

## How it is built

- `web/`: Next.js app. `lib/` holds the chain logic: `readPosition` (positions from `getPositionV2`),
  `suggest` (call payloads and close orders), `receipts` (call records from receipts), `callhit` (hits from
  candles), `resting` (live TPs), `copy`, `onboard` (Perpl account opening), `passkey` (Mera), `roomfeed`
  (monadLogs push), `marketws` (Perpl candle WebSocket).
- Hosting: the site is a static export with no serverless functions; `/api/*` and link-preview requests are
  served by a Next.js server that reads Monad through a private RPC (`scripts/build-static.sh`,
  `scripts/deploy-mini.sh`).
- `contracts/`: `CallStake.sol`, with unit, fuzz and fork tests against Perpl's testnet Exchange (`forge test`).
- `demo/`: scripts that seed and drive the testnet demo room with real transactions (keys in a gitignored file).
- `spike/`: the original proofs, including the caller surviving on chain in `orderDescId`.

## Run it

    cd web && bun install && bun run dev          # the app on your machine
    bun test                                       # 300+ tests, including chain decoding and order encoding
    MONAD_RPC_URL=... MONAD_TESTNET_RPC_URL=...     # server-side RPC for the live view, in web/.env.local

Built for Monad Metropolis, Track 03: Social, Attention & Culture.
