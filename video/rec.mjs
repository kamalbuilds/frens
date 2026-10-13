// rec.mjs URL STEPS.json OUTDIR : drive ONE pinned deepsurge tab (PIN_FILE) through scripted steps and
// record it with CDP screencast, so only that tab's pixels are captured (no screen bleed).
// Each {rec:"name"} ... {rec:false} pair writes OUTDIR/name/*.jpg frames + frames.txt (concat list with real durations)
// + marks.json (label -> seconds from clip start).
// Steps: wait | goto | goto_var | goto_file | sh (as) | eval (as) | waitFor | click | clickSel | move | hover |
//        type | key | mark | shot | rec | scroll.  ${var} is interpolated in goto, sh, eval, type.
import fs from "node:fs";
import { execFileSync, execSync } from "node:child_process";
const [, , url, stepsFile, out] = process.argv;
const port = process.env.CDP_PORT ?? execFileSync("bhn", ["deepsurge", "status"], { encoding: "utf8", timeout: 8000 }).match(/\s(\d{4,5})\s+RUNNING/)[1];
const base = `http://127.0.0.1:${port}`;
const pinFile = process.env.PIN_FILE ?? `${process.env.HOME}/.cache/qa-tab-video`;
const W = Number(process.env.W ?? 1600), H = Number(process.env.H ?? 900), DSF = Number(process.env.DSF ?? 1.2);
const pages = (await (await fetch(`${base}/json/list`)).json()).filter((t) => t.type === "page");
const pinned = fs.existsSync(pinFile) ? fs.readFileSync(pinFile, "utf8").trim() : "";
let tab = pages.find((t) => t.id === pinned);
if (!tab) {
  tab = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  fs.writeFileSync(pinFile, tab.id);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; const handlers = {};
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else if (d.method && handlers[d.method]) handlers[d.method](d.params);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "EXC:" + r.result.exceptionDetails.text; return r.result?.result?.value; };
const vars = {};
const sub = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// Cursor overlay: CDP mouse events fire real DOM events, so a div following mousemove shows up in the screencast.
const CURSOR = `(()=>{if(window.__cur)return;const mk=()=>{if(!document.body)return setTimeout(mk,50);
const c=document.createElement('div');c.id='__cur';c.style.cssText='position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))';
c.innerHTML='<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17.5 L13.5 25 L17 23.5 L13.5 16.5 L20 16.5 Z" fill="#ECECF1" stroke="#0A0A0F" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const r=document.createElement('div');r.id='__ring';r.style.cssText='position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #C8FF3D;z-index:2147483646;pointer-events:none;opacity:0;transform:translate(-100px,-100px)';
document.body.append(r,c);window.__cur=c;
addEventListener('mousemove',e=>{c.style.transform='translate('+(e.clientX-5)+'px,'+(e.clientY-3)+'px)'},true);
addEventListener('mousedown',e=>{r.style.transform='translate('+e.clientX+'px,'+e.clientY+'px) scale(.5)';r.style.opacity='1';r.style.transition='none';requestAnimationFrame(()=>{r.style.transition='transform .35s ease-out,opacity .35s ease-out';r.style.transform='translate('+e.clientX+'px,'+e.clientY+'px) scale(1.25)';r.style.opacity='0'})},true)};mk()})()`;

const applyMetrics = () => send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DSF, mobile: false });
let mx = 800, my = 450;
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, ...extra });
async function glide(x, y, ms = 700) {
  const n = Math.max(8, Math.round(ms / 16)), x0 = mx, y0 = my;
  for (let k = 1; k <= n; k++) {
    const t = k / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await mouse("mouseMoved", x0 + (x - x0) * e, y0 + (y - y0) * e);
    await sleep(16);
  }
  mx = x; my = y;
}
const rectOf = (finder) => ev(`(()=>{const el=(${finder});if(!el)return null;el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height})})()`);
async function clickAt(x, y) { await send("Page.bringToFront"); await applyMetrics(); await glide(x, y); await sleep(120); await mouse("mousePressed", x, y); await sleep(70); await mouse("mouseReleased", x, y); }

