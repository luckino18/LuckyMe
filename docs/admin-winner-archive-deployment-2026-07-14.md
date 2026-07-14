# Admin winner archive deployment — 2026-07-14

## Result

The protected LuckyMe Admin now includes a permanent, read-only winner archive. It can be filtered by pool and exact round number and displays every winning wallet with its prize in SOL. Premium rounds display all three ranked winners, while refunded rounds remain visible with no winner.

The source of truth remains the append-only settlement archive at `/var/lib/luckyme/settlements.jsonl`. Later correction records supersede stale snapshots without deleting or rewriting historical evidence.

## Settlement hardening

- The keeper waits for the post-settlement RPC state to contain the expected winners and randomness before archiving.
- A corrected state may be appended after an RPC convergence race, while Entry cleanup changes do not create duplicates.
- New settlement records preserve exact house fee, jackpot contribution, main-prize payouts, winning ticket indexes, and jackpot payout.
- Existing records derive winner payouts from the archived total and the on-chain pool split exposed by the API.

## Mini round 7 correction

Mini round 7 originally archived a stale post-transaction RPC response. A validated correction was appended after matching the Round PDA, settlement signature, entry totals, ticket totals, confirmed transaction balances, and captured settled Round state.

- Winner: `9qhvSugqzuExBpoo2j4iiMzpHCfwSTwELEuxpGG3W2vQ`
- Prize: `0.152 SOL`
- Settlement signature: `5oos3vaA6Kjgv9fKE3EkrPrHuCCoTW7vc3dTQwG7LoyA9dBHDNsZSUXR8oeJAP4LoyTjMDwfc8rEFAAZkDdVszsS`

## Production verification

- Full tests: 146 of 146 passed.
- Mainnet release audit: passed.
- Operations monitor: healthy, zero alerts.
- Settlement keeper timer: enabled and active.
- Latest keeper run after deployment: success, exit status 0.
- API process was not restarted.
- Mini round 8 remained open and waiting with zero tickets.
- Admin route remained protected by HTTP Basic Authentication.
- Production rollback backup: `/opt/backups/luckyme-winner-history-20260714T202446Z`.
