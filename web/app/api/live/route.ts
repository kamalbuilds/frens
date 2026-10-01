import { getLiveTraders } from "@/lib/live";
import { parseNetParam } from "@/lib/network";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const market = Number(u.searchParams.get("market"));
  if (!Number.isInteger(market) || market < 0) {
    return Response.json({ error: `unknown market ${u.searchParams.get("market")}` }, { status: 400 });
  }
  try {
    const { block, hours, traders } = await getLiveTraders(market, u.searchParams.get("hours"), parseNetParam(u.searchParams));
    // Cold reads page ~72 getLogs chunks (10-20 s); the CDN serves the last list while it refreshes.
    return Response.json({ market, hours, block, traders }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=900" } });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