let clip = null;
let healing = false;
handlers["Page.screencastFrame"] = (p) => {
  send("Page.screencastFrameAck", { sessionId: p.sessionId });
  if (!clip) return;
  if (p.metadata.deviceWidth !== W || p.metadata.deviceHeight !== H) { if (!healing) { healing = true; applyMetrics().finally(() => setTimeout(() => (healing = false), 300)); } return; }
  const f = `${clip.dir}/f${String(clip.frames.length).padStart(6, "0")}.jpg`;
  fs.writeFileSync(f, Buffer.from(p.data, "base64"));
  clip.frames.push({ f, ts: p.metadata.timestamp, dw: p.metadata.deviceWidth, dh: p.metadata.deviceHeight, ps: p.metadata.pageScaleFactor, ot: p.metadata.offsetTop });
};
async function startRec(name) {
  const dir = `${out}/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  clip = { name, dir, frames: [], marks: {}, t0: Date.now() / 1000 };
  await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: Math.round(W * DSF), maxHeight: Math.round(H * DSF), everyNthFrame: 1 });
}
async function stopRec() {
  const stopT = Date.now() / 1000;
  await sleep(400);
  await send("Page.stopScreencast");
  const { dir, frames, marks, name } = clip; clip = null;
  if (!frames.length) { console.error("NO FRAMES in " + name); return; }
  const t0 = frames[0].ts, end = Math.max(frames[frames.length - 1].ts + 0.1, stopT);
  let list = "";
  frames.forEach((fr, i) => { const d = (i + 1 < frames.length ? frames[i + 1].ts : end) - fr.ts; list += `file '${fr.f.split("/").pop()}'\nduration ${Math.max(d, 0.001).toFixed(4)}\n`; });
  list += `file '${frames[frames.length - 1].f.split("/").pop()}'\n`;
  fs.writeFileSync(`${dir}/frames.txt`, list);
  if (process.env.NOCURSOR && frames.length / (end - t0) < 20) console.error(`WARNING ${name}: only ${(frames.length / (end - t0)).toFixed(1)} fps captured`);
  const m = {}; for (const [k, v] of Object.entries(marks)) m[k] = +(v - t0).toFixed(2);
  const odd = frames.filter((x) => x.dw !== W || x.dh !== H || x.ps !== 1 || x.ot !== 0).length;
  fs.writeFileSync(`${dir}/marks.json`, JSON.stringify({ duration: +(end - t0).toFixed(2), frames: frames.length, oddFrames: odd, marks: m }, null, 1));
  if (odd) { const o = frames.find((x) => x.dw !== W || x.dh !== H || x.ps !== 1 || x.ot !== 0); console.error(`WARNING ${name}: ${odd} frames with a non-standard viewport, first at frame ${frames.indexOf(o)}: dw=${o.dw} dh=${o.dh} ps=${o.ps} ot=${o.ot}`); }
  execSync(`cd ${dir} && ffmpeg -y -loglevel error -f concat -safe 0 -i frames.txt -vf "fps=30,scale=${process.env.OUT_W ?? 1920}:${process.env.OUT_H ?? 1080}:flags=lanczos,format=yuv420p" -c:v libx264 -crf 17 -preset medium ../${name}.mp4`);
  console.error(`CLIP ${name}: ${frames.length} frames, ${(end - t0).toFixed(1)}s`);
}

try {
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await applyMetrics();
  await send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 0 });
  await send("Page.enable");
  await send("Page.bringToFront");
  if (process.env.VAUTH === "1") {
    await send("WebAuthn.enable", { enableUI: false });
    await send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
  }
  if (process.env.PRELOAD) await send("Page.addScriptToEvaluateOnNewDocument", { source: process.env.PRELOAD });
  if (!process.env.NOCURSOR) await send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR });
  await send("Page.navigate", { url });
  await sleep(Number(process.env.LOAD_MS ?? 9000));
  await applyMetrics();
  if (!process.env.NOCURSOR) await ev(CURSOR);
  const log = [];
  for (const s of JSON.parse(fs.readFileSync(stepsFile, "utf8"))) {
    if (s.wait) await sleep(s.wait);
    if (s.metrics) await applyMetrics();
    if ("rec" in s) { if (s.rec) await startRec(s.rec); else await stopRec(); }
    if (s.mark && clip) clip.marks[s.mark] = Date.now() / 1000;
    if (s.goto) { await send("Page.navigate", { url: sub(s.goto) }); await sleep(s.load ?? 6000); await applyMetrics(); if (!process.env.NOCURSOR) await ev(CURSOR); }
    if (s.goto_file) { for (let i = 0; i < 120 && !fs.existsSync(s.goto_file); i++) await sleep(1000); await send("Page.navigate", { url: fs.readFileSync(s.goto_file, "utf8").trim() }); await sleep(s.load ?? 6000); await applyMetrics(); if (!process.env.NOCURSOR) await ev(CURSOR); }
    if (s.sh) { const r = execSync(sub(s.sh), { encoding: "utf8", shell: "/bin/zsh", cwd: s.cwd ?? process.cwd(), env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` }, timeout: s.timeout ?? 180000 }).trim(); if (s.as) vars[s.as] = r.split("\n").pop(); log.push({ sh: s.sh.slice(0, 50), out: r.slice(-300) }); }
    if (s.eval) { const v = await ev(sub(s.eval)); if (s.as) vars[s.as] = v; log.push({ eval: s.eval.slice(0, 60), value: v }); }
    if (s.waitFor) { let ok = false; const to = Date.now() + (s.timeout ?? 60000); while (Date.now() < to) { if (await ev(s.waitFor)) { ok = true; break; } await sleep(400); } log.push({ waitFor: s.waitFor.slice(0, 70), ok }); if (!ok && !s.soft) throw new Error("waitFor timed out: " + s.waitFor); }
    if (s.click) {
      const finder = `[...document.querySelectorAll('button,a,[role=button]')].find(b=>b.offsetParent&&${s.exact ? `b.innerText.trim()===${JSON.stringify(s.click)}` : `b.innerText.trim().startsWith(${JSON.stringify(s.click)})`})`;
      let ok = false;
      for (let tries = 0; tries < 3 && !ok; tries++) {
        const r = await rectOf(finder);
        if (!r) { await sleep(800); continue; }
        const p = JSON.parse(r); await clickAt(p.x, p.y);
        if (!s.until) { ok = true; break; }
        const to = Date.now() + 3500; while (Date.now() < to) { if (await ev(s.until)) { ok = true; break; } await sleep(250); }
      }
      log.push({ click: s.click, ok });
      if (!ok && !s.soft) throw new Error("click failed: " + s.click);
    }
    if (s.clickSel) { const r = await rectOf(`document.querySelector(${JSON.stringify(s.clickSel)})`); if (!r) { if (!s.soft) throw new Error("no el: " + s.clickSel); } else { const p = JSON.parse(r); await clickAt(p.x, p.y); log.push({ clickSel: s.clickSel }); } }
    if (s.dragSel || s.dragAt) {
      const r = s.dragAt ? JSON.stringify({ x: s.dragAt[0], y: s.dragAt[1] }) : await rectOf(`document.querySelector(${JSON.stringify(s.dragSel)})`);
      if (!r) { if (!s.soft) throw new Error("no grip: " + s.dragSel); } else {
        const p = JSON.parse(r); if (s.dragX) p.x = s.dragX; if (s.dragDx) p.x += s.dragDx; await send("Page.bringToFront"); await applyMetrics(); await glide(p.x, p.y, 800); await sleep(250);
        await mouse("mousePressed", p.x, p.y); await sleep(120);
        const n = Math.round((s.ms ?? 1400) / 20), y1 = p.y + (s.dy ?? -60), x1 = p.x + (s.dx ?? 0);
        for (let k = 1; k <= n; k++) { const t = k / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + (x1 - p.x) * e, y: p.y + (y1 - p.y) * e, button: "left", buttons: 1 }); await sleep(16); }
        await sleep(200); await mouse("mouseReleased", x1, y1); mx = x1; my = y1; log.push({ dragSel: s.dragSel });
      }
    }
    if (s.typeInto) {
      let okv = false;
      for (let tries = 0; tries < 4 && !okv; tries++) {
        const r = await rectOf(`document.querySelector(${JSON.stringify(s.typeInto)})`);
        if (!r) { await sleep(600); continue; }
        const p = JSON.parse(r); await clickAt(p.x, p.y); await sleep(300);
        await ev(`(()=>{const e=document.querySelector(${JSON.stringify(s.typeInto)});e.focus();e.select&&e.select();return 1})()`);
        for (const ch of s.text) { await send("Input.insertText", { text: ch }); await sleep(110); }
        await sleep(250);
        okv = (await ev(`document.querySelector(${JSON.stringify(s.typeInto)}).value`)) === s.text;
      }
      log.push({ typeInto: s.typeInto, ok: okv });
      if (!okv && !s.soft) throw new Error("typeInto failed: " + s.typeInto);
    }
    if (s.hoverSel) { const r = await rectOf(`document.querySelector(${JSON.stringify(s.hoverSel)})`); if (r) { const p = JSON.parse(r); await glide(p.x, p.y); log.push({ hoverSel: s.hoverSel }); } else if (!s.soft) throw new Error("no el: " + s.hoverSel); }
    if (s.move) await glide(s.move[0], s.move[1], s.ms ?? 700);
    if (s.type) { const t = sub(s.type); if (s.slow) { for (const ch of t) { await send("Input.insertText", { text: ch }); await sleep(110); } } else await send("Input.insertText", { text: t }); }
    if (s.key) { const enter = s.key === "Enter" ? { windowsVirtualKeyCode: 13, text: "\r" } : {}; await send("Input.dispatchKeyEvent", { type: "keyDown", key: s.key, code: s.key, ...enter }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: s.key, code: s.key, ...enter }); }
    if (s.scroll) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: mx, y: my, deltaX: 0, deltaY: s.scroll }); }
    if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${s.shot}.png`, Buffer.from(r.result.data, "base64")); log.push({ shot: s.shot }); }
    console.error("STEP " + JSON.stringify(log[log.length - 1] ?? s).slice(0, 160) + " VP=" + (await ev("[innerWidth,devicePixelRatio,visualViewport.scale,document.documentElement.scrollWidth].join()")));
    if (s.after) await sleep(s.after);
  }
  if (clip) await stopRec();
  console.log(JSON.stringify({ vars, log }, null, 1));
} finally {
  if (clip) await stopRec().catch(() => {});
  ws.close();
}
