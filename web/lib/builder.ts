// Perpl builder attribution for orders a wallet signs directly. Perpl issued frens builder id 23 on 2026-10-02.
// Envelope per PerplFoundation/dex-sdk crates/sdk/src/types/extension.rs (OrderExtensionLib):
// abi.encode(uint16 version = 1, bytes payload), payload = abi.encode(uint256 builderId, uint256 builderFeePer100K).
// The fee applies only to the size an order opens or increases; closes carry none. Max 1,000 per 100k (1%).
import { encodeAbiParameters, encodeFunctionData, type Abi, type Hex } from "viem";
import officialAbi from "./exchange-official.abi.json";

export const FRENS_BUILDER_ID = 23;
export const ORDER_EXTENSION_VERSION = 1;
export const MAX_BUILDER_FEE_PER_100K = 1_000;

export function builderExtension(builderId: number, feePer100K: number): Hex {
  if (!Number.isInteger(builderId) || builderId < 1 || builderId > 255) throw new Error(`builder id must be 1..255, got ${builderId}`);
  if (!Number.isInteger(feePer100K) || feePer100K < 0 || feePer100K > MAX_BUILDER_FEE_PER_100K) {
    throw new Error(`builder fee must be 0..${MAX_BUILDER_FEE_PER_100K} per 100k, got ${feePer100K}`);
  }
  const payload = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(builderId), BigInt(feePer100K)]);
  return encodeAbiParameters([{ type: "uint16" }, { type: "bytes" }], [ORDER_EXTENSION_VERSION, payload]);
}

/// execOrderV2 calldata: the same OrderDesc the app already builds, plus the builder envelope.
export function encodeOrderV2(order: Record<string, unknown>, extension: Hex): Hex {
  return encodeFunctionData({ abi: officialAbi as Abi, functionName: "execOrderV2", args: [order, extension] });
}
