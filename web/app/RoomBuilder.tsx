"use client";

/// First-run panel for the bare page with "My frens" selected: rows of
/// [address, name] that fold into a shareable room link. Starts with 3 rows,
/// grows with "+ add fren" up to 12. Addresses validate with viem isAddress,
/// names with sanitizeName; the lib skips invalid rows and dedupes. When the
/// viewer already authorised an injected wallet its address prefills the
/// first row as "me"; a missing, locked or dismissed wallet leaves the rows
/// blank instead of erroring.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import type { Network } from "@/lib/perpl";
import { connect as connectWallet } from "@/lib/wallet";
import {
  MAX_BUILDER_ROWS,
  STARTER_BUILDER_ROWS,
  roomPathForRows,
  type RoomRow,
} from "@/lib/roombuilder";

function blankRows(n: number): RoomRow[] {
  return Array.from({ length: n }, () => ({ address: "", name: "" }));
}

function rowError(row: RoomRow): string | null {
  if (row.address.trim() === "") return null;
  return isAddress(row.address.trim()) ? null : "That is not a usable address.";
}

export function RoomBuilder({ net }: { net: Network }) {
  const router = useRouter();
  const [rows, setRows] = useState<RoomRow[]>(() => blankRows(STARTER_BUILDER_ROWS));
  const [triedCreate, setTriedCreate] = useState(false);
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    connectWallet(net)
      .then((addr) => {
        setRows((cur) => {
          if (cur.length === 0 || cur[0].address.trim() !== "") return cur;
          const next = [...cur];
          next[0] = { address: addr, name: cur[0].name.trim() === "" ? "me" : cur[0].name };
          return next;
        });
      })
      .catch(() => {
        // No wallet, locked, or dismissed prompt: rows stay blank.
      });
  }, [net]);

  const path = useMemo(() => roomPathForRows(rows, net), [rows, net]);
  const usable = useMemo(() => rows.filter((r) => isAddress(r.address.trim())).length, [rows]);

  function setRow(i: number, patch: Partial<RoomRow>) {
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((cur) => (cur.length >= MAX_BUILDER_ROWS ? cur : [...cur, { address: "", name: "" }]));
  }

  function createRoom() {
    const to = roomPathForRows(rows, net);
    if (!to) {
      setTriedCreate(true);
      return;
    }
    router.push(to);
  }

  return (
    <section aria-label="Make a room" className="flex flex-col gap-3 rounded-[10px] border border-edge bg-panel p-4">
      <h3 className="font-[family-name:var(--font-display)] text-[16px] font-bold">
        Make a room for you and your frens
      </h3>
      <p className="text-[13px] text-muted">
        Add up to {MAX_BUILDER_ROWS} Monad addresses. Names are optional and ride along with the link.
      </p>
      <ol className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const err = rowError(row);
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <label htmlFor={`room-addr-${i}`} className="sr-only">
                  Fren {i + 1} address
                </label>
                <input
                  id={`room-addr-${i}`}
                  value={row.address}
                  onChange={(e) => setRow(i, { address: e.target.value })}
                  placeholder="0x…"
                  spellCheck={false}
                  aria-invalid={err !== null}
                  className="num min-w-0 flex-1 rounded-[6px] border border-edge bg-page px-2.5 py-2 text-[12px]"
                />
                <label htmlFor={`room-name-${i}`} className="sr-only">
                  Fren {i + 1} name
                </label>
                <input
                  id={`room-name-${i}`}
                  value={row.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  placeholder="name"
                  spellCheck={false}
                  maxLength={24}
                  aria-label={`Nickname for fren ${i + 1}`}
                  className="w-24 rounded-[6px] border border-edge bg-page px-2.5 py-2 text-[12px]"
                />
              </div>
              {err && <p className="text-[12px] text-loss">{err}</p>}
            </li>
          );
        })}
      </ol>
      {rows.length < MAX_BUILDER_ROWS && (
        <button
          type="button"
          onClick={addRow}
          className="self-start rounded-[6px] border border-edge px-3 py-1.5 text-[13px] font-medium hover:bg-raised active:scale-[0.97]"
        >
          + add fren
        </button>
      )}
      <button
        type="button"
        onClick={createRoom}
        disabled={!path}
        title={path ? `Create a room with ${usable} ${usable === 1 ? "fren" : "frens"}` : "Add at least one usable address"}
        className="rounded-[6px] bg-accent px-3 py-2 text-[13px] font-medium text-page active:scale-[0.97] disabled:opacity-40"
      >
        Create room{usable > 0 ? ` (${usable})` : ""}
      </button>
      {triedCreate && !path && (
        <p className="text-[12px] text-loss">Add at least one usable address to make the room.</p>
      )}
    </section>
  );
}
