import { afterEach, describe, expect, it } from "bun:test";
import { toHex } from "viem";
import { encodeCopyOrder, toCopyOrder } from "./copy";
import { NETWORKS } from "./perpl";
import { chainFor, connect, sendExecOrder } from "./wallet";

const MAINNET_HEX = toHex(143);
const TESTNET_HEX = toHex(10143);
const MAINNET_EXCHANGE = NETWORKS.mainnet.exchange;
const TESTNET_EXCHANGE = NETWORKS.testnet.exchange;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

// A fake EIP-1193 wallet. It is the only thing standing in for a browser wallet,
// so every assertion below is about what wallet.ts asks a real one to do, never
// about a key: there is no key here to leak, which is the point of the module.
type Call = { method: string; params: unknown };
type Fake = {
  calls: Call[];
  chainId: number;
  methods: () => string[];
  fail: (method: string, code: number, message?: string) => void;
};

const eip1193Error = (code: number, message: string) => Object.assign(new Error(message), { code });

function installWallet(
  opts: {
    chainId?: number;
    accounts?: string[];
    switchCode?: number;
    // Some wallets accept wallet_addEthereumChain and still stay where they were.
    switchTakesEffect?: boolean;
  } = {},
): Fake {
  const state: { chainId: number; failing: Map<string, number> } = {
    chainId: opts.chainId ?? 1,
    failing: new Map(),
  };
  if (opts.switchCode !== undefined) state.failing.set("wallet_switchEthereumChain", opts.switchCode);

  const targetOf = (params: unknown): number | null => {
    const first = (params as [{ chainId?: string }] | undefined)?.[0];
    if (!first || typeof first.chainId !== "string") return null;
    const n = Number(first.chainId);
    return Number.isInteger(n) ? n : null;
  };

  const calls: Call[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    calls.push({ method, params });
    const fail = state.failing.get(method);
    if (fail !== undefined) throw eip1193Error(fail, `${method} refused`);

    switch (method) {
      case "eth_chainId":
        return toHex(state.chainId);
      case "eth_requestAccounts":
      case "eth_accounts":
        return opts.accounts ?? [ACCOUNT];
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        if (opts.switchTakesEffect !== false) {
          const target = targetOf(params);
          if (target !== null) state.chainId = target;
        }
        return null;
      }
      case "eth_sendTransaction":
        return TX_HASH;
      case "eth_estimateGas":
        return "0x5208";
      case "eth_getTransactionCount":
        return "0x0";
      default:
        throw new Error(`fake wallet got an unexpected method: ${method}`);
    }
  };

  (globalThis as { window?: unknown }).window = { ethereum: { request } };
  return {
    calls,
    get chainId() {
      return state.chainId;
    },
    methods: () => calls.map((c) => c.method),
    fail: (method, code) => state.failing.set(method, code),
  };
}

const find = (fake: Fake, method: string) => fake.calls.find((c) => c.method === method);
const noWallet = () => {
  delete (globalThis as { window?: unknown }).window;
};

afterEach(noWallet);

describe("chainFor", () => {
  it("picks chain 143 for mainnet and 10143 for testnet", () => {
    expect(chainFor("mainnet").id).toBe(143);
    expect(chainFor("testnet").id).toBe(10143);
  });
});

describe("connect", () => {
  it("returns the account the wallet hands over", async () => {
    const fake = installWallet({ chainId: 10143 });
    expect(await connect("testnet")).toBe(ACCOUNT);
    expect(find(fake, "eth_requestAccounts")?.params).toBeUndefined();
  });

  it("defaults to testnet when no network is passed", async () => {
    const fake = installWallet({ chainId: 137 });
    expect(await connect()).toBe(ACCOUNT);
    expect(find(fake, "wallet_switchEthereumChain")?.params).toEqual([{ chainId: TESTNET_HEX }]);
  });

  it("throws in a browser-less environment instead of signing anything", async () => {
    noWallet();
    expect(connect("testnet")).rejects.toThrow(/browser only/);
  });

  it("throws when no EIP-1193 wallet is installed", async () => {
    (globalThis as { window?: unknown }).window = {};
    expect(connect("testnet")).rejects.toThrow(/no EIP-1193 wallet/);
  });

  it("throws when the wallet hands back no accounts", async () => {
    installWallet({ accounts: [] });
    expect(connect("testnet")).rejects.toThrow(/no accounts/);
  });

  it("does not prompt to switch when the wallet is already on the selected chain", async () => {
    const fake = installWallet({ chainId: 143 });
    expect(await connect("mainnet")).toBe(ACCOUNT);
    // Re-reading the chain is a plain read; a switch here would be a pointless prompt.
    expect(fake.methods()).toContain("eth_chainId");
    expect(fake.methods()).not.toContain("wallet_switchEthereumChain");
  });

  it("asks the wallet to switch to Monad mainnet chain 143 from any other chain", async () => {
    const fake = installWallet({ chainId: 137 });
    expect(await connect("mainnet")).toBe(ACCOUNT);
    expect(find(fake, "wallet_switchEthereumChain")?.params).toEqual([{ chainId: MAINNET_HEX }]);
  });

  it("asks the wallet to switch to Monad testnet chain 10143 from mainnet", async () => {
    const fake = installWallet({ chainId: 143 });
    expect(await connect("testnet")).toBe(ACCOUNT);
    expect(find(fake, "wallet_switchEthereumChain")?.params).toEqual([{ chainId: TESTNET_HEX }]);
  });

  it("adds the testnet chain when the wallet has never heard of it (EIP-1193 4902)", async () => {
    const fake = installWallet({ chainId: 1, switchCode: 4902 });
    expect(await connect("testnet")).toBe(ACCOUNT);
    const added = find(fake, "wallet_addEthereumChain")?.params as [{ rpcUrls: string[]; chainId: string }];
    expect(added).toHaveLength(1);
    expect(added[0]!.chainId).toBe(TESTNET_HEX);
    // The testnet Exchange only exists on testnet, so the RPC added must be the testnet RPC.
    expect(added[0]!.rpcUrls).toEqual(["https://testnet-rpc.monad.xyz"]);
  });

  it("adds Monad mainnet when the wallet has never heard of it (EIP-1193 4902)", async () => {
    const fake = installWallet({ chainId: 1, switchCode: 4902 });
    expect(await connect("mainnet")).toBe(ACCOUNT);
    const added = find(fake, "wallet_addEthereumChain")?.params as [{ rpcUrls: string[]; chainId: string }];
    expect(added).toHaveLength(1);
    expect(added[0]!.chainId).toBe(MAINNET_HEX);
    // The Exchange only exists on mainnet, so the RPC added must be the mainnet RPC.
    expect(added[0]!.rpcUrls).toEqual(["https://rpc.monad.xyz"]);
  });

  it("refuses to trade when the wallet stays on the wrong chain after adding it", async () => {
    // A wallet that accepted wallet_addEthereumChain but did not switch would
    // otherwise sign an order against an RPC that cannot see the Exchange, and
    // the order would look accepted right up until it reverted.
    installWallet({ chainId: 1, switchCode: 4902, switchTakesEffect: false });
    expect(connect("testnet")).rejects.toThrow(/after adding Monad testnet/);
  });

  it("rethrows a switch refusal that is not a missing chain", async () => {
    installWallet({ chainId: 1, switchCode: 4001 });
    expect(connect("testnet")).rejects.toThrow(/refused to switch/);
  });
});

