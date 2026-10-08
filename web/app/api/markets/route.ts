import { parseNetParam } from "@/lib/network";
import { markets } from "@/lib/server";

export const revalidate = 3600;

export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    return Response.json({ markets: await markets(parseNetParam(u.searchParams)) });
  } catch {
    return Response.json({ error: "markets unavailable" }, { status: 502 });
  }
}
