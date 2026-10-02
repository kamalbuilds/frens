// Owner's resting reduce-only closes for one market.
//
// Accepting a friend's TP when the owner already has a resting reduce-only
// close for the full size reverts: Perpl locks those lots. The Accept path
// reads the owner's open closes first (this module), then replaces them in
// one batch (suggest.ts buildAcceptOrders) so the owner signs once.
//
// Perpl keeps every account's locked orders per market on chain:
// getPerpOrderLocks(accountId, perpId) lists them, and the low 20 bits of each
// orderLockId are the orderId (testnet: account 778 lock 1048721 is order 145,
// 760 lock 1048717 is order 141). Each candidate is read back with getOrderV2
// and kept only while the account still owns it as a close with lots left, so
// a recycled id never counts. Resting prices are stored on chain as an offset
// (ONS) from the base price (proven in src/trade.ts), so
// pricePNS = priceONS + basePricePNS. Plain eth_calls: works from the browser
// on the public RPC, and finds a TP however long ago it was placed.
//
// Never throws: a lookup failure returns [], and the caller falls back to
// the single-close path rather than blocking Accept.
import { parseAbi, type Address, type PublicClient } from "viem";
import { CLOSE_LONG, CLOSE_SHORT } from "./suggest";
import { NETWORKS, exchangeAbi, type Network } from "./perpl";

const locksAbi = parseAbi([
  "struct OrderLock { uint32 orderLockId; uint32 nextOrderLockId; uint32 prevOrderLockId; uint8 orderType; uint40 lotLNS; uint80 amountCNS; }",
  "function getPerpOrderLocks(uint256 accountId, uint256 perpId) view returns (OrderLock[] perpOrderLocks)",
]);

const ORDER_ID_BITS = 0xfffffn;

export type RestingClose = {
  orderId: bigint;
  side: "close-long" | "close-short";
  lots: bigint;
  pricePNS: bigint;
  price: number;
};

export async function findRestingCloses(
  network: Network,
  client: PublicClient,
  account: Address,
  market: number,
): Promise<RestingClose[]> {
  try {
    const exchange = NETWORKS[network].exchange;
    const perpId = BigInt(market);

    const acc = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getAccountByAddr",
      args: [account],
    })) as { accountId: bigint };
    const accountId = BigInt(acc.accountId);
    if (accountId === 0n) return [];

    const perp = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPerpetualInfoV2",
      args: [perpId],
    })) as { basePricePNS: bigint; priceDecimals: bigint };
    const basePricePNS = BigInt(perp.basePricePNS);
    const priceDecimals = Number(perp.priceDecimals);

    const locks = (await client.readContract({
      address: exchange,
      abi: locksAbi,
      functionName: "getPerpOrderLocks",
      args: [accountId, perpId],
    })) as readonly { orderLockId: number; orderType: number }[];
    const ids = [
      ...new Set(
        locks.filter((l) => l.orderType === CLOSE_LONG || l.orderType === CLOSE_SHORT).map((l) => BigInt(l.orderLockId) & ORDER_ID_BITS),
      ),
    ].filter((id) => id !== 0n);
    const out: RestingClose[] = [];
    for (const id of ids) {
      try {
        const o = (await client.readContract({
          address: exchange,
          abi: exchangeAbi,
          functionName: "getOrderV2",
          args: [perpId, id],
        })) as { accountId: number | bigint; orderType: number; lotLNS: number | bigint; priceONS: number | bigint };
        if (BigInt(o.accountId) !== accountId) continue;
        const t = Number(o.orderType);
        if (t !== CLOSE_LONG && t !== CLOSE_SHORT) continue;
        const lots = BigInt(o.lotLNS);
        if (lots <= 0n) continue;
        const pricePNS = BigInt(o.priceONS) + basePricePNS;
        out.push({
          orderId: id,
          side: t === CLOSE_LONG ? "close-long" : "close-short",
          lots,
          pricePNS,
          price: Number(pricePNS) / 10 ** priceDecimals,
        });
      } catch {
        continue;
      }
    }
    out.sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));
    return out;
  } catch {
    return [];
  }
}
