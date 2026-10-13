#!/bin/zsh
# video-receipt-clip.sh <tx hash> <clip name> [seconds, default 8] [scrollY, default 300]
# Records the testnet explorer page of <tx> into work/v4/<clip name>.mp4 (1920x1080) with Success, the age and the ERC20
# transfer row outlined. Run it under: lockf -t 600 /tmp/deepsurge-rec.lock
cd "$(dirname "$0")" || exit 1
TX=$1; N=$2; SECS=${3:-8}; Y=${4:-300}; MS=$(awk "BEGIN{printf \"%d\", $SECS*1000}")
export CDP_PORT=9396 PIN_FILE=$HOME/.cache/qa-tab-video W=1280 H=720 DSF=1.5 NOCURSOR=1
HLJS=$(jq -Rs . work/v4/hl.txt)
cat > work/v4/rc-$N.json <<JSON
[
{"goto":"https://testnet.monadexplorer.com/tx/$TX","load":9000},
{"waitFor":"/Transaction Hash/.test(document.body.innerText) && /Success|Fail/.test(document.body.innerText) && /ago/.test(document.body.innerText)","timeout":60000},
{"eval":"window.__RES=[/^Success$/,/ago/,/^0x[^]*for[^]*AUSD$/];1"},
{"eval":$HLJS,"as":"hl"},
{"eval":"window.scrollTo(0,$Y);(document.body.innerText.match(/[^\\\\n]*ago[^\\\\n]*/)||[''])[0]","as":"age","after":500},
{"rec":"$N"},
{"wait":$MS},
{"rec":false}
]
JSON
node rec.mjs about:blank work/v4/rc-$N.json work/v4 | jq -c '.vars'
