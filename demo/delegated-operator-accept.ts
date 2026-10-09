// Operator accept through Perpl DelegatedAccount (execOrder on the proxy, not the Exchange).
// Uses demo/.wallets.json: owner cy, operator bo. Creates a delegated account when CHARTROOM_DELEGATED_PROXY is unset.
//   bun run demo/delegated-operator-accept.ts "<call link or s= payload>"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, exchangeAbi, publicClient } from "../web/lib/perpl";
import { padGas } from "../web/lib/wallet";
import { readPerpMeta, readPosition } from "../web/lib/readPosition";
import {
  buildAcceptOrders,
  decodeSuggestion,
  encodeAcceptBatch,
  encodeCloseOrder,
  OPEN_LONG,
  LEVERAGE_HDTHS,
  MAX_NEG_PNL_COLLAT_BPS,
  sizeToLots,
  toCloseOrder,
  validateSuggestion,
} from "../web/lib/suggest";
import { findRestingCloses } from "../web/lib/resting";
import { DELEGATED_FACTORY, delegatedAccountAbi } from "../web/lib/delegated";
import { resolveAcceptExecTarget } from "../web/lib/acceptExec";

const net = NETWORKS.testnet;
const client = publicClient("testnet");
const chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [net.rpc] } },
} as const;
const factoryAbi = parseAbi([
  "function create(address _operator, uint256 _opDeadline, bytes _opSig) returns (address proxy)",
  "function operatorNonces(address operator) view returns (uint256)",
  "event DelegatedAccountCreated(address indexed proxy, address indexed owner, address indexed operator)",
]);

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const keys: Record<string, Hex> = JSON.parse(fs.readFileSync(path.join(demoDir, ".wallets.json"), "utf8"));
const cy = keys.cy ? privateKeyToAccount(keys.cy) : null;
const bo = keys.bo ? privateKeyToAccount(keys.bo) : null;
if (!cy || !bo) throw new Error("demo/.wallets.json must include cy and bo keys");

const arg = process.argv[2] ?? "";
const payload = arg.includes("s=") ? new URL(arg).searchParams.get("s") ?? "" : arg;
const s = decodeSuggestion(payload);
if (!s) throw new Error("not a valid call link");

async function send(account: typeof cy, to: Address, data: Hex, label: string): Promise<Hex> {
  const w = createWalletClient({ account, chain, transport: http(net.rpc) });
  const gas = padGas(await client.estimateGas({ account: account.address, to, data }));
  const hash = await w.sendTransaction({ to, data, gas });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return hash;
}

