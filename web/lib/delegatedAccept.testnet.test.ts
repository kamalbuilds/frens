import { describe, expect, it } from "bun:test";
import { createPublicClient, http, type Address } from "viem";
import { NETWORKS, publicClient } from "./perpl";
import { DELEGATED_FACTORY, delegatedAccountAbi } from "./delegated";
import { encodeCloseOrder, OPEN_LONG, LEVERAGE_HDTHS, MAX_NEG_PNL_COLLAT_BPS } from "./suggest";

const RUN = process.env.CHARTROOM_DELEGATED_TESTNET === "1";
const proxy = process.env.CHARTROOM_DELEGATED_PROXY as Address | undefined;
const stranger = "0x3333333333333333333333333333333333333333" as Address;

const dummyOrder = {
  orderDescId: 1n,
  perpId: 16n,
  orderType: OPEN_LONG,
  orderId: 0n,
  pricePNS: 1n,
  lotLNS: 1n,
  expiryBlock: 0n,
  postOnly: true,
  fillOrKill: false,
  immediateOrCancel: false,
  maxMatches: 0n,
  leverageHdths: LEVERAGE_HDTHS,
  lastExecutionBlock: 0n,
  amountCNS: 0n,
  maxNegPnlCollatBPS: MAX_NEG_PNL_COLLAT_BPS,
};

if (RUN && proxy) {
  describe("delegated accept on testnet", () => {
    const client = publicClient("testnet");

    it("reverts when a non-operator calls execOrder on the delegated proxy", async () => {
      const data = encodeCloseOrder(dummyOrder);
      await expect(client.call({ account: stranger, to: proxy!, data })).rejects.toMatchObject({
        shortMessage: expect.stringMatching(/revert|execution reverted/i),
      });
    });
  });
}

describe("delegated factory deployment", () => {
  it("has bytecode on the network chartroom uses", async () => {
    const client = createPublicClient({ transport: http(NETWORKS.testnet.rpc) });
    const code = await client.getBytecode({ address: DELEGATED_FACTORY.testnet });
    expect(code && code.length > 2).toBe(true);
  });
});
