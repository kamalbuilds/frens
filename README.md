# frens

Copy a fren's live Perpl position at your size. Set max slippage, approve the order in your wallet, and Perpl records which fren you copied.

**Live:** https://frenstrade.vercel.app (Monad testnet by default, Testnet and Mainnet switch at the top right)

**Demo room with a call waiting:** open the live site, pick a testnet market nobody traded in the last six
hours, and follow "See a room where a fren's call is waiting", or use the first link in `demo/ROOMS.md`.

## The friend-approved action

- **Start from a real Perpl position.** Choose a fren from the chart. Positions and entry prices are decoded from Perpl's Exchange contract.
- **Choose your own execution.** Copy the position with your size and maximum slippage. Your wallet signs the order; the fren's address is carried in `orderDescId`.
- **Verify the result.** Perpl's order request and fill events record the copied fren, size and fill. The new position can be read back from the Exchange contract.
- **Accept or pass on an exit call.** A fren can mark a take-profit on your position and send the room link. Accept places a resting Perpl close order; pass clears the suggestion. Replacing an existing take-profit can cancel and place in one `execOrders` batch.

Call records, aUSD stakes, passkey onboarding, and shareable rooms are additional workflows around Perpl positions and orders.

## Proof on chain (Monad testnet, Perpl Exchange 0x1964C32f0bE608E7D29302AFF5E61268E72080cc)

| What | Transaction |
|---|---|
| Browser-wallet copy from Ana's live 0.001 BTC long: recipient chose 0.0005 BTC and 50 bps max slippage; Perpl recorded Ana in `OrderRequestV2`, builder 23 in `TakerOrderFilledV2`, and the recipient position read back at 0.0015 BTC | [0x2754d959](https://testnet.monadexplorer.com/tx/0x2754d959068c9eb80cc593d3e1517eb6953a65970dd878001a3076905c0c70fd) |
| A call taken and filled (a hit), caller read back from `orderDescId` | 0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a |
| A call that replaced a resting TP in one batch | 0xeb51040c5bc7cd08695750d237eed7d3cef3a80b0d18e976c19bbcdb5814d2e4 |
| A passkey wallet created in the browser, Perpl account opened in frens, fren copied | 0x9801c9cb20fc3a901c59d24b0d2862ef333a6c45e7fb8ddb27f77cd4a826ef93 |
| The same passkey wallet taking a fren's call from the chart | 0x2d17f22d7081323c6a2e3146091ba51b19cb55ffd9530305801fb7cdd5bbc120 |
| CallStake deployed (0x0E8CbE0902067a49d98961A1440419AEcAf0C5Bc) | 0xbb66d0dbcd0a760c5b5d017500b95baab4ebfa620f1d538b00d9b30e9a468325 |
| A stake on cy's call, TP read from bo's resting Perpl order | 0xc6913d2e44066a12a43e57b1edd1dee2d6440c822b648ef6bc5144b8ce1ee861 |
| That stake paid to cy when Perpl's mark reached the TP (released by the keeper) | 0xddd2eb149c72fa4e1916c07cdfc479dbb68a7f626e72e6c1033444a3220671af |
| A v2 stake (0.5% minimum distance) paid to cy when the mark reached 87,085.0 | 0x448e48381795d71f9f2e897a23da3763d0e91fd42e666ef553f3c5fabd2ca910 |
| A copy carrying Perpl builder id 23, read from TakerOrderFilledV2 | 0xf5c94fd1580411907a723155057a50971c555824e8d19a7257fb084fe44afed0 |

Every row is re-checkable: `bun run demo/check-hit.ts <tx>` decodes the caller and checks the hit against
Perpl's candles; `bun run demo/adoption.ts testnet <hours>` counts orders carrying a frens `orderDescId`.

## Scope

- `web/`: Next.js app. `lib/` holds the chain logic: `readPosition` (positions from `getPositionV2`),
  `suggest` (call payloads and close orders), `receipts` (call records from receipts), `callhit` (hits from
  candles), `resting` (live TPs), `copy`, `onboard` (Perpl account opening), `passkey` (Mera), `roomfeed`
  (monadLogs push), `marketws` (Perpl candle WebSocket).
- `contracts/`: `CallStake.sol`, with unit, fuzz and fork tests against Perpl's testnet Exchange (`forge test`).
- `demo/`: scripts that seed and drive the testnet demo room with real transactions (keys in a gitignored file).
- `spike/`: the original proofs, including the caller surviving on chain in `orderDescId`.

## Run it

    cd web && bun install && bun run dev          # the app on your machine
    bun test                                       # 300+ tests, including chain decoding and order encoding
    MONAD_RPC_URL=... MONAD_TESTNET_RPC_URL=...     # server-side RPC for the live view, in web/.env.local

Built for Monad Metropolis, Track 03: Social, Attention & Culture.
