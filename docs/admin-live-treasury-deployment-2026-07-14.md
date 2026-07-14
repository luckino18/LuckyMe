# Admin live Treasury estimate deployment — 2026-07-14

## Outcome

The protected admin page now contains one Treasury estimate card for each current pool round. Every card shows the ticket value accumulated in the round, the live on-chain Treasury rate, and the projected Treasury amount in SOL.

The estimate uses the same integer basis-point formula as the on-chain program:

`floor(round.total_lamports * config.house_fee_bps / 10_000)`

It is explicitly presented as projected revenue. The transfer occurs only after successful settlement; a refunded round pays no Treasury fee.

## Production verification

- Deployed to `https://www.lucky-me.app/admin/`.
- Live configuration: Treasury `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`, house fee `200 bps` (2%).
- At `2026-07-14T19:52:05.788Z`, Mini round 7 had 27 tickets worth `0.135 SOL`, producing an exact projected Treasury amount of `0.002700 SOL`.
- Normal round 6, High round 6, and Premium round 7 had zero tickets and a zero estimate.
- The game API kept PID `1456113` and its original `2026-07-14 13:04:44 UTC` start time.
- The settlement keeper timer remained active and enabled.
- The mainnet write override remained absent.
- Both protected admin endpoints continued to return HTTP 401 without authentication.
- No blockchain transaction was constructed, signed, or submitted.
- Rollback snapshot: `/opt/backups/luckyme-admin-treasury-20260714T195041Z`.

## Test evidence

- Targeted admin tests: 10 of 10 passed.
- Full project suite: 141 of 141 passed.
- Mainnet release audit passed.
- Mainnet staging verified the live configuration and all four pool estimates before production installation.
