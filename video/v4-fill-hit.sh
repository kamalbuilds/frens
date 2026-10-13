#!/bin/zsh
# v4-fill-hit.sh <hit payout tx hash>
# Replaces the marked beat 8 slot of frens-demo-v4.mp4: records the explorer page of the payout (Success, age and the ERC20
# transfer row outlined), burns the label, rebuilds only the changed beat and the final mix. Needs the deepsurge recording lock.
set -e
cd "$(dirname "$0")"
TX=$1; [ -n "$TX" ] || { echo "usage: v4-fill-hit.sh <tx hash>"; exit 1; }
lockf -t 600 /tmp/deepsurge-rec.lock ./video-receipt-clip.sh "$TX" X-hit 8 300
lockf -t 600 /tmp/deepsurge-rec.lock node card.mjs cap.html '{"title":"price reached 84,068","sub":"4 dollars to bo, minutes ago","pos":"r t"}' work/v4/caps5/c33-hit.png
jq '(.beats[]|select(.name=="HIT RECEIPT PLACEHOLDER")|.name)="receipt hit"|(.beats[].caps[]?|select(.png=="work/v4/caps5/c33.png")|.png)="work/v4/caps5/c33-hit.png"' v4b.spec.json > /tmp/v4b.hit.json && cp /tmp/v4b.hit.json v4b.spec.json
rm -f asm-demo-v4b/b9.mp4
cd /tmp && REUSE=1 XFADE=0.25 X264_PRESET=veryfast node "$OLDPWD/assemble.mjs" "$OLDPWD/v4b.spec.json"
