import type { Address } from "viem";
import { encodeRoom } from "./roomlink";
import { encodeKeyedNames } from "./names";

export const DEMO_WALLETS = {
  bo: "0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244" as Address,
  cy: "0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD" as Address,
} as const;

/** cy's Perpl DelegatedAccount on testnet (bo is operator). Fund createAccount to place TP via operator Accept. */
export const DEMO_CY_DELEGATED_PROXY = "0x8485e4f51ea8f2ed32452b0482c820a30f16f193" as Address;

export type DemoRole = keyof typeof DEMO_WALLETS;

export const demoRoomAccounts = [DEMO_WALLETS.bo, DEMO_WALLETS.cy];

export const demoNames = ["9142:bo", "4eb6:cy"];

export const DEMO_ROOM_CODE = encodeRoom(demoRoomAccounts);

export const DEMO_NAMES_QUERY = encodeKeyedNames(demoRoomAccounts, (a) => {
  const lower = a.toLowerCase();
  if (lower === DEMO_WALLETS.bo.toLowerCase()) return "bo";
  if (lower === DEMO_WALLETS.cy.toLowerCase()) return "cy";
  return undefined;
});

export const DEMO_STEPS = [
  "Two wallets on one BTC chart. bo and cy each hold a live Perpl testnet position.",
  "Act as bo: select cy, drag a take-profit line onto their position.",
  "Tap Send to cy. The call lands on the same chart (no external chat app).",
  "Act as bo: connect your wallet and tap Accept (delegated operator on cy's Perpl account).",
  "Share card: post the room card with both PnLs and the call record.",
] as const;
