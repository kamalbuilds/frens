# frens feature matrix (testnet; updated 2026-10-06)

Status: PASS = exercised through the real UI on the live deploy with the result read back from chain or the API;
SCRIPT = proven on chain by a script, not yet through the UI; OPEN = not exercised yet.

| # | Feature | How a user does it | Status | Evidence |
|---|---|---|---|---|
| 1 | Live on Perpl list (testnet, mainnet) | open the site, switch network | PASS | /api/live via proxy; mainnet 12 traders (2026-10-02) |
| 2 | Room with faces on candles | open a room link | PASS | demo room renders 4 faces, rail, call record |
| 3 | Make a room, share it | My frens, add address, Copy room link / Post on X / Telegram | PASS | share URLs carry n= and c= (browser check) |
| 4 | Send a call (drag TP, copy link) | pick a fren, drag the TP line, Copy suggestion link | PASS (paste path) | link appears once caller set; wallet and passkey fill the caller |
| 5 | Take a call on the chart | open call link, Accept | PASS (passkey) | tx 0xefd895ed, 0x2d17f22d; wallet path OPEN in browser |
| 6 | Take a call that replaces a TP | Accept when a TP already rests | PASS (wallet) | banner "Replaces the TP resting at 85,584.0", one signature 0x8b2268ec: order 146 cancelled, order 113 rests at 86,424 (read from getPerpOrderLocks). Fixed 2026-10-03: the old 2,000-block log scan missed any TP older than ~13 min, and a double Accept sent the close twice |
| 7 | Counter a call | drag the ghost line, Send counter link | PASS | fixed 2026-10-02: counter kept owner/caller swapped and dropped n/c; now same call, new price, names kept |
| 8 | Pass on a call | Pass | PASS | banner, ?s= and ghost cleared (browser check) |
| 9 | Copy a fren (new wallet opens Perpl account) | Copy, deposit, copy | PASS (passkey) | 0x9801c9cb; builder 23 on fill 0xf5c94fd1 (script) |
| 10 | Stake on a taken call | Accept, then Stake 2 aUSD | PASS (passkey, wallet) | stake open read from chain; wallet path: approve 0x3fb42555, stake 0x8b8e22e7 on v2 (2026-10-03); v2 needs TP 0.5% from mark |
| 11 | Stake pays the caller on a hit | keeper releases when the mark crosses | PASS | 0xddd2eb14 (v1), 0x448e4838 (v2) |
| 12 | Stake refunds after expiry | the keeper refunds it automatically | PASS | refund 0x0ee198f8 (state 3), keeper auto-refunds since 2026-10-02 |
| 13 | Call record: taken, hit, earned | room hero and cards | PASS | "cy earned 4 aUSD" in the demo room |
| 14 | Live room feed toast | a fren trades | PASS (earlier) | monadLogs toast within ~1 s |
| 15 | Share card (og image) for link previews | paste a room link in X/Telegram | PASS | Twitterbot gets room title + 200 PNG |
| 16 | Phone layout | open on a phone | PASS (390px emulation) | chart from 179px, Accept 36px; real device OPEN |
| 17 | Stop-loss calls | drag SL, Accept | PASS (wallet, testnet) | bo's SL at 83,024.0 on a test wallet's long: one PerplRegisterApiKey signature, forwarding tx 0x528d1996, trigger order 285972940521504 read back from Perpl (2026-10-06). Testnet goes through the same-origin relay /api/perpl/testnet; mainnet allows the frenstrade origin directly |
| 18 | Browser-wallet signing (MetaMask/Brave) | any Accept/Copy with an extension wallet | PASS (injected EIP-1193 wallet) | real UI through window.ethereum: approve + createAccount + copy, accept 0xe73bcecf, replace 0x8b2268ec; an extension's own prompt OPEN |
| 19 | Test funds for a new wallet | Copy with an empty wallet | PASS (wallet, testnet) | fresh wallet 0xCC56: faucet.monad.xyz link at 0 MON, 'Get 10,000 test aUSD' tx 0x25e49e05, deposit and copy sent, long 0.001 BTC read from chain (2026-10-06) |
