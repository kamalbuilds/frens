# Testnet demo room (seeded by demo/seed-testnet.ts)

Site: https://frenstrade.vercel.app (kamal2 Vercel, static, zero functions; /api proxied to the mini). All links below use it.

Demo link, call waiting (bo calls a TP 1.5% below mark on dee's short; replaces cy's taken TP on Accept):
https://frenstrade.vercel.app/r/Bz9HWgDsVBcvOIZLErMuf0gWB-lOtmTx6bfIEt37xBGDJv4-I7fc7ZFCel3hZ-L8dpPOTw8HhKVpW2JEs3kPfrpr2HVxS77X4_nzA4cfDMw?net=testnet&n=b379:ana,9142:bo,4eb6:cy,073f:dee&c=0xc1581071d22d3192a27911a53191b083f166d6b99f4ce2aae95b8d1d1dd751a8,0x850e07e613a53298c1b65df48a477dd2e714b40d00a58e1c4fa68f43388bd2f0,0x4503ba27421f4da209534fc63faf6d1452029e6ac4a031e4b135ea4717a71ad3,0x3627b758d3c5d09f0b444aec37e2aba76227c210f0893ca4834a4b397b651585,0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a,0x7095af079a680972e52153c6596982232a5120f7c2537b3b542db550819d83c6,0x76241d1716d0e4e8b4647d154771b99484e2e78933c1efd5748f7902be4f1021,0x079892943db20e38df9bf3ea833179c4dd603f143ced58b605ed2f2f22846088&s=WyIweDA3M2Y0NzVhMDBlYzU0MTcyZjM4ODY0YjEyYjMyZTdmNDgxNjA3ZTkiLDE2LCJzaG9ydCIsODM1OTYsbnVsbCwiMHg5MTQyN2E1ZGUxNjdFMkZjNzY5M0NlNEYwZjA3ODRBNTY5NWI2MjQ0IiwxNzkwOTA4MjY5OTQ1XQ


Seeded 2026-10-01T18:39:45.371Z. Perpl testnet, market 16 (BTC). Mark at seeding: 85171.8.

| fren | address | role |
|---|---|---|
| ana | 0xb3790F7EBa6bd875714bBeD7e3f9F303871F0CCC | long, called the TP on bo |
| bo | 0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244 | short, accepted ana's TP on chain |
| cy | 0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD | copied ana's long in one tap |
| dee | 0x073f475a00ec54172f38864b12b32e7f481607e9 | copied bo's short; has an open call from cy |

Room: https://frenstrade.vercel.app/r/Bz9HWgDsVBcvOIZLErMuf0gWB-lOtmTx6bfIEt37xBGDJv4-I7fc7ZFCel3hZ-L8dpPOTw8HhKVpW2JEs3kPfrpr2HVxS77X4_nzA4cfDMw?net=testnet&n=b379:ana,9142:bo,4eb6:cy,073f:dee&c=0xc1581071d22d3192a27911a53191b083f166d6b99f4ce2aae95b8d1d1dd751a8,0x850e07e613a53298c1b65df48a477dd2e714b40d00a58e1c4fa68f43388bd2f0,0x4503ba27421f4da209534fc63faf6d1452029e6ac4a031e4b135ea4717a71ad3,0x3627b758d3c5d09f0b444aec37e2aba76227c210f0893ca4834a4b397b651585,0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a,0x7095af079a680972e52153c6596982232a5120f7c2537b3b542db550819d83c6,0x76241d1716d0e4e8b4647d154771b99484e2e78933c1efd5748f7902be4f1021,0x079892943db20e38df9bf3ea833179c4dd603f143ced58b605ed2f2f22846088

Open call for the live demo (dee accepts it): https://frenstrade.vercel.app/r/Bz9HWgDsVBcvOIZLErMuf0gWB-lOtmTx6bfIEt37xBGDJv4-I7fc7ZFCel3hZ-L8dpPOTw8HhKVpW2JEs3kPfrpr2HVxS77X4_nzA4cfDMw?net=testnet&n=b379:ana,9142:bo,4eb6:cy,073f:dee&c=0xc1581071d22d3192a27911a53191b083f166d6b99f4ce2aae95b8d1d1dd751a8,0x850e07e613a53298c1b65df48a477dd2e714b40d00a58e1c4fa68f43388bd2f0,0x4503ba27421f4da209534fc63faf6d1452029e6ac4a031e4b135ea4717a71ad3,0x3627b758d3c5d09f0b444aec37e2aba76227c210f0893ca4834a4b397b651585,0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a,0x7095af079a680972e52153c6596982232a5120f7c2537b3b542db550819d83c6,0x76241d1716d0e4e8b4647d154771b99484e2e78933c1efd5748f7902be4f1021,0x079892943db20e38df9bf3ea833179c4dd603f143ced58b605ed2f2f22846088&s=WyIweDA3M2Y0NzVhMDBlYzU0MTcyZjM4ODY0YjEyYjMyZTdmNDgxNjA3ZTkiLDE2LCJzaG9ydCIsODE3NjUsbnVsbCwiMHg0ZWI2NjRGMUU5YjdjODEyZERGQkM0MTE4MzI2RkUzZTIzYjdEY2VEIiwxNzkwODc5OTg1MzY5XQ

