import { markets } from "@/lib/server";

export const revalidate = 3600;

export async function GET() {
  try {
    return Response.json({ markets: await markets() });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
