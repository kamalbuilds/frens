// CallStake (contracts/src/CallStake.sol): an owner backs a friend's TP call with aUSD that pays the caller only if
// Perpl's mark reaches the TP before expiry, and returns to the owner otherwise. Since v3 the caller can bond their
// own call: returned with the stake on a hit, slashed to the owner on a miss.
import { encodeFunctionData, erc20Abi, pad, toHex, type Address, type Hex } from "viem";
import callStakeAbi from "./callstake.abi.json";
import { NETWORKS, type Network } from "./perpl";

// v2 added the 0.5% minimum TP distance; v3 adds the caller's bond. New stakes go to v3; rooms read every version, so
// stakes placed earlier still show and still settle.
export const CALL_STAKE: Partial<Record<Network, Address>> = {
  testnet: "0x31cD68210a05A4d921aF7b4dEe7a5ab99fB45390",
};
export const CALL_STAKE_READ: Partial<Record<Network, Address[]>> = {
  testnet: ["0x31cD68210a05A4d921aF7b4dEe7a5ab99fB45390", "0xB83D69657EED4Abd327b3539F24f07556c1A5a36", "0x0E8CbE0902067a49d98961A1440419AEcAf0C5Bc"],
};
/// The minimum TP distance from Perpl's mark that CallStake v2 accepts, in basis points (MIN_DISTANCE_BPS on chain).
export const MIN_STAKE_DISTANCE_BPS = 50;
export { callStakeAbi };

export type StakeState = "none" | "open" | "paid" | "refunded";
const STATES: StakeState[] = ["none", "open", "paid", "refunded"];

/// `bond` is the caller's own aUSD on the call (v3 only, else 0); `contract` is the CallStake that holds the stake.
export type StakeView = { state: StakeState; amount: number; caller: Address; expiry: number; bond: number; contract?: Address };

/// A call's stake id is its orderDescId (caller in the top 160 bits), as 32 bytes.
export function stakeId(orderDescId: bigint | string): Hex {
  return pad(toHex(BigInt(orderDescId)), { size: 32 });
}

/// The raw `stakes(id)` tuple as a view: amount in aUSD (6 decimals), expiry in unix seconds.
export function stakeView(raw: readonly unknown[]): StakeView {
  const [, caller, amount, expiry, , , state] = raw as [Address, Address, bigint, bigint, number, boolean, number];
  return { state: STATES[Number(state)] ?? "none", amount: Number(amount) / 1e6, caller, expiry: Number(expiry), bond: 0 };
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

/// approve then bond: the caller backs their own open call on `contract` (v3) with `amountUsd` aUSD.
export function bondCalls(contract: Address, orderDescId: bigint | string, amountUsd: number, net: Network): { to: Address; data: Hex }[] {
  const units = BigInt(Math.round(amountUsd * 1e6));
  if (units <= 0n) throw new Error("bond must be a positive aUSD amount");
  return [
    { to: NETWORKS[net].collateral, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contract, units] }) },
    { to: contract, data: encodeFunctionData({ abi: callStakeAbi, functionName: "bond", args: [stakeId(orderDescId), units] }) },
  ];
}