Transactions:
- tx open short bo: 0xf487928f0b3ed23b50a3ce254e3b60d8458362c33eb9a93a774d5e7a7a80a28d
- tx copy long cy: 0xfd9b05086df6179a13018c2759c3dee026d5c67e4b3fcf7d77d56f67e83029cd
- tx copy short dee: 0xb6fb2e16fb6a318143bf6c48f19c5b2e63e94642983336111a8148c075ce00c7
- tx bo accepts ana's TP: 0xc1581071d22d3192a27911a53191b083f166d6b99f4ce2aae95b8d1d1dd751a8

Read back from chain:
- READ BACK bo: short 0.0015 BTC @ 85228.3
- READ BACK cy: long 0.001 BTC @ 85210
- READ BACK dee: short 0.001 BTC @ 85184.4
- READ BACK call: TP 82617 on bo's short, resting on Perpl, caller 0xb3790F7EBa6bd875714bBeD7e3f9F303871F0CCC in orderDescId, block 67331020

Accepted live (2026-10-02, demo/accept-call.ts): dee accepted cy's TP at 81,765, tx 0x850e07e613a53298c1b65df48a477dd2e714b40d00a58e1c4fa68f43388bd2f0, block 67,338,316; caller cy read back from OrderRequestV2.orderDescId.

Replace (2026-10-02): bo called a TP on cy, who already had a resting TP (order 140 @ 88,144 from ana). One execOrders batch cancelled 140 and placed the new close: tx 0xeb51040c5bc7cd08695750d237eed7d3cef3a80b0d18e976c19bbcdb5814d2e4, caller bo read back.
- tx cy's TP 84,819 on ana's long, accepted by ana with 1.5x gas (replaced order 141): 0x7bff515503e590a5fb6831f9dd89051cd6f03448389808f798d2b121bd50eb5a
- 2026-10-02 sized up for the demo (add-size, 0.01 BTC each; 0.03 reverted on margin): ana 0x90d988f6, bo 0x185bcf8c, cy 0x189c3e5e, dee 0x52c64ce7
- 2026-10-02 UI click-through, passkey wallet (virtual WebAuthn authenticator with PRF): created passkey 0xc22B6442EC11Ef401c4564B1dAa209Ea80310b0E, funded by demo/fund.ts, needs-account detected, deposited 100 aUSD (Perpl minimum on testnet), copied cy long 0.001 BTC: tx 0x9801c9cb20fc3a901c59d24b0d2862ef333a6c45e7fb8ddb27f77cd4a826ef93, orderDescId attributes the copied fren (demo/adoption.ts)
- 2026-10-02 UI click-through, passkey Accept on the chart: passkey 0x0eB53D7C4af9cb2Cd5D5469B4b1Ed6506126063a copied cy (tx 0xfd6543d9 run 1), bo called TP 1.5% above mark, chart Accept with passkey: tx 0x2d17f22d7081323c6a2e3146091ba51b19cb55ffd9530305801fb7cdd5bbc120 (earlier run 0x3235357a: caller bo read back by demo/check-hit.ts)
- 2026-10-02 CallStake 0x0E8CbE0902067a49d98961A1440419AEcAf0C5Bc (deploy 0xbb66d0db): bo staked 2 aUSD on cy's call (accept 0x76241d17, stake 0xc6913d2e, TP 86,117.0). Keeper xyz.frens.stake-keeper on the mini (signer 0x1d9CDF4665296b490AE537C1c6a48560B2F463c5, faucet-funded) releases on the mark crossing. dee's 0.05% call hit instantly (0x7095af07).
- 2026-10-02 CallStake v2 0xB83D69657EED4Abd327b3539F24f07556c1A5a36 (deploy 0xc3a16d6e, 0.5% minimum TP distance): ana staked 2 aUSD on cy's call (accept 0x07989294, stake 0x55890890, TP 87,085.0). Keepers xyz.frens.stake-keeper (v1) and -v2 on the mini.
