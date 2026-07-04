# Randomness

LuckyMe currently supports only `commit_reveal_demo` randomness. This is
acceptable for `DEVNET_STORE_DEMO` and not acceptable for real-money mainnet.

## Current Devnet Model

1. A keeper opens a round with `hash("luckyme-commit", reveal)`.
2. Users buy tickets while the commitment is public.
3. After the round ends, settlement reveals the 32-byte secret.
4. The program verifies the commitment and derives randomness from:

```text
sha256("luckyme-round-randomness" || round_pubkey || total_tickets_le || reveal)
```

Winner ticket uses bytes `0..8`, jackpot roll uses bytes `8..16`, and jackpot
ticket uses bytes `16..24`.

## Known Risk

The reveal provider can calculate the result after seeing the final ticket
count. If the result is unfavorable, it can refuse to reveal. Refunds prevent
permanent fund lockup, but they do not prevent selective round cancellation.

## Refund Recovery

After `round.end_ts + 600` seconds, any caller can crank refunds with
`refund_entry_after_timeout`. The refunded lamports always go to `entry.player`,
even if another fee payer submits the transaction.

## Mainnet Requirement

Before `MAINNET_BETA_CANDIDATE`, integrate production randomness:

- ORAO VRF, Switchboard randomness, Pyth Entropy, or an equivalent Solana
  provider with verifiable fulfillment.
- Provider accounts, fees, fulfillment flow, and failure handling documented.
- Tests for request, fulfillment, settlement, fallback, and refund recovery.
- UI proof display for commitment/request/proof/fulfillment.
- Backend and keeper runbooks for monitoring missing randomness.

Do not enable mainnet with `commit_reveal_demo`.
