import { describe, expect, it } from "bun:test";
import { GET, POST } from "./[...path]/route";

const ask = (method: typeof GET, path: string[]) => method(new Request(`http://x/api/perpl/${path.join("/")}`), { params: Promise.resolve({ path }) });

describe("perpl relay", () => {
  it("does not relay mainnet, withdrawals or unknown paths", async () => {
    for (const path of [["mainnet", "v1", "trading", "orders"], ["testnet", "v1", "trading", "withdraw"], ["testnet", "v1", "api-key", "payload", "x"], ["testnet"]]) {
      expect((await ask(GET, path)).status).toBe(404);
      expect((await ask(POST, path)).status).toBe(404);
    }
  });

  it("relays an allowed public path to testnet.perpl.xyz", async () => {
    const res = await ask(GET, ["testnet", "v1", "pub", "context"]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { markets: unknown[] }).markets.length).toBeGreaterThan(0);
  });
});
