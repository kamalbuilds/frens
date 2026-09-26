import { describe, expect, test } from "bun:test";
import { attributeTakerFills, summarize, type DecodedEvent, type MarketScale, type TxLog } from "./ledger";

// No network here: every event below is hand built, so the totals are checkable by hand too.
// collateralDecimals is 6 because that is what the mainnet aUSD reports and what
// positions.mainnet.json was written with; the CLI reads it from the token instead of trusting it.
const COLLATERAL_DECIMALS = 6;
const RANGE = { fromBlock: 100n, toBlock: 199n };

// Market 1 as the repo's own readPosition tests describe it: price in 1e-1 units, size in 1e-5
// lots. pricePNS 700_000 is BTC at 70,000 and lotLNS 200 is 0.002.
const SCALES = new Map<bigint, MarketScale>([[1n, { priceDecimals: 1, lotDecimals: 5 }]]);
const scaleOf = (perpId: bigint): MarketScale => {
  const s = SCALES.get(perpId);
  if (!s) throw new Error(`no scale for market ${perpId}`);
  return s;
};

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

const makerFill = (accountId: bigint, pricePNS: bigint, lotLNS: bigint, feeCNS: bigint): DecodedEvent => ({
  kind: "fill", accountId, perpId: 1n, pricePNS, lotLNS, feeCNS, source: "MakerOrderFilledV2",
});
const takerFill = (accountId: bigint, pricePNS: bigint, lotLNS: bigint, feeCNS: bigint): DecodedEvent => ({
  kind: "fill", accountId, perpId: 1n, pricePNS, lotLNS, feeCNS, source: "TakerOrderFilledV2",
});
const closed = (accountId: bigint, deltaPnlCNS: bigint, fundingCNS: bigint): DecodedEvent => ({
  kind: "pnl", accountId, perpId: 1n, deltaPnlCNS, fundingCNS, source: "PositionClosed",
});
const decreased = (accountId: bigint, deltaPnlCNS: bigint, fundingCNS: bigint): DecodedEvent => ({
  kind: "pnl", accountId, perpId: 1n, deltaPnlCNS, fundingCNS, source: "PositionDecreased",
});

