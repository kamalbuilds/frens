// Owner's resting reduce-only closes for one market.
//
// Accepting a friend's TP when the owner already has a resting reduce-only
// close for the full size reverts: Perpl locks those lots. The Accept path
// reads the owner's open closes first (this module), then replaces them in
// one batch (suggest.ts buildAcceptOrders) so the owner signs once.
//
// Strategy: the owner's accountId comes from getAccountByAddr, the market's
// basePricePNS and priceDecimals from getPerpetualInfoV2, candidate order ids
// from OrderRequestV2 (plus V1) logs in the last 2,000 blocks joined to the
// OrderPlaced log in the same transaction for the real orderId (the V2 log
// carries orderId 0, proven in callbook.ts), and each candidate is read back
// with getOrderV2. Only orders still owned by the account with close type
// and nonzero lots are returned. Resting prices are stored on chain as an
// offset (ONS) from the base price (proven in src/trade.ts), so
// pricePNS = priceONS + basePricePNS.
//
// Never throws: a lookup failure returns [], and the caller falls back to
// the old single-close path rather than blocking Accept.
import { decodeEventLog, type AbiEvent, type Address, type Hex, type PublicClient } from "viem";
import officialAbiJson from "./exchange-official.abi.json";
import { CLOSE_LONG, CLOSE_SHORT } from "./suggest";
import { NETWORKS, exchangeAbi, type Network } from "./perpl";

const officialAbi = officialAbiJson as readonly AbiEvent[];

function eventAbi(name: string): AbiEvent {
  const found = officialAbi.find((e) => e.type === "event" && e.name === name);
  if (!found) throw new Error(`official Exchange ABI has no event ${name}`);
  return found;
}

export type RestingClose = {
  orderId: bigint;
  side: "close-long" | "close-short";
  lots: bigint;
  pricePNS: bigint;
  price: number;
};

// How far back the log scan goes. Matches the RPC fallback window in
// callbook.ts: Perpl logs are unindexed, so a wider window means downloading
// every order on the venue.
export const RESTING_LOOKBACK_BLOCKS = 2000n;

type AnyLog = {
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
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

    const latest = await client.getBlockNumber();
    const fromBlock = latest > RESTING_LOOKBACK_BLOCKS ? latest - RESTING_LOOKBACK_BLOCKS : 0n;

    const perp = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPerpetualInfoV2",
      args: [perpId],
    })) as { basePricePNS: bigint; priceDecimals: bigint };
    const basePricePNS = BigInt(perp.basePricePNS);
    const priceDecimals = Number(perp.priceDecimals);

    const reqV2 = eventAbi("OrderRequestV2");
    const reqV1 = eventAbi("OrderRequest");
    const placedEv = eventAbi("OrderPlaced");

    const [v2logs, v1logs, placedLogs] = (await Promise.all([
      client.getLogs({ address: exchange, event: reqV2, fromBlock, toBlock: latest }),
      client.getLogs({ address: exchange, event: reqV1, fromBlock, toBlock: latest }),
      client.getLogs({ address: exchange, event: placedEv, fromBlock, toBlock: latest }),
    ])) as unknown as AnyLog[][];

    const orderIdByTx = new Map<string, bigint>();
    for (const log of placedLogs ?? []) {
      try {
        const ev = decodeEventLog({ abi: officialAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName !== "OrderPlaced") continue;
        const args = ev.args as unknown as { orderId: bigint };
        orderIdByTx.set(log.transactionHash.toLowerCase(), BigInt(args.orderId));
      } catch {
        continue;
      }
    }

    const candidates: bigint[] = [];
    const consider = (log: AnyLog) => {
      try {
        const ev = decodeEventLog({ abi: officialAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName !== "OrderRequestV2" && ev.eventName !== "OrderRequest") return;
        const args = ev.args as unknown as {
          perpId: bigint;
          accountId: bigint;
          orderId: bigint;
          orderType: number;
        };
        if (BigInt(args.perpId) !== perpId) return;
        if (BigInt(args.accountId) !== accountId) return;
        const t = Number(args.orderType);
        if (t !== CLOSE_LONG && t !== CLOSE_SHORT) return;
        const rawId = BigInt(args.orderId);
        if (rawId !== 0n) {
          candidates.push(rawId);
          return;
        }
        const resolved = orderIdByTx.get(log.transactionHash.toLowerCase());
        if (resolved !== undefined && resolved !== 0n) candidates.push(resolved);
      } catch {
        return;
      }
    };
    for (const log of [...(v2logs ?? []), ...(v1logs ?? [])]) consider(log);

    const seen = new Set<string>();
    const ids: bigint[] = [];
    for (const id of candidates) {
      const k = id.toString();
      if (seen.has(k) || id === 0n) continue;
      seen.add(k);
      ids.push(id);
    }
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
