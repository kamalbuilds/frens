# Testnet demo room (seeded by demo/seed-testnet.ts)

Seeded 2026-10-01T18:39:45.371Z. Perpl testnet, market 16 (BTC). Mark at seeding: 85171.8.

| fren | address | role |
|---|---|---|
| ana | 0xb3790F7EBa6bd875714bBeD7e3f9F303871F0CCC | long, called the TP on bo |
| bo | 0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244 | short, accepted ana's TP on chain |
| cy | 0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD | copied ana's long in one tap |
| dee | 0x073f475a00ec54172f38864b12b32e7f481607e9 | copied bo's short; has an open call from cy |

Room: https://frenstrade.vercel.app/r/Bz9HWgDsVBcvOIZLErMuf0gWB-lOtmTx6bfIEt37xBGDJv4-I7fc7ZFCel3hZ-L8dpPOTw8HhKVpW2JEs3kPfrpr2HVxS77X4_nzA4cfDMw?net=testnet&n=b379:ana,9142:bo,4eb6:cy,073f:dee

Open call for the live demo (dee accepts it): https://frenstrade.vercel.app/r/Bz9HWgDsVBcvOIZLErMuf0gWB-lOtmTx6bfIEt37xBGDJv4-I7fc7ZFCel3hZ-L8dpPOTw8HhKVpW2JEs3kPfrpr2HVxS77X4_nzA4cfDMw?net=testnet&n=b379:ana,9142:bo,4eb6:cy,073f:dee&s=WyIweDA3M2Y0NzVhMDBlYzU0MTcyZjM4ODY0YjEyYjMyZTdmNDgxNjA3ZTkiLDE2LCJzaG9ydCIsODE3NjUsbnVsbCwiMHg0ZWI2NjRGMUU5YjdjODEyZERGQkM0MTE4MzI2RkUzZTIzYjdEY2VEIiwxNzkwODc5OTg1MzY5XQ

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