async function ensureDelegatedProxy(): Promise<Address> {
  const env = process.env.CHARTROOM_DELEGATED_PROXY?.trim();
  if (env && /^0x[0-9a-fA-F]{40}$/.test(env)) return env as Address;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = (await client.readContract({
    address: DELEGATED_FACTORY.testnet,
    abi: factoryAbi,
    functionName: "operatorNonces",
    args: [bo.address],
  })) as bigint;
  const boWallet = createWalletClient({ account: bo, chain, transport: http(net.rpc) });
  const opSig = await boWallet.signTypedData({
    account: bo,
    domain: {
      name: "DelegatedAccountFactory",
      version: "1",
      chainId: chain.id,
      verifyingContract: DELEGATED_FACTORY.testnet,
    },
    types: {
      AssignOperator: [
        { name: "owner", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "AssignOperator",
    message: { owner: cy.address, nonce, deadline },
  });
  const createData = encodeFunctionData({
    abi: factoryAbi,
    functionName: "create",
    args: [bo.address, deadline, opSig],
  });
  const hash = await send(cy, DELEGATED_FACTORY.testnet, createData, "create DelegatedAccount");
  const receipt = await client.getTransactionReceipt({ hash });
  const created = receipt.logs.find((l) => l.topics[0]?.toLowerCase() === keccak256(stringToHex("DelegatedAccountCreated(address,address,address)")).toLowerCase());
  if (!created?.topics[1]) throw new Error("DelegatedAccountCreated not found");
  const proxy = (`0x${created.topics[1].slice(26)}` as Address);
  console.log(JSON.stringify({ delegatedProxy: proxy, owner: cy.address, operator: bo.address }));
  return proxy;
}

const OPERATOR_GRANT_SELECTORS = ["0x4d8dc985", "0x39435dac"] as const;
const OPERATOR_REVOKE_SELECTORS = ["0x6b69ebbe", "0xaf3176da"] as const;

async function syncOperatorAllowlist(proxy: Address): Promise<void> {
  const abi = parseAbi([
    "function setOperatorAllowlist(bytes4 selector, bool allowed) external",
    "function operatorAllowlist(bytes4 selector) view returns (bool)",
  ]);
  for (const sel of OPERATOR_GRANT_SELECTORS) {
    const allowed = (await client.readContract({ address: proxy, abi, functionName: "operatorAllowlist", args: [sel] })) as boolean;
    if (!allowed) {
      await send(
        cy,
        proxy,
        encodeFunctionData({ abi, functionName: "setOperatorAllowlist", args: [sel as Hex, true] }),
        `allowlist ${sel}`,
      );
    }
  }
  for (const sel of OPERATOR_REVOKE_SELECTORS) {
    const allowed = (await client.readContract({ address: proxy, abi, functionName: "operatorAllowlist", args: [sel] })) as boolean;
    if (allowed) {
      await send(
        cy,
        proxy,
        encodeFunctionData({ abi, functionName: "setOperatorAllowlist", args: [sel as Hex, false] }),
        `revoke ${sel}`,
      );
    }
  }
}

async function ensureProxyPosition(proxy: Address, market: number): Promise<void> {
  const existing = await readPosition(proxy, market, { network: "testnet", client });
  if (existing) return;

  let accountId = (await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "accountId" })) as bigint;
  if (accountId === 0n) {
    const min = (await client.readContract({ address: net.exchange, abi: exchangeAbi, functionName: "getMinAccountOpenCNS" })) as bigint;
    const need = min * 2n;
    const proxyBal = (await client.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [proxy] })) as bigint;
    if (proxyBal < need) {
      let funded = false;
      for (const [name, pk] of Object.entries(keys)) {
        const funder = privateKeyToAccount(pk);
        const bal = (await client.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] })) as bigint;
        if (bal < need) continue;
        await send(funder, net.collateral, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [proxy, need] }), `fund proxy from ${name}`);
        funded = true;
        break;
      }
      if (!funded) {
        const cyBal = (await client.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [cy.address] })) as bigint;
        throw new Error(
          `no demo wallet holds ${Number(need) / 1e6} aUSD to fund the proxy (cy has ${Number(cyBal) / 1e6})`,
        );
      }
    }
    await send(cy, proxy, encodeFunctionData({ abi: parseAbi(["function createAccount(uint256 amount)"]), functionName: "createAccount", args: [min] }), "createAccount on proxy");
    accountId = (await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "accountId" })) as bigint;
    if (accountId === 0n) throw new Error("proxy accountId still zero");
  }

  const meta = await readPerpMeta(client, net.exchange, market);
  const perp = (await client.readContract({
    address: net.exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [BigInt(market)],
  })) as { markPNS: bigint };
  const mark = Number(perp.markPNS) / 10 ** Number(meta.priceDecimals);
  const lots = 10n;
  const openPx = BigInt(Math.round(mark * 1.02 * 10 ** Number(meta.priceDecimals)));
  const open = {
    orderDescId: BigInt(Date.now()),
    perpId: BigInt(market),
    orderType: OPEN_LONG,
    orderId: 0n,
    pricePNS: openPx,
    lotLNS: lots,
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: 0n,
    leverageHdths: LEVERAGE_HDTHS,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxNegPnlCollatBPS: MAX_NEG_PNL_COLLAT_BPS,
  };
  await send(cy, proxy, encodeCloseOrder(open), "open long on proxy");
  let opened = await readPosition(proxy, market, { network: "testnet", client });
  for (let i = 0; i < 30 && !opened; i++) {
    await Bun.sleep(500);
    opened = await readPosition(proxy, market, { network: "testnet", client });
  }
  if (!opened) throw new Error("position did not appear on delegated proxy");
}

const proxy = await ensureDelegatedProxy();
process.env.CHARTROOM_DELEGATED_OWNER = cy.address;
process.env.CHARTROOM_DELEGATED_PROXY = proxy;

if (process.env.SKIP_PROXY_SETUP !== "1") {
  await ensureProxyPosition(proxy, s.market);
}
await syncOperatorAllowlist(proxy);

let position = await readPosition(proxy, s.market, { network: "testnet", client });
if (!position && process.env.ALLOW_DELEGATED_REVERT_PROOF === "1") {
  position = await readPosition(s.owner, s.market, { network: "testnet", client });
}
if (!position) throw new Error("delegated account has no open position on this market");
const meta = await readPerpMeta(client, net.exchange, s.market);
const problems = validateSuggestion(s, { ...position, account: s.owner }, meta.lotDecimals);
if (problems.length) throw new Error(`call rejected: ${problems.join("; ")}`);

const target = await resolveAcceptExecTarget("testnet", client, bo.address, s, proxy);
if (!target.ok || target.mode !== "operator") throw new Error(`expected operator target, got ${JSON.stringify(target)}`);

const order = toCloseOrder(s, meta, { fullSizeLots: sizeToLots(position.size, meta.lotDecimals) });
const resting = (await findRestingCloses("testnet", client, proxy, s.market)).filter((r) => r.side === (s.side === "long" ? "close-long" : "close-short"));
const orders = buildAcceptOrders(order, resting.map((r) => r.orderId));
const data = orders.length > 1 ? encodeAcceptBatch(orders, true) : encodeCloseOrder(order);

const w = createWalletClient({ account: bo, chain, transport: http(net.rpc) });
let gas: bigint;
try {
  gas = padGas(await client.estimateGas({ account: bo.address, to: target.execTo, data }));
} catch {
  gas = 2_000_000n;
}
const hash = await w.sendTransaction({ to: target.execTo, data, gas });
const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log(
  JSON.stringify(
    {
      mode: "operator",
      delegatedProxy: proxy,
      acceptTx: hash,
      receiptStatus: r.status,
      revertProof: r.status === "reverted" ? "operator reached DelegatedAccount; exchange path reverted as expected without funded account" : "success",
    },
    null,
    1,
  ),
);
if (r.status !== "success" && process.env.ALLOW_DELEGATED_REVERT_PROOF !== "1") {
  throw new Error(`operator accept reverted: ${hash}`);
}
