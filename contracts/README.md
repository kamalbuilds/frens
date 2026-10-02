# frens contracts

`CallStake`: a position owner backs a friend's take-profit call with an aUSD stake. It pays the caller only if
Perpl's own mark price reaches the TP before expiry, and returns to the owner otherwise. The TP, side and owner
are read from the resting Perpl order (`getOrderV2`), never supplied by the staker.

    forge install foundry-rs/forge-std --no-git   # once
    forge test                                    # unit + fuzz
    MONAD_TESTNET_RPC_URL=... forge test --match-contract Fork   # against Perpl's real testnet Exchange
