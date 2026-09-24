import type { Metadata } from "next";
import { ChartRoom } from "@/app/ChartRoom";
import { decodeRoom } from "@/lib/roomlink";

type Params = { room: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { room } = await params;
  const n = decodeRoom(room).length;
  const title = n > 0 ? `Chartroom: ${n} traders on one chart` : "Chartroom. Your friends, on the chart.";
  return {
    title,
    description: "Every trader in the room, pinned at their entry price on one live Perpl chart.",
    openGraph: { title, description: "A shared Chartroom. Open it to see every entry on one chart.", images: [`/api/og/${room}`] },
    twitter: { card: "summary_large_image", title, description: "A shared Chartroom.", images: [`/api/og/${room}`] },
  };
}

export default async function RoomPage({ params }: { params: Promise<Params> }) {
  const { room } = await params;
  const initialAccounts = decodeRoom(room);
  return <ChartRoom initialAccounts={initialAccounts} />;
}
