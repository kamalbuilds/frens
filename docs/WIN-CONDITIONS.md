# WIN-CONDITIONS · frens · Monad Metropolis Track 03

Canonical copy: metropolis/docs/WIN-CONDITIONS.md (xsignals gate PASS 2026-10-02: 2 verified asks, 5 outside users). This file mirrors the frens entry for this repo.

## Shared across all entries (source: docs/research-v2/judges-and-winners.md)

Scoreboard: Levr Bet (Madness NYC, 3rd) owns a live sports-betting book, $1,910,000 TVL on Monad per DefiLlama; Kizzy (Madness Bangkok, 2nd) owns a social-media betting app, $71,000 TVL. Of 124 named Monad winners, these 2 are the only ones with a confirmable usage number on Monad.
Bar to beat: one real named user using the product on chain before submission; on TVL, $71,000.

## 1. frens (formerly Cosign, Chartroom): social perps on the chart · Track 03 Social, Attention & Culture

Zeel's ask, built on Perpl: friends' real positions on one chart; a friend suggests a TP/SL; you take the
same trade on top of theirs in one tap, signed from your own wallet (non-custodial copy, which Perpl lacks);
PnL you can share. Each trader's PnL is shown after fees and funding (the ledger spike). Cost per point was
dropped as a headline on 2026-09-26: the users posting it are airdrop-content accounts who already compute it
in minutes, and the number expires with the mPoints program. Name to be chosen with the product-naming skill.

Single entry: frens (friends call the exit on your position, you sign it)
Verb the brief names: cultural participation that translates into real ownership; "native to how people socialize"; judge Zeel's Track 3 ask "perps + social, directly on the chart ... create their own position directly on top of yours. All with PnLs"
Our product performs that verb: partly. Friends' positions, rooms and share links are live (products/chartroom/web); friend TP suggestions become exact Perpl close orders (web/lib/suggest.ts), proven on the live Perpl testnet on 2026-10-01 (account 741, tx 0x824fbcc5...a22c open, TP order 65); net PnL after fees and funding works on mainnet (spike/ledger.ts, commit 6bca82a) but is not in the app; drag-to-suggest TP/SL and one-tap copy (signed from the user's own wallet) are live on https://frenstrade.vercel.app (browser-tested 2026-10-02; testnet demo room seeded by demo/seed-testnet.ts with 5 accepted calls read back from receipts; no outside user's copy trade yet); a suggestion opens as a ghost line the owner can Accept (one wallet signature), Counter (drag, send back) or Pass; the suggester is written on chain in orderDescId (proven on live testnet) for a public call record (main 09f3ffb)
Asset we will own: the room graph of who trades alongside whom on Perpl, and the record of which suggested trades friends took and how they did
Off-platform buyer: Perpl traders asking for social trading and posting PnL: @_maki29_, @tweetbysobur, @hanabilio, @OxPaine, @psalmuhear (docs/research-v3/users/signals.md); none contacted yet. Perpl is the venue, and our orders would carry its builder code (builder_id requested in docs/outreach/02-chartroom-perpl.md)
Metric plan: 3 real rooms shared by traders and 10 copied trades by 2026-10-07; then copies per day, from builder-code fills on chain and /r visits at https://frenstrade.vercel.app
Live by: 2026-10-07
Deviation from research: research v2 picked Chartroom; research v3 kept it (Zeel's verbatim ask) and moved the edge to non-custodial one-tap copy, because Desk, Mirror and Pehra (not checked by us) already build the viewing and liquidation-guard parts. Biggest rival is FOMO (fomo.family): 2.5M traders claimed, $94M raised, one-tap non-custodial copy already, perps on Hyperliquid, spot on Monad (DefiLlama fees 30d $36.1M total, Monad $13.2k, read 2026-09-26). Chartroom differs only in being Perpl-native and in on-chart interaction between friends (suggest TP/SL on a friend's position, stack on it); FOMO could add Perpl. See docs/research-v3/competitors/fomo.md
Ask it answers: https://x.com/patelzeel68/status/2097320416591438140 https://x.com/keoneHD/status/2102196784282177874
Users who want it: https://x.com/_maki29_/status/2102304459565248534 https://x.com/tweetbysobur/status/2102213270828470289 https://x.com/hanabilio/status/2083271090621845682 https://x.com/OxPaine/status/2090782562301939863 https://x.com/psalmuhear/status/2101307393464308102

