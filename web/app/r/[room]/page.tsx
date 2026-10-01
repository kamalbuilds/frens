import type { Metadata } from "next";
import { ChartRoom } from "@/app/ChartRoom";
import { decodeRoom } from "@/lib/roomlink";

type Params = { room: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { room } = await params;
  const n = decodeRoom(room).length;
  const title = n > 0 ? `Cosign: ${n} traders on one chart` : "Cosign. Your friends call the exit. You sign it.";
  return {
    title,
    description: "Every trader in the room, pinned at their entry price on one live Perpl chart.",
    openGraph: { title, description: "A Cosign room. Every friend's position on one chart, and their calls on yours.", images: [`/api/og/${room}`] },
    twitter: { card: "summary_large_image", title, description: "A Cosign room.", images: [`/api/og/${room}`] },
  };
}

export default async function RoomPage({ params }: { params: Promise<Params> }) {
  const { room } = await params;
  const initialAccounts = decodeRoom(room);
  return <ChartRoom initialAccounts={initialAccounts} />;
}
