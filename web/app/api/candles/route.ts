import { scaleCandle, type RawCandle } from "@/lib/chart";
import { markets } from "@/lib/server";

const RESOLUTIONS = new Set([900, 3600, 14400, 86400]);

export async function GET(req: Request) {
  const u = new URL(req.url);
  const market = Number(u.searchParams.get("market"));
  const res = Number(u.searchParams.get("res") ?? 3600);
  if (!RESOLUTIONS.has(res)) return Response.json({ error: `unsupported resolution ${res}` }, { status: 400 });
  try {
    const m = (await markets()).find((x) => x.id === market);
    if (!m) return Response.json({ error: `unknown market ${market}` }, { status: 404 });
    const to = Date.now();
    const from = to - res * 1000 * 300;
    const r = await fetch(`https://app.perpl.xyz/api/v1/market-data/${market}/candles/${res}/${from}-${to}`, { cache: "no-store" });
    if (!r.ok) return Response.json({ error: `Perpl candles returned ${r.status}` }, { status: 502 });
    const body = (await r.json()) as { d: RawCandle[]; at?: { b: number } };
    return Response.json({
      market: m,
      block: body.at?.b ?? null,
      candles: body.d.map((c) => scaleCandle(c, m.priceDecimals)),
    });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
