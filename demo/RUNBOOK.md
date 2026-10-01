# Demo runbook (Perpl testnet, real transactions)

Open the room link from `demo/ROOMS.md` (it carries `?net=testnet&n=b379:ana,...`). Every action below is a
real Monad testnet transaction signed by a demo fren's own key (`demo/.wallets.json`, gitignored).

1. **The room.** Four frens' faces sit on the candles where they entered; rail shows side and live PnL.
2. **A fren moves, everyone sees it.** In a terminal: `bun run demo/add-size.ts dee 0.0005 short`.
   Within about a second the room shows "dee placed an order" (Monad monadLogs push, no reload).
3. **Make a call.** `bun run demo/make-call.ts <caller address> <owner address> 4` prints a call payload; open
   `<room link>&s=<payload>`: the call is a ghost line with the caller's face, plus Accept / Counter / Pass.
4. **Accept it.** Click Accept in the app with the owner's wallet, or `bun run demo/accept-call.ts "<payload>"`.
   The script prints the tx and the caller decoded from `OrderRequestV2.orderDescId` on chain.
5. **Copy a fren.** Hover a face, Copy: the order is built by the same `toCopyOrder` the scripts use.

Constraints learned on 2026-10-02:
- A position that already has a resting take-profit for its full size cannot take a second one (Perpl locks
  the lots); use a fren without one, or the replace flow once it ships.
- Seed fresh entries shortly before recording so the 15m chart shows faces on recent candles.
