#!/usr/bin/env bash
# Builds frens as plain static files for Vercel: no route handlers, no server rendering, so the deployment
# has zero serverless functions. /api/* and link-preview bots on /r/* are proxied by Vercel's CDN (external
# rewrites, not functions) to the mini, which runs the full Next server. Output: web/out-static/
set -euo pipefail
API_ORIGIN=${API_ORIGIN:-https://teslas-mac-mini.tail57f771.ts.net:10000}
HERE=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d /tmp/frens-static.XXXX)
rsync -a --exclude node_modules --exclude .next --exclude 'out*' --exclude '.env*' --exclude .vercel "$HERE/web/" "$TMP/"
(cd "$TMP" && bun install --frozen-lockfile >/dev/null)
rm -rf "$TMP/app/api" "$TMP/app/r"
cat > "$TMP/app/page.tsx" <<'TSX'
import { StaticShell } from "./StaticShell";

export default function Page() {
  return <StaticShell />;
}
TSX
cat > "$TMP/next.config.ts" <<'TS'
import type { NextConfig } from "next";

const nextConfig: NextConfig = { output: "export", images: { unoptimized: true } };

export default nextConfig;
TS
(cd "$TMP" && bunx next build > "$TMP.log" 2>&1) || { tail -30 "$TMP.log"; exit 1; }
rm -rf "$HERE/web/out-static" && cp -R "$TMP/out" "$HERE/web/out-static"
BOTS='.*(Twitterbot|TelegramBot|facebookexternalhit|Discordbot|Slackbot|LinkedInBot|WhatsApp|Applebot).*'
cat > "$HERE/web/out-static/vercel.json" <<JSON
{
  "\$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": null,
  "rewrites": [
    { "source": "/api/:path*", "destination": "$API_ORIGIN/api/:path*" },
    { "source": "/r/:code", "has": [{ "type": "header", "key": "user-agent", "value": "$BOTS" }], "destination": "$API_ORIGIN/r/:code" },
    { "source": "/r/:code", "destination": "/index.html" }
  ]
}
JSON
rm -rf "$TMP"
echo "static build: $(find "$HERE/web/out-static" -type f | wc -l | tr -d ' ') files, functions: none (no api/, no server pages)"
