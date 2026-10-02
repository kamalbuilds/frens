// Time-driven scene engine: every frame is a pure function of t (seconds since __go()), so a scene replays identically.
let T0 = null;
window.__go = () => { T0 = performance.now(); };
window.__ready = false;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
window.seg = (t, a, b) => clamp((t - a) / (b - a));
window.eo = (x) => 1 - Math.pow(1 - x, 3);
window.eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
window.$ = (s) => document.querySelector(s);
window.CUES = JSON.parse(decodeURIComponent((location.hash || "#%7B%7D").slice(1)));
window.cue = (k, d = 0) => (CUES[k] ?? d);
function loop() {
  if (T0 !== null && window.render) {
    const t = (performance.now() - T0) / 1000;
    window.render(t);
    // slow push-in so a scene that waits on a spoken word never reads as a still
    const d = CUES.drift ?? 0.04;
    if (d) { document.body.style.transformOrigin = "50% 50%"; document.body.style.transform = "scale(" + (1 + d * Math.min(1, t / (CUES.dur ?? 12))) + ")"; }
  }
  requestAnimationFrame(loop);
}
loop();
document.fonts.ready.then(() => { window.__ready = true; });
