import { getLiveTraders } from "@/lib/live";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const market = Number(u.searchParams.get("market"));
  if (!Number.isInteger(market) || market < 0) {
    return Response.json({ error: `unknown market ${u.searchParams.get("market")}` }, { status: 400 });
  }
  try {
    const { block, hours, traders } = await getLiveTraders(market, u.searchParams.get("hours"));
    return Response.json({ market, hours, block, traders });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