describe("sendExecOrder", () => {
  // A real copy order, so this also proves the bytes wallet.ts signs are exactly
  // the bytes copy.ts built, with nothing mangled in between.
  const META = { priceDecimals: 1n, lotDecimals: 5n };
  const order = toCopyOrder({ market: 16, side: "long" }, META, {
    size: 0.00179,
    markPrice: 70000,
    maxSlippageBps: 200,
    orderDescId: 1_758_638_400_000n,
  });
  const data = encodeCopyOrder(order);

  it("sends the calldata to the testnet exchange and returns the hash the wallet broadcast", async () => {
    const fake = installWallet({ chainId: 10143 });
    expect(await sendExecOrder(TESTNET_EXCHANGE, data, "testnet")).toBe(TX_HASH);
    const sent = find(fake, "eth_sendTransaction")?.params as [{ to: string; data: string; from?: string }];
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(TESTNET_EXCHANGE);
    // Byte for byte what copy.ts encoded, so the wallet signs the order we built.
    expect(sent[0]!.data).toBe(data);
    expect(sent[0]!.from).toBe(ACCOUNT);
  });

  it("sends to the mainnet exchange on mainnet", async () => {
    const fake = installWallet({ chainId: 143 });
    expect(await sendExecOrder(MAINNET_EXCHANGE, data, "mainnet")).toBe(TX_HASH);
    const sent = find(fake, "eth_sendTransaction")?.params as [{ to: string }];
    expect(sent[0]!.to).toBe(MAINNET_EXCHANGE);
  });

  it("only ever uses public EIP-1193 methods, never a signing or key method", async () => {
    const fake = installWallet({ chainId: 10143 });
    await sendExecOrder(TESTNET_EXCHANGE, data, "testnet");
    // The strongest claim in the module: this process cannot sign, because it
    // never asks the wallet to hand over anything but an account and a send.
    const signing = fake.methods().filter((m) => /^(eth_sign|personal_|eth_private|eth_accounts$)/.test(m));
    expect(signing).toEqual([]);
    expect(fake.methods()).toContain("eth_requestAccounts");
  });

  it("puts the wallet on the selected chain before asking it to send", async () => {
    const fake = installWallet({ chainId: 1 });
    await sendExecOrder(TESTNET_EXCHANGE, data, "testnet");
    expect(find(fake, "wallet_switchEthereumChain")?.params).toEqual([{ chainId: TESTNET_HEX }]);
    // The send comes after the switch, so the order cannot be signed against
    // a chain the Exchange does not exist on.
    expect(fake.methods().indexOf("eth_sendTransaction")).toBeGreaterThan(
      fake.methods().indexOf("wallet_switchEthereumChain"),
    );
  });

  it("prompts the wallet for the account on every send instead of hoisting one", async () => {
    const fake = installWallet({ chainId: 10143 });
    await sendExecOrder(TESTNET_EXCHANGE, data, "testnet");
    await sendExecOrder(TESTNET_EXCHANGE, data, "testnet");
    // The wallet stays the only source of the account, and it is the one that
    // decides whether a given address is allowed to send.
    expect(fake.methods().filter((m) => m === "eth_requestAccounts")).toHaveLength(2);
  });

  it("surfaces a wallet refusal instead of reporting a trade that never happened", async () => {
    const fake = installWallet({ chainId: 10143 });
    fake.fail("eth_sendTransaction", 4001);
    // An accepted request is not a completed trade, so this must reject rather
    // than resolve to a hash and let the caller claim a position was opened.
    expect(sendExecOrder(TESTNET_EXCHANGE, data, "testnet")).rejects.toThrow();
    expect(fake.methods()).toContain("eth_sendTransaction");
  });
});
