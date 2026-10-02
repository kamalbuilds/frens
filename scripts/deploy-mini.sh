#!/usr/bin/env bash
# Ship main to the Mac mini host (launchd job xyz.frens.web behind Tailscale Funnel :10000) and prove it serves.
set -euo pipefail
git push -q mini HEAD:main
ssh mini-ts 'export PATH=$HOME/.bun/bin:/opt/homebrew/bin:$PATH; set -e
  cd ~/frens-prod && git fetch -q origin && git reset -q --hard origin/main && cd web && bun install >/dev/null && bun run build >/dev/null
  launchctl kickstart -k gui/$(id -u)/xyz.frens.web; launchctl kickstart -k gui/$(id -u)/xyz.frens.stake-keeper 2>/dev/null || true
  for i in $(seq 1 30); do curl -sf -o /dev/null localhost:3320/ && break; sleep 1; done
  echo "mini at $(git rev-parse --short HEAD): $(curl -so /dev/null -w %{http_code} localhost:3320/)"'
