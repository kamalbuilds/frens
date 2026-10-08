# Live history timeout regression

Captured 2026-10-08 against `https://frenstrade.vercel.app`.

## Failing control

Before the fix:

```sh
curl --max-time 75 -sS -w '\nHTTP %{http_code} elapsed %{time_total}s\n' 'https://frenstrade.vercel.app/api/live?net=testnet&market=16&hours=24'
```

Result: HTTP 504, `FUNCTION_INVOCATION_TIMEOUT`, elapsed 60.339145 seconds. A preceding 50-second client timeout was not treated as proof of server failure; this longer request established the actual server timeout.

The route supported 24 hours but configured a 60-second function duration. Testnet log reads use serial 100-block pages to respect the public RPC limit. No history was dropped and concurrency was not increased.

## Fix and completion

`web/app/api/live/route.ts` now exports `maxDuration = 300`. The local Next build emitted `/api/live.maxDuration: 300` in `.next/server/functions-config-manifest.json`. Vercel documents a 300-second Fluid Compute limit on Hobby: [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

`bun test lib/live.test.ts`: 17 passed, 0 failed. `bun run build`: successful, including TypeScript.

`vca deploy --prod --yes` reached READY and aliased `https://frenstrade.vercel.app`. Independent `vca inspect https://frens-ks9en982f-dev-5498-4e0c.vercel.app` confirmed Ready and that alias. Deployment ID: `dpl_GtrPrq5MDHBbRncPK4mfSpVSrL3t`.

The same 24-hour request, with client timeout 295 seconds, returned HTTP 200 in 127.819173 seconds. It contained market 16, hours 24, block 69245128, and 12 nonempty current trader rows, including both longs and shorts. The first account was `0x3C5D3cFA520Eec0332d6065A3012A09ae66204A0`; oldest returned entry block was 69146036.

## Deployed browser

Native Brave CDP, own persistent pin `~/.cache/qa-tab`, viewport 390x844, no screenshots:

- Opened `https://frenstrade.vercel.app/?net=testnet`.
- The actual page populated `BTC Perp on Perpl · 7 live traders opened in the last 6h`, `2 long · 5 short`, seven named rows and their PnL, and block 69245131.
- Populated state arrived 26.065 seconds after the harness's initial 8-second navigation wait, approximately 34 seconds total.
- Document width did not exceed viewport width.
- In the same browser, `/api/live?market=-1&net=testnet` returned HTTP 400 with `unknown market -1`, rather than an empty successful list.

Blind spot: this fixes premature termination, not cold-read latency, sustained load, outside-user adoption, or wallet order execution. A 128-second cold 24-hour scan is not a fast feed. Alchemy environment variables were not configured by this change.
