// card.mjs SCENE.html '{"title":..}' OUT.png : render a scene (or caption) as a transparent 1920x1080 PNG through the pinned tab.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [, , scene, cues, out, tArg] = process.argv;
const port = execFileSync("bhn", ["deepsurge", "status"], { encoding: "utf8" }).match(/\s(\d{4,5})\s+RUNNING/)[1];
const pin = fs.readFileSync(`${process.env.HOME}/.cache/qa-tab-video`, "utf8").trim();
const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.id === pin);
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1.2, mobile: false });
await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
const url = `file://${new URL("./scenes/" + scene, import.meta.url).pathname}#${encodeURIComponent(cues)}`;
await send("Page.navigate", { url }); await sleep(1200);
await send("Page.reload"); await sleep(1500);
for (let i = 0; i < 30; i++) { const r = await send("Runtime.evaluate", { expression: "window.__ready===true", returnByValue: true }); if (r.result.result.value) break; await sleep(200); }
if (tArg) await send("Runtime.evaluate", { expression: `window.render(${Number(tArg)})` });
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
await send("Emulation.setDefaultBackgroundColorOverride", {});
ws.close(); console.log(out);
