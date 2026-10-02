"use client";
// Static-hosting entry: the room code and params come from the URL in the browser, so the page needs no
// server. Used only by scripts/build-static.sh (output: "export"); the mini serves app/r/[room] directly.
import { useEffect, useState } from "react";
import { ChartRoom } from "./ChartRoom";
import { parseNet } from "@/lib/network";
import { parseNamesParam } from "@/lib/names";
import { parseCallsParam } from "@/lib/receipts";
import { decodeRoom } from "@/lib/roomlink";

type Props = Parameters<typeof ChartRoom>[0];

export function StaticShell() {
  const [props, setProps] = useState<Props | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const room = window.location.pathname.match(/^\/r\/([^/]+)/)?.[1];
    const net = parseNet(q.get("net") ?? undefined);
    setProps(
      room
        ? {
            initialAccounts: decodeRoom(decodeURIComponent(room)),
            initialNames: parseNamesParam(q.get("n") ?? undefined),
            initialCalls: parseCallsParam(q.get("c")),
            initialView: "frens",
            initialNet: net,
          }
        : { initialNet: net },
    );
  }, []);
  return props ? <ChartRoom {...props} /> : null;
}