describe("summarize", () => {
  // Account 7: a maker fill and a taker fill, then a close that lost 1.50 and a partial
  // decrease that made 2.00, funding 0.25 in and 0.05 out.
  //   fees 0.03 + 0.02 = 0.05 | realized -1.50 + 2.00 = 0.50 | funding 0.25 - 0.05 = 0.20
  //   volume 70,000 * 0.002 + 71,000 * 0.001 = 140 + 71 = 211
  //   net 0.50 + 0.20 - 0.05 = 0.65 | cost (0.05 - 0.50 - 0.20) / 211 * 1e6
  const ACCOUNT_7: DecodedEvent[] = [
    makerFill(7n, 700_000n, 200n, 30_000n),
    takerFill(7n, 710_000n, 100n, 20_000n),
    closed(7n, -1_500_000n, 250_000n),
    decreased(7n, 2_000_000n, -50_000n),
  ];

  // Account 12: taker only, closed for a 4.00 loss and paid 1.00 of funding.
  //   fees 0.10 | realized -4.00 | funding -1.00 | volume 69,000 * 0.005 = 345
  //   net -4.00 - 1.00 - 0.10 = -5.10 | cost (0.10 + 4.00 + 1.00) / 345 * 1e6
  const ACCOUNT_12: DecodedEvent[] = [takerFill(12n, 690_000n, 500n, 100_000n), closed(12n, -4_000_000n, -1_000_000n)];

  const both = () => summarize([...ACCOUNT_7, ...ACCOUNT_12], { collateralDecimals: COLLATERAL_DECIMALS, range: RANGE, scaleOf });
  const rowOf = (rows: ReturnType<typeof both>, accountId: number) => {
    const row = rows.find((r) => r.accountId === accountId);
    if (!row) throw new Error(`no row for account ${accountId}`);
    return row;
  };

  test("a maker and a taker account are summed separately, losses kept negative", () => {
    const seven = rowOf(both(), 7);
    expect(seven.events).toBe(4);
    expect(seven.feesUsd).toBe(0.05);
    expect(seven.realizedUsd).toBe(0.5);
    expect(seven.fundingUsd).toBe(0.2);
    expect(seven.volumeUsd).toBe(211);
    expect(seven.netUsd).toBeCloseTo(0.65, 12);
    close(seven.costPerMillion!, -3080.56872037915);
    expect(seven.fromBlock).toBe(100);
    expect(seven.toBlock).toBe(199);
  });

  test("a losing account reports negative realized, negative funding and a positive cost", () => {
    const twelve = rowOf(both(), 12);
    expect(twelve.events).toBe(2);
    expect(twelve.feesUsd).toBe(0.1);
    expect(twelve.realizedUsd).toBe(-4);
    expect(twelve.fundingUsd).toBe(-1);
    expect(twelve.volumeUsd).toBe(345);
    expect(twelve.netUsd).toBeCloseTo(-5.1, 12);
    close(twelve.costPerMillion!, 14782.60869565217);
  });

  test("rows come back sorted by volumeUsd desc", () => {
    expect(both().map((r) => r.accountId)).toEqual([12, 7]);
  });

  test("an account that only realized PnL has no cost per million rather than a fake one", () => {
    const rows = summarize([closed(31n, 1_000_000n, 0n)], { collateralDecimals: COLLATERAL_DECIMALS, range: RANGE, scaleOf });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.realizedUsd).toBe(1);
    expect(rows[0]!.volumeUsd).toBe(0);
    expect(rows[0]!.costPerMillion).toBeNull();
  });

  test("fees accumulate as bigint, so a large range cannot drift by a cent", () => {
    // 9000 fills of 0.03 is 270.00 exactly in floating point either way, but 0.01 added 9000
    // times is not: summing the base units and dividing once is what keeps it exact.
    const many: DecodedEvent[] = Array.from({ length: 9000 }, () => makerFill(44n, 700_000n, 100n, 10_000n));
    const row = summarize(many, { collateralDecimals: COLLATERAL_DECIMALS, range: RANGE, scaleOf })[0]!;
    expect(row.events).toBe(9000);
    expect(row.feesUsd).toBe(90);
  });

  test("an unknown market is an error, not a guess at decimals", () => {
    const noScale = () => {
      throw new Error("no price or lot decimals for market 1");
    };
    expect(() => summarize([makerFill(7n, 700_000n, 200n, 1n)], { collateralDecimals: COLLATERAL_DECIMALS, range: RANGE, scaleOf: noScale })).toThrow();
  });
});

// TakerOrderFilled names no account, so the fill is named from the logs of its own transaction.
// These are the shapes seen on mainnet: a crossing OrderRequest, the maker fills the taker
// consumed, then the taker fill itself.
const request = (logIndex: number, accountId: bigint, lotLNS: bigint, over: Partial<TxLog["args"]> = {}): TxLog => ({
  name: "OrderRequestV2",
  logIndex,
  args: { perpId: 1n, accountId, orderId: 0n, orderType: 0n, lotLNS, postOnly: false, ...over },
});
const makerLog = (logIndex: number, accountId: bigint, pricePNS: bigint, lotLNS: bigint): TxLog => ({
  name: "MakerOrderFilledV2",
  logIndex,
  args: { perpId: 1n, accountId, pricePNS, lotLNS, feeCNS: 1_000n },
});
const takerLog = (logIndex: number, lotLNS: bigint): TxLog => ({
  name: "TakerOrderFilledV2",
  logIndex,
  args: { lotLNS, entryPricePNS: 0n, collatPricePNS: 0n, pnlPricePNS: 0n, feeCNS: 2_000n },
});

