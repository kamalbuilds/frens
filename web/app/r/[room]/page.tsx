import type { Metadata } from "next";
import { headers } from "next/headers";
import { ChartRoom } from "@/app/ChartRoom";
import { parseNet } from "@/lib/network";
import { encodeNamesParam, parseNamesParam } from "@/lib/names";
import { ogImagePath } from "@/lib/ogcard";
import { encodeCallsParam, parseCallsParam } from "@/lib/receipts";
import { decodeRoom } from "@/lib/roomlink";

type Params = { room: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ net?: string; n?: string; c?: string }>;
}): Promise<Metadata> {
  const { room } = await params;
  const { net, n, c } = await searchParams;
  const network = parseNet(net);
  const count = decodeRoom(room).length;
  const title = count > 0 ? `frens: ${count} traders on one chart` : "frens. Trade perps with your frens.";
  // The card reads the same link the room does: its network, its nicknames and
  // its verified call receipts, so a shared card shows the frens, not short
  // addresses, and counts the calls the room counts.
  const card = ogImagePath(
    room,
    network,
    encodeNamesParam(parseNamesParam(n)),
    encodeCallsParam(parseCallsParam(c)),
  );
  // Absolute card URL: the public front (FRONT_ORIGIN, the static Vercel site that proxies /api here) when
  // set, else the host that served the link. Never localhost, never the proxy's upstream host.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const front = process.env.FRONT_ORIGIN;
  return {
    metadataBase: front ? new URL(front) : host ? new URL(`${proto}://${host}`) : undefined,
    title,
    description: "Every trader in the room, pinned at their entry price on one live Perpl chart.",
    openGraph: { title, description: "Your frens' Perpl positions on one chart. Call their exits, copy their trades.", images: [card] },
    twitter: { card: "summary_large_image", title, description: "Trade perps with your frens.", images: [card] },
  };
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ net?: string; n?: string; c?: string }>;
}) {
  const { room } = await params;
  const { net, n, c } = await searchParams;
  const initialAccounts = decodeRoom(room);
  // Nicknames ride in ?n=, one slot per room address in the same order.
  const initialNames = parseNamesParam(n);
  // Accepted-call receipts ride in ?c=, verified per receipt, never scanned.
  const initialCalls = parseCallsParam(c);
  return <ChartRoom initialAccounts={initialAccounts} initialNames={initialNames} initialCalls={initialCalls} initialView="frens" initialNet={parseNet(net)} />;
}
