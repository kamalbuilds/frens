# DESIGN.md · Chartroom

Binding for every UI change in this app. Chosen 2026-09-24 through ui-craft + Hallmark.
Stamp: `/* Hallmark · macrostructure: 05 Workbench · theme: Graph paper */` at the top of app/globals.css.

## Identity
- Macrostructure: 05 Workbench
- Theme: Graph paper
- Surface: `#F3EFE6` · Ink: `#1C1B19` · Accent (one): `#2F5BEA`
- Friend hues, one per trader, used only for their chip and line: #E8553D #2F5BEA #D9A21B #149C8F #8B3F9E. Up candles hollow ink, down candles filled ink.
- Display font: Space Grotesk · Body font: IBM Plex Sans · Numbers: IBM Plex Mono, tabular figures everywhere
- Radius: 6px on controls, 0 on documents and charts

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
