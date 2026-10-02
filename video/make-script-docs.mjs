// Writes docs/portal/frens-{demo,pitch,ad}-script.md from the narration timings and the assembly specs, so the
// published script, the audio and the cut cannot drift apart.
import fs from "node:fs";
const root = new URL("../../../", import.meta.url).pathname;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const screen = {
  demo: {
    room: ["Live room on Monad testnet: four faces on the candles, call record in the header", "demo/ROOMS.md room link; positions read from the Perpl Exchange contract on testnet (web/lib/readPosition.ts)"],
    "tap a fren": ["A fren's card with Call exit and Copy, TP and SL lines on the chart, TP dragged", "web/app/ChartRoom.tsx hover card and drag grips"],
    passkey: ["Copy dialog, passkey created with a name", "Category Labs Mera passkey (web/app/PasskeyWallet.tsx); wallet 0x540DD292BAD1109Fe1D4f335504ee4d98c831277"],
    fund: ["Wallet receives testnet MON and aUSD", "demo/fund.ts, balance shown in the passkey panel: MON 0.15, aUSD 101"],
    copy: ["Perpl account opened with the 100 aUSD minimum deposit, copy sent", "UI text: Perpl's minimum is 100 aUSD; position read back: long 0.001 BTC @ 86,376.1 at block 67,531,587 (demo/read-position.ts)"],
    call: ["bo's call as a dashed take-profit line with bo's face, Accept and Pass", "call link built by demo/make-call.ts, banner: bo suggests a TP at 87,643.0"],
    accept: ["Sign in with the passkey, Accept, Waiting for passkey, then Accepted: your TP is resting on Perpl", "accept tx 0xe01ef0191606c833060462282db99a7b88bbd55f3e023f7790002a36bffdedf2, block 67,520,174, status success"],
    "chain read": ["Card with the receipt, the caller read out of orderDescId, the resting close and the record 1 to 2 taken", "cast receipt (status 1), demo/check-hit.ts printed caller 0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244 TP 87643; header read bo 0 hit / 1 taken before and 2 taken after"],
    share: ["Room link row with Post on X, and the room card it posts", "GET /api/og/<room> on the live site, 1200x630 card"],
    "live on perpl": ["Mainnet switch, Live on Perpl list of traders who opened in the last 6 hours", "web/app/api/live, Exchange 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F on Monad mainnet, read only"],
    end: ["End card", "brand/frens-logo.svg"],
  },
  pitch: {
    problem: ["Group chat, a position posted, 'close at 86k', an order form typed and abandoned, a wall of unattributed calls", "motion scene; position values are cy's real testnet long (size 0.0115, entry 84,887.0)"],
    perpl: ["Mainnet Live on Perpl list", "docs/research-v3/users/traction-raw.md (Perpl 64% of sampled mainnet transactions); web live view"],
    quotes: ["Two public posts, verbatim", "gtm/frens/DEMAND.md: @_maki29_ 2026-09-22, @dracian_me 2026-09-19"],
    intro: ["Name card", "TEAMS.md entry 1: Kamal (kamalbuilds), Track 03"],
    faces: ["Room with faces on the candles", "demo/ROOMS.md"],
    drag: ["A fren's take-profit dragged onto a position", "web/app/ChartRoom.tsx drag grips"],
    accept: ["The call line with the caller's face, then Accept", "same capture as the demo"],
    order: ["Accepted, resting on Perpl", "accept tx 0xe01ef019...dedf2, block 67,520,174"],
    chain: ["Receipt, caller in orderDescId, record 1 to 2 taken", "cast receipt and demo/check-hit.ts, as in the demo"],
    telegram: ["Counter to 10,131 and the three places traders already trade together", "gtm/frens/USERS.md: t.me/perplTradeOfficialtg, 10,131 members, read 2026-10-02"],
    end: ["End card", "brand/frens-logo.svg"],
  },
  ad: {
    hook: ["A chat message, 'close at 86k', becomes a dashed line", "motion scene"],
    "call line": ["The call as a line on the chart with the caller's face", "demo capture"],
    accept: ["Accept", "demo capture"],
    signature: ["Waiting for passkey, then resting on Perpl", "accept tx 0xe01ef019...dedf2"],
    end: ["End card", "brand/frens-logo.svg"],
  },
};
const titles = { demo: "Technical demo (Track 03, max 3:00)", pitch: "Pitch (max 2:00)", ad: "Product ad (max 0:30)" };
for (const k of ["demo", "pitch", "ad"]) {
  const tm = JSON.parse(fs.readFileSync(new URL(`./vo/out-${k}/timings.json`, import.meta.url)));
  const spec = JSON.parse(fs.readFileSync(new URL(`./${k}.spec.json`, import.meta.url)));
  const total = spec.beats.at(-1).t1;
  let md = `# frens ${titles[k]}\n\nRuntime ${mmss(total)} (${total.toFixed(1)} s). Every shown action is a real transaction or read on Monad. File: products/chartroom/video/frens-${k}.mp4, narration track products/chartroom/video/vo/out-${k}/narration.wav.\n\n| Time | Narration | On screen | Source |\n|---|---|---|---|\n`;
  for (const b of spec.beats) {
    const lines = tm.lines.filter((l) => l.start >= b.t0 - 0.3 && l.start < b.t1 - 0.3).map((l) => l.text).join(" ");
    const [on, src] = screen[k][b.name] ?? ["", ""];
    md += `| ${mmss(b.t0)} | ${lines || "(music-free pause)"} | ${on} | ${src} |\n`;
  }
  fs.writeFileSync(`${root}docs/portal/frens-${k}-script.md`, md);
  console.log(`wrote docs/portal/frens-${k}-script.md`);
}
