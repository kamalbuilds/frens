# DESIGN.md · frens

Binding for every UI change in this app. Chosen 2026-10-01: dark room, faces on the chart.
Stamp: `/* Hallmark · macrostructure: 05 Workbench · theme: Fren dark */` at the top of app/globals.css.

## Identity
- Macrostructure: 05 Workbench
- Theme: Fren dark
- Page: `#0A0A0F` · Panel: `#13131A` · Raised: `#1B1B24` · Border: `#26263A` · Grid: `rgba(255, 255, 255, 0.04)`
- Text: `#ECECF1` · Muted: `#8B8B9E`
- Candles: up filled `#2BD67B`, down filled `#FF6B57`, bodies filled with wicks in the same hue
- Brand accent (one): `#C8FF3D`, reserved for the viewer's own actions (Accept, Copy, Add fren, primary buttons). Never a candle, never a person.
- Side colours, the only colours people ever wear: long `#2BD67B`, short `#FF6B57`, as a 2px face ring, entry line and TP/SL.
- Display font: Space Grotesk · Body font: IBM Plex Sans · Numbers: IBM Plex Mono, tabular figures everywhere
- Radius: 10px on cards and panels, 6px on controls
- Header: "frens" wordmark (Space Grotesk, 22px, bold), tagline "Trade perps with your frens." in muted.

## Chart rules
- Grid near zero: rgba(255, 255, 255, 0.04) for both axes. No graph-paper background.
- Candles: up filled #2BD67B, down filled #FF6B57, borders and wicks the same hue on both.
- Last price: dotted price line with a solid accent pill. The one accent on the chart, reserved for the viewer's own price.
- Volume footer strip inside the same pane, about 14% of chart height: a HistogramSeries on its own priceScaleId with scaleMargins top 0.86, bars in the candle fills (#2BD67B up, #FF6B57 down), axis hidden, with a small "Volume" plus value label top-left of the strip. Volume comes from the candles API field v.
- OHLC plus change readout line above the chart, live on crosshair move, resting on the last candle, IBM Plex Mono.
- Friend faces: a 28px boring-avatars "beam" circle seeded by the address sits ON the chart at (entryTime, entryPrice), with a 2px ring in the side colour and a 2px page outline. Null entryTime falls back to the last candle. placeAvatar still decides on-candle vs edge: entries outside the visible range pin to the edge with the face plus an arrow and the entry price. Faces within 14px cluster with a -10px overlap offset; more than 5 in one cluster collapse into a "+N" circle. No text tag stacks on the chart: faces replace them.
- Hover card (#1B1B24, 240px, radius 10): face, short address, LONG/SHORT pill, size, entry, live signed coloured PnL, plus "Call exit" (selects the fren and shows their TP/SL drag lines) and "Copy" (opens the copy popover).
- Click a face: select that fren and dim the others to 35%.
- TP/SL price lines take the selected fren's side colour with filled axis pills (page text): TP solid, SL dashed, each with a visible 10px grip circle at its left end for dragging and arrow-key nudging.
- The ghost call line keeps the caller's face at its left end: dashed in the suggested side's colour at 60% opacity, solid accent once accepted.
- The inspected friend gets a PnL band from entry to mark in the gain/loss fill at low opacity.
- Room summary: one horizontal bar above the chart splitting long vs short count in gain vs loss.
- Copy: the hover card carries a Copy button opening a confirm popover (market, side, your size, max slippage default 50 bps) that signs through the viewer's own wallet. Never hold keys.
- Motion: faces and the last-price pill ease over 120ms, transform and opacity only, disabled under prefers-reduced-motion.
- The chart library cannot parse CSS color-mix: every chart option uses concrete hex or rgba values.
## Tokens (CSS custom properties in app/globals.css)
`--page: #0A0A0F; --panel: #13131A; --raised: #1B1B24; --edge: #26263A; --ink: #ECECF1; --muted: #8B8B9E; --accent: #C8FF3D; --gain: #2BD67B; --loss: #FF6B57;` plus `--grid` rgba(255, 255, 255, 0.04).
Type scale (px): 12 · 14 · 16 · 20 · 28 · 40 · 64 · 96. Line-height 1.5 body, 1.1 display.
Spacing scale (px): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112.

## Rail rules
- Dark cards (#13131A, radius 10): face, short address, side pill, PnL. Selected card takes the accent border.
- The suggestion banner, passkey and wallet flows keep working, restyled dark.

## Rules
- One accent. No gradients, no glassmorphism, no emoji, no gold rings, no walls of avatars, no trade tables under the chart, no buy/sell box, no three equal feature cards, no centered hero + three cards + CTA.
- Numbers come from the chain or a named measured source, with the source in small text. Never invented.
- Every fetch has loading, empty and error states. No horizontal scroll at 375px. Visible focus rings.
- Motion: transform and opacity only, prefers-reduced-motion respected, no transition-all.
- No em dashes in visible copy. No "Seamless", "Elevate", "Unleash", "Revolutionize".
