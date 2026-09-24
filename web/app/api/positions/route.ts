import { isAddress, type Address } from "viem";
import { readPosition } from "@/lib/readPosition";
import { blockTime, client } from "@/lib/server";
import room from "@/lib/room.json";

const DEFAULT_ROOM = Array.from(new Set((room.positions as { account: string }[]).map((p) => p.account)));

export async function GET(req: Request) {
  const u = new URL(req.url);
  const market = Number(u.searchParams.get("market"));
  const extra = (u.searchParams.get("accounts") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = extra.filter((a) => !isAddress(a));
  if (bad.length) return Response.json({ error: `not an address: ${bad.join(", ")}` }, { status: 400 });
  const accounts = Array.from(new Set([...DEFAULT_ROOM, ...extra].map((a) => a.toLowerCase())));
  try {
    const block = await client.getBlockNumber();
    const read = await Promise.all(
      accounts.map(async (a) => {
        const p = await readPosition(a as Address, market, { client, blockNumber: block });
        if (!p) return null;
        return {
          account: p.account,
          side: p.side,
          size: p.size,
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          unrealizedPnl: p.unrealizedPnl,
          fundingPnl: p.fundingPnl,
          entryBlock: p.entryBlock.toString(),
          entryTime: await blockTime(p.entryBlock),
        };
      }),
    );
    return Response.json({ block: block.toString(), checked: accounts.length, friends: read.filter(Boolean) });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
