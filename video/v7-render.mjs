// v7-render.mjs : deterministic frame render of the two v7 mechanism scenes through a throwaway deepsurge tab.
// mech3.html at tau=k/30 (retimed to the narration) -> work/v7/mech3/f%04d.png ; mech2.html frozen at its MISSED state -> work/v7/card/f%04d.png
// Run under: lockf -t 600 /tmp/deepsurge-rec.lock node v7-render.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const port = execFileSync("bhn", ["deepsurge", "status"], { encoding: "utf8" }).match(/\s(\d{4,5})\s+RUNNING/)[1];
const base = `http://127.0.0.1:${port}`;
const tab = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
const FPS = 30, LEN = 10.231084, CARD = 2.709854;
try {
  await send("Page.enable"); await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1.2, mobile: false });
  const open = async (scene) => {
    await send("Page.navigate", { url: `file://${new URL("./scenes/" + scene, import.meta.url).pathname}#${encodeURIComponent("{}")}` }); await sleep(1500);
    await send("Page.reload"); await sleep(1500);
    for (let i = 0; i < 30 && !(await ev("window.__ready===true")); i++) await sleep(200);
    if (!(await ev("typeof window.render==='function'"))) throw new Error(scene + " has no render");
  };
  const drift = (tau) => `document.body.style.transformOrigin='50% 50%';document.body.style.transform='scale('+(1+0.04*Math.min(1,${tau}/12))+')'`;
  const shoot = async (dir, k, js) => {
    await ev(js); await sleep(30);
    const s = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(`${dir}/f${String(k).padStart(4, "0")}.png`, Buffer.from(s.result.data, "base64"));
  };
  fs.mkdirSync("work/v7/mech3", { recursive: true }); fs.mkdirSync("work/v7/card", { recursive: true });
  if (process.env.ONLY !== "card") await open("mech3.html");
  const n1 = Math.ceil(LEN * FPS);
  if (process.env.ONLY !== "card") for (let k = 0; k < n1; k++) await shoot("work/v7/mech3", k, `window.render(${k / FPS});${drift(k / FPS)}`);
  await open("mech2.html");
  const n2 = Math.ceil(CARD * FPS) + 1;
  for (let k = 0; k < n2; k++) await shoot("work/v7/card", k, `window.render(11.05);const c=document.querySelector('#state');c.textContent='earlier pick: 85,195 · missed';c.style.color='#FF6B57';c.style.borderColor='#FF6B57';${drift(LEN + k / FPS)}`);
  console.log(JSON.stringify({ mech3: n1, card: n2 }));
} finally { ws.close(); await fetch(`${base}/json/close/${tab.id}`); }
