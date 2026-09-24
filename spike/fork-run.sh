#!/usr/bin/env bash
# Runs src/trade.ts against a local fork of Perpl testnet (real Exchange bytecode, real book).
# The deployer is funded with 150 aUSD from an existing testnet holder by impersonation, because
# the Agora testnet faucet (0xd236c18d274e54faccc3dd9dda4b27965a73ee6c) is drained.
set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
R=http://127.0.0.1:8545
T=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
HOLDER=0xd383de2426a7e2152e55bcd96cd71f1ecd6e3589
D=0xeF2E5ba8becc666b4B7BBfEB8f7d851af40Fd953
anvil --fork-url https://testnet-rpc.monad.xyz --port 8545 --disable-code-size-limit --silent &
ANVIL=$!; trap 'kill $ANVIL' EXIT
until cast chain-id --rpc-url $R >/dev/null 2>&1; do sleep 0.3; done
echo "fork block $(cast block-number --rpc-url $R)"
cast rpc anvil_impersonateAccount $HOLDER --rpc-url $R >/dev/null
cast rpc anvil_setBalance $HOLDER 0x56BC75E2D63100000 --rpc-url $R >/dev/null
cast send --unlocked --from $HOLDER $T "transfer(address,uint256)" $D 150000000 --rpc-url $R >/dev/null
cast rpc anvil_impersonateAccount $D --rpc-url $R >/dev/null
# The mark price freezes at the fork block and the Exchange rejects prices older than 60s, so run immediately.
RPC=$R TRADER=$D SIGNER="--unlocked --from $D" bun run "$(dirname "$0")/../src/trade.ts"