describe("attributeTakerFills", () => {
  test("names the crossing requester that did not fill as maker, and prices the fill off the lots it consumed", () => {
    // 12 crosses 500 lots against 7's resting order. The price comes from the maker fill, not
    // from the taker's entryPricePNS, which is the position's average entry after the fill.
    const named = attributeTakerFills([
      request(0, 12n, 500n),
      makerLog(1, 7n, 700_000n, 500n),
      takerLog(2, 500n),
    ]);
    expect(named).toHaveLength(1);
    expect(named[0]).toEqual({ accountId: 12n, perpId: 1n, pricePNS: 700_000n, notionalPNS: 350_000_000n });
  });

  test("a maker that rests and fills in the same transaction is not the taker", () => {
    const named = attributeTakerFills([
      request(0, 8n, 100n),
      request(1, 9n, 100n),
      makerLog(2, 8n, 700_000n, 100n),
      takerLog(3, 100n),
    ]);
    expect(named[0]!.accountId).toBe(9n);
  });

  test("an account that takes one fill and makes another in the same transaction is the taker of the first", () => {
    // Mainnet block 108163281, log order as the contract emitted it. 3040 asks to close 207 lots it
    // does not have and the contract refuses it, then 5302 closes 157 against 812's short, then
    // 5302 fills as maker against 1974's close. 5302 is a maker by the end of the transaction but
    // was not one yet at log 63, so the fill belongs to it and not to 3040's refused request.
    const named = attributeTakerFills([
      request(0, 3040n, 207n, { orderType: 3n }),
      request(1, 3040n, 303n, { orderType: 0n, postOnly: true }),
      request(2, 3040n, 1383n, { orderType: 1n, postOnly: true }),
      request(3, 5302n, 157n, { orderType: 3n }),
      makerLog(4, 812n, 841_631n, 157n),
      takerLog(5, 157n),
      request(6, 1974n, 195n, { orderType: 2n }),
      request(7, 1974n, 303n, { orderType: 0n, postOnly: true }),
      request(8, 1974n, 1383n, { orderType: 1n, postOnly: true }),
      request(9, 1974n, 67n, { orderType: 2n }),
      makerLog(10, 5302n, 841_630n, 67n),
      takerLog(11, 67n),
    ]);
    expect(named.map((a) => a?.accountId)).toEqual([5302n, 1974n]);
    expect(named[0]!.notionalPNS).toBe(841_631n * 157n);
    expect(named[1]!.notionalPNS).toBe(841_630n * 67n);
  });

  test("a post-only request, a cancel and a resting limit order are not fill candidates", () => {
    // 4 cancels, 6 rests a limit order. None of the three can be what filled.
    const named = attributeTakerFills([
      request(0, 4n, 250n, { orderType: 6n }),
      request(1, 5n, 250n, { orderType: 4n }),
      request(2, 6n, 250n, { orderType: 6n, postOnly: true }),
      makerLog(3, 7n, 700_000n, 250n),
      takerLog(4, 250n),
    ]);
    expect(named[0]).toBeNull();
  });

  test("one account sending both legs of a spread is named for every fill it makes", () => {
    // Account 4638 on mainnet sends orderType 0 and orderType 1 in one transaction and both fill.
    // Which of its own requests filled is not in question, so both fills are its, and the second
    // is not written off as unnameable.
    const named = attributeTakerFills([
      request(0, 4638n, 500n, { orderType: 0n }),
      request(1, 4638n, 500n, { orderType: 1n }),
      makerLog(2, 7n, 700_000n, 250n),
      takerLog(3, 250n),
      makerLog(4, 8n, 700_000n, 250n),
      takerLog(5, 250n),
    ]);
    expect(named).toEqual([
      { accountId: 4638n, perpId: 1n, pricePNS: 700_000n, notionalPNS: 175_000_000n },
      { accountId: 4638n, perpId: 1n, pricePNS: 700_000n, notionalPNS: 175_000_000n },
    ]);
  });

  test("a spread plus an unrelated taker: the lots say which request filled", () => {
    const named = attributeTakerFills([
      request(0, 4638n, 500n, { orderType: 0n }),
      request(1, 13n, 200n),
      makerLog(2, 7n, 700_000n, 200n),
      takerLog(3, 200n),
      makerLog(4, 8n, 700_000n, 500n),
      takerLog(5, 500n),
    ]);
    expect(named.map((a) => a?.accountId)).toEqual([13n, 4638n]);
  });

  test("one taker order split over several maker lots is priced by lot weight, and exactly", () => {
    // 300 lots at 70,000 and 200 lots at 72,000 is 500 lots at
    // (300 * 700,000 + 200 * 720,000) / 500 = 708,000 PNS, the average the taker actually paid.
    const named = attributeTakerFills([
      request(0, 12n, 500n),
      makerLog(1, 7n, 700_000n, 300n),
      makerLog(2, 8n, 720_000n, 200n),
      takerLog(3, 500n),
    ]);
    expect(named[0]!.pricePNS).toBe(708_000n);
    expect(named[0]!.notionalPNS).toBe(354_000_000n);
  });

  test("a weighted price that does not divide evenly still volumes at the exact product", () => {
    // The average is 708,000.6, which rounds down to 708,000. Costing 500 lots at the rounded
    // price gives 354.00; the two lots the taker actually traded are worth 354.0003.
    const named = attributeTakerFills([
      request(0, 12n, 500n),
      makerLog(1, 7n, 700_001n, 300n),
      makerLog(2, 8n, 720_000n, 200n),
      takerLog(3, 500n),
    ]);
    expect(named[0]!.pricePNS).toBe(708_000n);
    const events: DecodedEvent[] = [
      {
        kind: "fill", accountId: named[0]!.accountId, perpId: 1n, pricePNS: named[0]!.pricePNS,
        notionalPNS: named[0]!.notionalPNS, lotLNS: 500n, feeCNS: 0n, source: "TakerOrderFilledV2",
      },
    ];
    const row = summarize(events, { collateralDecimals: COLLATERAL_DECIMALS, range: RANGE, scaleOf })[0]!;
    expect(row.volumeUsd).toBeCloseTo(354.0003, 9);
  });

  test("two takers in one transaction each claim their own request", () => {
    // 12 crosses first and takes 7's 300 lots, then 13 crosses and takes 8's 200 lots, so each
    // taker fill sits directly under the maker lots it consumed.
    const named = attributeTakerFills([
      request(0, 12n, 300n),
      request(1, 13n, 200n),
      makerLog(2, 7n, 700_000n, 300n),
      takerLog(3, 300n),
      makerLog(4, 8n, 700_000n, 200n),
      takerLog(5, 200n),
    ]);
    expect(named).toEqual([
      { accountId: 12n, perpId: 1n, pricePNS: 700_000n, notionalPNS: 210_000_000n },
      { accountId: 13n, perpId: 1n, pricePNS: 700_000n, notionalPNS: 140_000_000n },
    ]);
  });

  test("refuses to guess when the consumed lots do not add up to the fill", () => {
    // A run of 400 lots cannot explain a 500 lot fill, so no price and no account are claimed.
    const named = attributeTakerFills([request(0, 12n, 500n), makerLog(1, 7n, 700_000n, 400n), takerLog(2, 500n)]);
    expect(named).toEqual([null]);
  });

  test("a request already spent on an earlier fill cannot name a second one", () => {
    // 12's single request filled once, so a second fill has nothing left to point at even though
    // 13's request for the same lots is right there.
    const named = attributeTakerFills([
      request(0, 12n, 500n),
      makerLog(1, 7n, 700_000n, 500n),
      takerLog(2, 500n),
      request(3, 13n, 500n),
      makerLog(4, 8n, 700_000n, 500n),
      takerLog(5, 500n),
    ]);
    expect(named[0]!.accountId).toBe(12n);
    expect(named[1]!.accountId).toBe(13n);
  });

  test("refuses to name a fill that no unspent request precedes", () => {
    const named = attributeTakerFills([makerLog(1, 7n, 700_000n, 500n), takerLog(2, 500n)]);
    expect(named).toEqual([null]);
  });

  test("refuses a fill larger than the request that is supposed to have made it", () => {
    // 250 lots cannot come out of a request for 100, so the pairing is refused rather than kept.
    const named = attributeTakerFills([request(0, 12n, 100n), makerLog(1, 7n, 700_000n, 250n), takerLog(2, 250n)]);
    expect(named).toEqual([null]);
  });

  test("refuses to guess when the only request belongs to an account that filled as maker", () => {
    const named = attributeTakerFills([
      request(0, 12n, 500n),
      makerLog(1, 12n, 700_000n, 250n),
      makerLog(2, 7n, 700_000n, 250n),
      takerLog(3, 500n),
    ]);
    expect(named).toEqual([null]);
  });

  test("the market comes from the consumed lots, and a request in another market is ignored", () => {
    const named = attributeTakerFills([
      request(0, 12n, 500n, { perpId: 20n }),
      request(1, 13n, 500n),
      makerLog(2, 7n, 700_000n, 500n, ),
      takerLog(3, 500n),
    ]);
    expect(named[0]!.accountId).toBe(13n);
    expect(named[0]!.perpId).toBe(1n);
  });

  test("a transaction with no taker fill produces nothing", () => {
    expect(attributeTakerFills([request(0, 12n, 500n), makerLog(1, 7n, 700_000n, 500n)])).toEqual([]);
  });
});

