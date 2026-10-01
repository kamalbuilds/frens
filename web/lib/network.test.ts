import { describe, expect, it } from "bun:test";
import { API_BASES, configFor, explorerTxUrl, parseNet, parseNetParam, roomLink, withNetParam } from "./network";
import { NETWORKS } from "./perpl";

describe("parseNet", () => {
  it("defaults to testnet for anything missing or unrecognised", () => {
    expect(parseNet(undefined)).toBe("testnet");
    expect(parseNet(null)).toBe("testnet");
    expect(parseNet("")).toBe("testnet");
    expect(parseNet("testnet")).toBe("testnet");
    expect(parseNet("bogus")).toBe("testnet");
    expect(parseNet(143)).toBe("testnet");
  });
  it("picks mainnet only for ?net=mainnet", () => {
    expect(parseNet("mainnet")).toBe("mainnet");
    expect(parseNet("  MAINNET ")).toBe("mainnet");
  });
});

describe("parseNetParam", () => {
  it("reads ?net= off a search string and defaults without it", () => {
    expect(parseNetParam("?net=mainnet")).toBe("mainnet");
    expect(parseNetParam("?net=testnet")).toBe("testnet");
    expect(parseNetParam("")).toBe("testnet");
    expect(parseNetParam(null)).toBe("testnet");
    expect(parseNetParam(undefined)).toBe("testnet");
  });
  it("reads ?net= off URLSearchParams alongside other params", () => {
    expect(parseNetParam(new URLSearchParams("market=16&net=mainnet"))).toBe("mainnet");
    expect(parseNetParam(new URLSearchParams("market=16"))).toBe("testnet");
  });
});

describe("configFor", () => {
  it("picks the mainnet exchange, collateral, API base and chain id", () => {
    const c = configFor("mainnet");
    expect(c.exchange).toBe(NETWORKS.mainnet.exchange);
    expect(c.exchange).toBe("0x34B6552d57a35a1D042CcAe1951BD1C370112a6F");
    expect(c.collateral).toBe(NETWORKS.mainnet.collateral);
    expect(c.apiBase).toBe("https://app.perpl.xyz/api/v1");
    expect(c.apiBase).toBe(API_BASES.mainnet);
    expect(c.chainId).toBe(143);
  });
  it("picks the testnet exchange, collateral, API base and chain id", () => {
    const c = configFor("testnet");
    expect(c.exchange).toBe(NETWORKS.testnet.exchange);
    expect(c.exchange).toBe("0x1964C32f0bE608E7D29302AFF5E61268E72080cc");
    expect(c.collateral).toBe(NETWORKS.testnet.collateral);
    expect(c.apiBase).toBe("https://testnet.perpl.xyz/api/v1");
    expect(c.apiBase).toBe(API_BASES.testnet);
    expect(c.chainId).toBe(10143);
  });
  it("keeps the two networks on different chains and exchanges", () => {
    expect(configFor("mainnet").chainId).not.toBe(configFor("testnet").chainId);
    expect(configFor("mainnet").exchange).not.toBe(configFor("testnet").exchange);
  });
});

describe("room links preserve net", () => {
  const code = "abc123";
  it("roomLink carries the network", () => {
    expect(roomLink(code, "testnet")).toBe(`/r/${code}?net=testnet`);
    expect(roomLink(code, "mainnet")).toBe(`/r/${code}?net=mainnet`);
  });
  it("withNetParam sets net while keeping the room path and other params", () => {
    expect(withNetParam(`/r/${code}?net=testnet`, "mainnet")).toBe(`/r/${code}?net=mainnet`);
    expect(withNetParam(`/r/${code}?s=payload`, "testnet")).toBe(`/r/${code}?s=payload&net=testnet`);
    expect(withNetParam(`/r/${code}`, "testnet")).toBe(`/r/${code}?net=testnet`);
    expect(withNetParam(`/?s=payload&net=mainnet`, "testnet")).toBe(`/?s=payload&net=testnet`);
  });
  it("explorerTxUrl points each network at its own explorer", () => {
    expect(explorerTxUrl("mainnet", "0xabc")).toBe("https://monadvision.com/tx/0xabc");
    expect(explorerTxUrl("testnet", "0xabc")).toBe("https://testnet.monadexplorer.com/tx/0xabc");
  });
});
