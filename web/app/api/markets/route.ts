import { parseNetParam } from "@/lib/network";
import { markets } from "@/lib/server";

export const revalidate = 3600;

export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    return Response.json({ markets: await markets(parseNetParam(u.searchParams)) });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
