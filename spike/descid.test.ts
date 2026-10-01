import { test, expect } from "bun:test";
import { createPublicClient, http, decodeEventLog } from "viem";
import abi from "./exchange-official.abi.json";
test("orderDescId round trip on live Perpl testnet", async () => {
  const c = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
  const r = await c.getTransactionReceipt({ hash: "0xfc48d1f8e6805b4cc02f9b0975024af3e435194932bcb18e66bf19b1f982e45b" });
  const reqs = r.logs.map((l) => { try { return decodeEventLog({ abi: abi as any, data: l.data, topics: l.topics }); } catch { return null; } }).filter((e: any) => e?.eventName === "OrderRequestV2");
  expect(reqs.length).toBe(1);
  const id = (reqs[0] as any).args.orderDescId as bigint;
  const suggester = "0x" + (id >> 96n).toString(16).padStart(40, "0");
  console.log("orderDescId", id.toString(), "suggester", suggester, "orderId", (reqs[0] as any).args.orderId);
  expect(suggester.toLowerCase()).toBe("0x4981053aa266d74f9914a74ad8ed79014846ace9");
}, 60000);
