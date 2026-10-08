import { getLiveTraders } from "@/lib/live";
import { parseNetParam } from "@/lib/network";
import { markets } from "@/lib/server";

// Testnet's 100-block log cap makes a cold 24-hour scan exceed 60 seconds.
export const maxDuration = 300;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const market = Number(u.searchParams.get("market"));
  if (!Number.isInteger(market) || market < 0) {
    return Response.json({ error: `unknown market ${u.searchParams.get("market")}` }, { status: 400 });
  }
  const net = parseNetParam(u.searchParams);
  try {
    if (!(await markets(net)).some((m) => m.id === market)) {
      return Response.json({ error: `unknown market ${market} on ${net}` }, { status: 404 });
    }
    const { block, hours, traders } = await getLiveTraders(market, u.searchParams.get("hours"), net);
    // Cold reads page ~72 getLogs chunks (10-20 s); the CDN serves the last list while it refreshes.
    return Response.json({ market, hours, block, traders }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=900" } });
  } catch {
    return Response.json({ error: "live traders unavailable" }, { status: 502 });
  }
}
