// Derivation checks for lib/passkey.ts. The WebAuthn ceremonies
// (signInWithPasskey, createPasskeyAccount) need an authenticator prompt and
// cannot run under bun, so these tests cover the pure step instead:
// accountFromPrfOutput must map a fixed 32-byte PRF output to one stable
// address, and different outputs must diverge. The expected address below was
// computed once with these same library calls, so a change in path, salt
// handling or adapter breaks it loudly instead of silently moving funds.
import { describe, expect, it } from "bun:test";
import { accountFromPrfOutput } from "./passkey";

const FIXED_PRF = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
const OTHER_PRF = new Uint8Array(32).fill(7);

// Computed once with accountFromPrfOutput(FIXED_PRF); hardcoded so the test
// fails if the derivation drifts to a different account.
const FIXED_ADDRESS = "0x50B240678777451BEfd67B7e8c3b4366482ba8F9";

describe("accountFromPrfOutput", () => {
  it("derives the pinned address from the fixed PRF output", () => {
    const { address, account } = accountFromPrfOutput(FIXED_PRF);
    expect(address).toBe(FIXED_ADDRESS);
    expect(account.address).toBe(FIXED_ADDRESS);
  });

  it("derives the same address on every call", () => {
    const first = accountFromPrfOutput(FIXED_PRF);
    const second = accountFromPrfOutput(FIXED_PRF);
    expect(second.address).toBe(first.address);
  });

  it("gives a different address for a different PRF output", () => {
    const fixed = accountFromPrfOutput(FIXED_PRF);
    const other = accountFromPrfOutput(OTHER_PRF);
    expect(other.address).not.toBe(fixed.address);
    expect(other.address).toBe("0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f");
  });

  it("rejects outputs that are not 32 bytes", () => {
    expect(() => accountFromPrfOutput(new Uint8Array(16))).toThrow(/32 bytes/);
    expect(() => accountFromPrfOutput(new Uint8Array(0))).toThrow(/32 bytes/);
  });

  it("does not mutate the caller's PRF output", () => {
    const input = new Uint8Array(FIXED_PRF);
    accountFromPrfOutput(input);
    expect(input).toEqual(FIXED_PRF);
  });
});
