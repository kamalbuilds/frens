# frens feature matrix (testnet; updated 2026-10-02 evening)

Status: PASS = exercised through the real UI on the live deploy with the result read back from chain or the API;
SCRIPT = proven on chain by a script, not yet through the UI; OPEN = not exercised yet.

| # | Feature | How a user does it | Status | Evidence |
|---|---|---|---|---|
| 1 | Live on Perpl list (testnet, mainnet) | open the site, switch network | PASS | /api/live via proxy; mainnet 12 traders (2026-10-02) |
| 2 | Room with faces on candles | open a room link | PASS | demo room renders 4 faces, rail, call record |
| 3 | Make a room, share it | My frens, add address, Copy room link / Post on X / Telegram | PASS | share URLs carry n= and c= (browser check) |
| 4 | Send a call (drag TP, copy link) | pick a fren, drag the TP line, Copy suggestion link | PASS (paste path) | link appears once caller set; wallet and passkey fill the caller |
| 5 | Take a call on the chart | open call link, Accept | PASS (passkey) | tx 0xefd895ed, 0x2d17f22d; wallet path OPEN in browser |
| 6 | Take a call that replaces a TP | Accept when a TP already rests | SCRIPT | 0xeb51040c, 0x76241d17 (demo/accept-call.ts) |
| 7 | Counter a call | drag the ghost line, Send counter link | PASS | fixed 2026-10-02: counter kept owner/caller swapped and dropped n/c; now same call, new price, names kept |
| 8 | Pass on a call | Pass | PASS | banner, ?s= and ghost cleared (browser check) |
| 9 | Copy a fren (new wallet opens Perpl account) | Copy, deposit, copy | PASS (passkey) | 0x9801c9cb; builder 23 on fill 0xf5c94fd1 (script) |
| 10 | Stake on a taken call | Accept, then Stake 2 aUSD | PASS (passkey) | stake open read from chain; v2 needs TP 0.5% from mark |
| 11 | Stake pays the caller on a hit | keeper releases when the mark crosses | PASS | 0xddd2eb14 (v1), 0x448e4838 (v2) |
| 12 | Stake refunds after expiry | anyone calls refund | OPEN on chain | unit tests only |
| 13 | Call record: taken, hit, earned | room hero and cards | PASS | "cy earned 4 aUSD" in the demo room |
| 14 | Live room feed toast | a fren trades | PASS (earlier) | monadLogs toast within ~1 s |
| 15 | Share card (og image) for link previews | paste a room link in X/Telegram | PASS | Twitterbot gets room title + 200 PNG |
| 16 | Phone layout | open on a phone | PASS (390px emulation) | chart from 179px, Accept 36px; real device OPEN |
| 17 | Stop-loss calls | drag SL, Accept | OPEN (building) | Perpl API trigger orders, builder-bound key |
| 18 | Browser-wallet signing (MetaMask/Brave) | any Accept/Copy with an extension wallet | OPEN in a real browser | unit-tested against an EIP-1193 provider |
