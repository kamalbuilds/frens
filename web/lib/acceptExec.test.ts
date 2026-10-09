import { describe, expect, it } from "bun:test";
import type { Address, PublicClient } from "viem";
import { acceptSignerCheck, resolveAcceptExecTarget } from "./acceptExec";
import type { Suggestion } from "./suggest";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const OPERATOR = "0x2222222222222222222222222222222222222222" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const PROXY = "0x4444444444444444444444444444444444444444" as Address;
const EXCHANGE = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc" as Address;

function suggestion(): Suggestion {
  return {
    owner: OWNER,
    market: 16,
    side: "long",
    price: 100_000,
    from: OPERATOR,
    createdAt: 1,
  };
}

describe("acceptSignerCheck", () => {
  it("rejects a stranger when operator mode is off", () => {
    const gate = acceptSignerCheck(STRANGER, suggestion(), { viaOperator: false });
    expect(gate.ok).toBe(false);
  });

  it("allows the owner without operator mode", () => {
    expect(acceptSignerCheck(OWNER, suggestion(), { viaOperator: false })).toEqual({ ok: true, viaOperator: false });
  });

  it("allows a connected wallet when operator mode is on", () => {
    expect(acceptSignerCheck(OPERATOR, suggestion(), { viaOperator: true })).toEqual({ ok: true, viaOperator: true });
  });
});

describe("resolveAcceptExecTarget", () => {
  it("sends owner accepts to the exchange", async () => {
    const client = {} as PublicClient;
    const r = await resolveAcceptExecTarget("testnet", client, OWNER, suggestion(), null);
    expect(r).toEqual({ ok: true, mode: "owner", execTo: EXCHANGE, positionAccount: OWNER });
  });

  it("rejects a non-operator even when a proxy is registered", async () => {
    const client = {
      readContract: async (args: { address: Address; functionName: string }) => {
        if (args.functionName === "owner") return OWNER;
        if (args.functionName === "exchange") return EXCHANGE;
        if (args.functionName === "isOperator") return false;
        if (args.functionName === "operatorAllowlist") return true;
        throw new Error(`unexpected ${args.functionName}`);
      },
    } as unknown as PublicClient;
    const r = await resolveAcceptExecTarget("testnet", client, STRANGER, suggestion(), PROXY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not an operator/i);
  });

  it("routes operator accepts through the delegated proxy", async () => {
    const client = {
      readContract: async (args: { address: Address; functionName: string }) => {
        if (args.functionName === "owner") return OWNER;
        if (args.functionName === "exchange") return EXCHANGE;
        if (args.functionName === "isOperator") return true;
        if (args.functionName === "operatorAllowlist") return true;
        throw new Error(`unexpected ${args.functionName}`);
      },
    } as unknown as PublicClient;
    const r = await resolveAcceptExecTarget("testnet", client, OPERATOR, suggestion(), PROXY);
    expect(r).toEqual({
      ok: true,
      mode: "operator",
      execTo: PROXY,
      positionAccount: PROXY,
      delegatedProxy: PROXY,
    });
  });
});