// The ledger's own arithmetic on a transaction the way mainnet emits it, end to end and offline:
// one taker fill attributed from its logs, one maker fill named directly, and a close that lost.
describe("a transaction through attribution and summarize", () => {
  test("fees, volume, realized and funding land on the two accounts separately", () => {
    const named = attributeTakerFills([
      request(0, 12n, 500n),
      makerLog(1, 7n, 700_000n, 500n),
      takerLog(2, 500n),
    ]);
    const attributed = named[0]!;
    const events: DecodedEvent[] = [
      { kind: "fill", accountId: 7n, perpId: 1n, pricePNS: 700_000n, lotLNS: 500n, feeCNS: 1_000n, source: "MakerOrderFilledV2" },
      { kind: "fill", accountId: attributed.accountId, perpId: attributed.perpId, pricePNS: attributed.pricePNS, notionalPNS: attributed.notionalPNS, lotLNS: 500n, feeCNS: 2_000n, source: "TakerOrderFilledV2" },
      closed(7n, 1_200_000n, 0n),
    ];
    const rows = summarize(events, { collateralDecimals: COLLATERAL_DECIMALS, range: RANGE, scaleOf });
    // Both sides traded 500 lots at 70,000, which is 0.005 lots, so 350.00 each, and the order
    // between them falls to the tie break on accountId.
    expect(rows.map((r) => r.accountId)).toEqual([7, 12]);
    expect(rows[0]!.volumeUsd).toBe(350);
    expect(rows[0]!.feesUsd).toBe(0.001);
    expect(rows[0]!.realizedUsd).toBe(1.2);
    expect(rows[0]!.netUsd).toBeCloseTo(1.199, 12);
    expect(rows[0]!.costPerMillion!).toBeCloseTo(-3425.714285714286, 9);
    expect(rows[1]!.feesUsd).toBe(0.002);
    expect(rows[1]!.realizedUsd).toBe(0);
    expect(rows[1]!.costPerMillion!).toBeCloseTo(5.714285714285715, 9);
  });
});
