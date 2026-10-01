import { ChartRoom } from "./ChartRoom";
import { parseNet } from "@/lib/network";

export default async function Page({ searchParams }: { searchParams: Promise<{ net?: string }> }) {
  const { net } = await searchParams;
  return <ChartRoom initialNet={parseNet(net)} />;
}
