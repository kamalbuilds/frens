// Prints the demo room URL with one extra fren added (and an optional call payload):
//   bun run video/room-url.ts <address> <name> [s payload]
import fs from "node:fs";
import { decodeRoom, encodeRoom } from "../web/lib/roomlink";

const [addr, name, s] = process.argv.slice(2);
if (!/^0x[0-9a-fA-F]{40}$/.test(addr ?? "") || !name) throw new Error("usage: room-url.ts <address> <name> [s]");
const base = new URL(fs.readFileSync(new URL("./work/room.txt", import.meta.url), "utf8").trim());
const code = base.pathname.split("/").pop()!;
const members = decodeRoom(code);
if (!members.length) throw new Error("room code did not decode");
const names = (base.searchParams.get("n") ?? "").split(",").filter(Boolean);
names.push(`${addr.slice(2, 6).toLowerCase()}:${name}`);
const u = new URL(`${base.origin}/r/${encodeRoom([...members, addr])}`);
u.searchParams.set("net", "testnet");
u.searchParams.set("n", names.join(","));
const c = base.searchParams.get("c");
if (c) u.searchParams.set("c", c);
if (s) u.searchParams.set("s", s);
console.log(u.toString().replace(/%2C/g, ",").replace(/%3A/g, ":"));
