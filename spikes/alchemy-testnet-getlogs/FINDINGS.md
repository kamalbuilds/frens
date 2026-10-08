# Alchemy Monad Testnet `eth_getLogs` range spike

## Claim

On Alchemy Monad Testnet Free tier, an `eth_getLogs` query spanning at most 10 blocks is accepted, while a 100-block query exceeds the documented range limit. The boundary is plan-specific: Alchemy documents 10 blocks for Free and 1,000 for Pay As You Go. **Verdict: CONFIRMED for the 10-block Free-tier limit.** The observed `-32600` response on 100 blocks is consistent with that limit, but does not by itself prove the account tier or identify the provider's internal rejection reason.

## Mechanism and sources

- Alchemy's [Monad `eth_getLogs` reference](https://www.alchemy.com/docs/chains/monad/monad-api-endpoints/eth-get-logs) specifies Monad Testnet ranges of Free 10, Pay As You Go 1,000, Enterprise 1,000. Responses are capped at 150 MB.
- The [Ethereum Execution APIs specification](https://ethereum.github.io/execution-apis/api/methods/eth_getLogs/) defines a filter object with `fromBlock`, `toBlock`, optional `address` and `topics`; it does not prescribe provider range caps. This is a provider/plan constraint, not a JSON-RPC protocol limit.
- viem's [`getLogs` implementation](https://github.com/wevm/viem/blob/main/src/actions/public/getLogs.ts) encodes bigint bounds as hex and sends one `eth_getLogs` request. It formats and optionally decodes the returned logs; this action does not chunk ranges or retry a rejected range. Callers must keep ranges within their provider's limit or paginate themselves.
- Relevant official engineering context: Alchemy's [How we rebuilt historical logs for speed](https://www.alchemy.com/blog/how-we-rebuilt-historical-logs-for-speed), updated 2026-07-27, describes specialized storage/query infrastructure, range-size latency, tight filters, chunking where ranges are limited, and WebSockets for new head logs. Its general range advice is relevant, but its unlimited-range examples do not override the Monad Testnet plan table.
- **Recent social evidence:** no useful recent social post about this exact Alchemy Monad Testnet range limit or the observed failure was found in the non-browser search. Social evidence adds nothing to this verdict.

## Real-system evidence

Reported by the coordinator from the real Alchemy Monad Testnet endpoint; not independently rerun for this artifact. Chain ID was `0x279f` (10,143). Twenty-five parallel filtered `eth_getLogs` requests, each covering 10 blocks across the same recent 250-block window, all succeeded in 253 ms total. They returned zero matching events. A 100-block request returned HTTP 400 with JSON-RPC error code `-32600`.

The exact original shell command, block bounds, and filter values were not included with the coordinator's measurements, so they are not reconstructed here. The non-secret JSON-RPC method shape is:

```json
{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x<start>","toBlock":"0x<end>","address":"0x<contract>","topics":["0x<topic>"]}]}
```

The positive case is the 25 successful 10-block calls. The negative case is the 100-block request, HTTP 400 / `-32600`.

## Caveats and product impact

The successful result establishes endpoint acceptance and observed latency for these filtered empty-result requests, not event decoding correctness, successful retrieval of a matching event, sustained throughput, or reliability across other ranges. The 100-block error code is generic, and the endpoint's plan was not reported. Empty results mean the positive run did not exercise log payloads. A future correctness check should include a known matching event and verify its block/transaction identity; no such test is claimed here.

This does not block a product flow that can scan in 10-block chunks. It blocks the assumption that a single 100-block request works on this endpoint's current configuration. A 10-block chunker has 25 calls for a 250-block span, as measured, but this one empty-result run does not establish the cost or reliability for event-dense history. Whether Pay As You Go's documented 1,000-block allowance applies to a particular endpoint remains unverified.
