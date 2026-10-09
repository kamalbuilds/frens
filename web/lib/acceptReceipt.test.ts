import { describe, expect, it } from "bun:test";
import { acceptTxExplorerHref, isOnchainTxHash } from "./acceptReceipt";

const REAL = "0xc1581071d22d3192a27911a53191b083f166d6b99f4ce2aae95b8d1d1dd751a8";

describe("acceptTxExplorerHref", () => {
  it("returns an explorer URL for a 32-byte tx hash", () => {
    const href = acceptTxExplorerHref("testnet", REAL);
    expect(href).not.toBeNull();
    expect(href!).toContain(REAL);
  });

  it("returns null when the hash is missing or not a full tx id", () => {
    expect(acceptTxExplorerHref("testnet", "")).toBeNull();
    expect(acceptTxExplorerHref("testnet", "0xabc")).toBeNull();
    expect(acceptTxExplorerHref("testnet", undefined)).toBeNull();
    expect(acceptTxExplorerHref("testnet", "not-a-hash")).toBeNull();
  });

  it("mutation: without length validation a fake hash would get a link", () => {
    const broken = "0x" + "a".repeat(64);
    expect(isOnchainTxHash(broken)).toBe(true);
    expect(acceptTxExplorerHref("testnet", "0xdead")).toBeNull();
  });
});
