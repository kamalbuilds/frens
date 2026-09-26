# DESIGN.md · Chartroom

Binding for every UI change in this app. Chosen 2026-09-24 through ui-craft + Hallmark.
Stamp: `/* Hallmark · macrostructure: 05 Workbench · theme: Graph paper */` at the top of app/globals.css.

## Identity
- Macrostructure: 05 Workbench
- Theme: Graph paper
- Surface: `#F3EFE6` · Ink: `#1C1B19` · Accent (one): `#2F5BEA`
- Friend hues, one per trader, used only for their chip, avatar, entry line and TP/SL: #E8553D #D9A21B #149C8F #8B3F9E #5B7F2A. The accent #2F5BEA is never a candle or a person: it is reserved for the viewer's own actions (last-price pill, focus rings, active timeframe).
- Display font: Space Grotesk · Body font: IBM Plex Sans · Numbers: IBM Plex Mono, tabular figures everywhere
- Radius: 6px on controls, 0 on documents and charts

## Chart rules
- Grid near zero: rgba(28, 27, 25, 0.03) for both axes.
- Candles: up filled #DCEEDD, down filled #F6DCD3, borders and wicks ink #1C1B19 on both.
- Last price: dotted price line with a solid accent pill and surface text.
- Volume footer strip inside the same pane, about 14% of chart height: a HistogramSeries on its own priceScaleId with scaleMargins top 0.86, bars in the candle washes (#DCEEDD up, #F6DCD3 down), axis hidden, with a small "Volume" plus value label top-left of the strip. Volume comes from the candles API field v.
- OHLC plus change readout line above the chart, live on crosshair move, resting on the last candle, IBM Plex Mono.
- Friend markers: a 22px circle in the friend's hue with a 1px surface ring sits ON the chart at (entryTime, entryPrice), printing the 2-letter head of the shortName in surface text. Null entryTime falls back to the last candle. Overlapping avatars nudge apart with stackChips. The right-edge chip rail stays.
- TP/SL price lines take the selected friend's hue with filled axis pills (surface text): TP solid, SL dashed, each with a visible 10px grip circle at its left end for dragging and arrow-key nudging.
- The inspected friend gets a PnL band from entry to mark in the gain/loss wash; the active friend's band adds a 45deg repeating-linear-gradient hatch in their hue.
- Room summary: one horizontal bar above the chart splitting long vs short count in --gain vs --loss.
- Copy: every on-chart avatar and chip carries a Copy affordance (icon at rest, label on hover/focus, 44px tap target on touch) opening a confirm popover (market, side, your size, max slippage default 50 bps) that signs through the viewer's own wallet. Never hold keys.
- Motion: markers and the last-price pill ease over 120ms, transform and opacity only, disabled under prefers-reduced-motion.
- The chart library cannot parse CSS color-mix: every chart option uses concrete hex or rgba values.
## Tokens (CSS custom properties in app/globals.css)
`--surface: #F3EFE6; --ink: #1C1B19; --accent: #2F5BEA;` plus `--muted` (ink at 62% mix with surface) and `--rule` (ink at 14%).
Type scale (px): 12 · 14 · 16 · 20 · 28 · 40 · 64 · 96. Line-height 1.5 body, 1.1 display.
Spacing scale (px): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112.

## Rules
- One accent. No gradients, no glassmorphism, no emoji, no three equal feature cards, no centered hero + three cards + CTA.
- Numbers come from the chain or a named measured source, with the source in small text. Never invented.
- Every fetch has loading, empty and error states. No horizontal scroll at 375px. Visible focus rings.
- Motion: transform and opacity only, prefers-reduced-motion respected, no transition-all.
- No em dashes in visible copy. No "Seamless", "Elevate", "Unleash", "Revolutionize".
