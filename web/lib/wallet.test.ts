import { afterEach, describe, expect, it } from "bun:test";
import { toHex } from "viem";
import { encodeCopyOrder, toCopyOrder } from "./copy";
import { NETWORKS } from "./perpl";
import { connect, sendExecOrder } from "./wallet";

const MONAD_HEX = toHex(143);
const EXCHANGE = NETWORKS.mainnet.exchange;
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
        if (opts.switchTakesEffect !== false) state.chainId = 143;
        return null;
      case "wallet_addEthereumChain":
        if (opts.switchTakesEffect !== false) state.chainId = 143;
        return null;
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

describe("connect", () => {
  it("returns the account the wallet hands over", async () => {
    const fake = installWallet();
    expect(await connect()).toBe(ACCOUNT);
    expect(find(fake, "eth_requestAccounts")?.params).toBeUndefined();
  });

  it("throws in a browser-less environment instead of signing anything", async () => {
    noWallet();
    expect(connect()).rejects.toThrow(/browser only/);
  });

  it("throws when no EIP-1193 wallet is installed", async () => {
    (globalThis as { window?: unknown }).window = {};
    expect(connect()).rejects.toThrow(/no EIP-1193 wallet/);
  });

  it("throws when the wallet hands back no accounts", async () => {
    installWallet({ accounts: [] });
    expect(connect()).rejects.toThrow(/no accounts/);
  });

  it("does not prompt to switch when the wallet is already on Monad mainnet", async () => {
    const fake = installWallet({ chainId: 143 });
    expect(await connect()).toBe(ACCOUNT);
    // Re-reading the chain is a plain read; a switch here would be a pointless prompt.
    expect(fake.methods()).toContain("eth_chainId");
    expect(fake.methods()).not.toContain("wallet_switchEthereumChain");
  });

  it("asks the wallet to switch to Monad mainnet chain 143 from any other chain", async () => {
    const fake = installWallet({ chainId: 137 });
    expect(await connect()).toBe(ACCOUNT);
    expect(find(fake, "wallet_switchEthereumChain")?.params).toEqual([{ chainId: MONAD_HEX }]);
  });

  it("adds Monad mainnet when the wallet has never heard of it (EIP-1193 4902)", async () => {
    const fake = installWallet({ chainId: 1, switchCode: 4902 });
    expect(await connect()).toBe(ACCOUNT);
    const added = find(fake, "wallet_addEthereumChain")?.params as [{ rpcUrls: string[]; chainId: string }];
    expect(added).toHaveLength(1);
    expect(added[0]!.chainId).toBe(MONAD_HEX);
    // The Exchange only exists on mainnet, so the RPC added must be the mainnet RPC.
    expect(added[0]!.rpcUrls).toEqual(["https://rpc.monad.xyz"]);
  });

  it("refuses to trade when the wallet stays on the wrong chain after adding it", async () => {
    // A wallet that accepted wallet_addEthereumChain but did not switch would
    // otherwise sign an order against an RPC that cannot see the Exchange, and
    // the order would look accepted right up until it reverted.
    installWallet({ chainId: 1, switchCode: 4902, switchTakesEffect: false });
    expect(connect()).rejects.toThrow(/after adding Monad mainnet/);
  });

  it("rethrows a switch refusal that is not a missing chain", async () => {
    installWallet({ chainId: 1, switchCode: 4001 });
    expect(connect()).rejects.toThrow(/refused to switch/);
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

  it("sends the calldata to the exchange and returns the hash the wallet broadcast", async () => {
    const fake = installWallet();
    expect(await sendExecOrder(EXCHANGE, data)).toBe(TX_HASH);
    const sent = find(fake, "eth_sendTransaction")?.params as [{ to: string; data: string; from?: string }];
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(EXCHANGE);
    // Byte for byte what copy.ts encoded, so the wallet signs the order we built.
    expect(sent[0]!.data).toBe(data);
    expect(sent[0]!.from).toBe(ACCOUNT);
  });

  it("only ever uses public EIP-1193 methods, never a signing or key method", async () => {
    const fake = installWallet();
    await sendExecOrder(EXCHANGE, data);
    // The strongest claim in the module: this process cannot sign, because it
    // never asks the wallet to hand over anything but an account and a send.
    const signing = fake.methods().filter((m) => /^(eth_sign|personal_|eth_private|eth_accounts$)/.test(m));
    expect(signing).toEqual([]);
    expect(fake.methods()).toContain("eth_requestAccounts");
  });

  it("puts the wallet on Monad before asking it to send", async () => {
    const fake = installWallet({ chainId: 1 });
    await sendExecOrder(EXCHANGE, data);
    expect(find(fake, "wallet_switchEthereumChain")?.params).toEqual([{ chainId: MONAD_HEX }]);
    // The send comes after the switch, so the order cannot be signed against
    // a chain the Exchange does not exist on.
    expect(fake.methods().indexOf("eth_sendTransaction")).toBeGreaterThan(
      fake.methods().indexOf("wallet_switchEthereumChain"),
    );
  });

  it("prompts the wallet for the account on every send instead of hoisting one", async () => {
    const fake = installWallet();
    await sendExecOrder(EXCHANGE, data);
    await sendExecOrder(EXCHANGE, data);
    // The wallet stays the only source of the account, and it is the one that
    // decides whether a given address is allowed to send.
    expect(fake.methods().filter((m) => m === "eth_requestAccounts")).toHaveLength(2);
  });

  it("surfaces a wallet refusal instead of reporting a trade that never happened", async () => {
    const fake = installWallet();
    fake.fail("eth_sendTransaction", 4001);
    // An accepted request is not a completed trade, so this must reject rather
    // than resolve to a hash and let the caller claim a position was opened.
    expect(sendExecOrder(EXCHANGE, data)).rejects.toThrow();
    expect(fake.methods()).toContain("eth_sendTransaction");
  });
});
