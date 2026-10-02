// CallStake (contracts/src/CallStake.sol): an owner backs a friend's TP call with aUSD that pays the caller only if
// Perpl's mark reaches the TP before expiry, and returns to the owner otherwise. Testnet only for now.
import { encodeFunctionData, erc20Abi, pad, toHex, type Address, type Hex } from "viem";
import callStakeAbi from "./callstake.abi.json";
import { NETWORKS, type Network } from "./perpl";

export const CALL_STAKE: Partial<Record<Network, Address>> = {
  testnet: "0x0E8CbE0902067a49d98961A1440419AEcAf0C5Bc",
};
export { callStakeAbi };

export type StakeState = "none" | "open" | "paid" | "refunded";
const STATES: StakeState[] = ["none", "open", "paid", "refunded"];

export type StakeView = { state: StakeState; amount: number; caller: Address; expiry: number };

/// A call's stake id is its orderDescId (caller in the top 160 bits), as 32 bytes.
export function stakeId(orderDescId: bigint | string): Hex {
  return pad(toHex(BigInt(orderDescId)), { size: 32 });
}

/// The raw `stakes(id)` tuple as a view: amount in aUSD (6 decimals), expiry in unix seconds.
export function stakeView(raw: readonly unknown[]): StakeView {
  const [, caller, amount, expiry, , , state] = raw as [Address, Address, bigint, bigint, number, boolean, number];
  return { state: STATES[Number(state)] ?? "none", amount: Number(amount) / 1e6, caller, expiry: Number(expiry) };
}

/// approve then stake: the owner backs the call resting as `orderId` with `amountUsd` aUSD until `expiry`.
export function stakeCalls(
  net: Network,
  call: { orderDescId: bigint | string; caller: Address; market: number; orderId: string },
  amountUsd: number,
  expiry: number,
): { to: Address; data: Hex }[] {
  const addr = CALL_STAKE[net];
  if (!addr) throw new Error(`CallStake is not deployed on ${net}`);
  const units = BigInt(Math.round(amountUsd * 1e6));
  if (units <= 0n) throw new Error("stake must be a positive aUSD amount");
  return [
    { to: NETWORKS[net].collateral, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [addr, units] }) },
    {
      to: addr,
      data: encodeFunctionData({
        abi: callStakeAbi,
        functionName: "stake",
        args: [stakeId(call.orderDescId), call.caller, units, BigInt(call.market), BigInt(call.orderId), BigInt(expiry)],
      }),
    },
  ];
}
