# Admin live entry wallets deployment — 2026-07-14

## Outcome

The protected admin page now shows, for every current pool round:

- the full buyer wallet address;
- the number of tickets bought by that wallet;
- the corresponding ticket value in SOL;
- the round ticket and wallet totals.

The data is read directly from the current on-chain `Entry` accounts and is refreshed by the existing operations monitor. The feature is read-only and does not construct, sign, simulate, or submit transactions.

## Live deployment

- Deployed to `https://www.lucky-me.app/admin/`.
- Only the operations monitor reader and protected static admin files were changed.
- The game API was not restarted: PID `1456113`, active since `2026-07-14 13:04:44 UTC`, remained unchanged.
- `luckyme-settlement-keeper.timer` remained `active` and `enabled`.
- Unauthenticated requests to both `/admin/` and `/admin/status.json` continued to return HTTP `401`.
- Rollback snapshot: `/opt/backups/luckyme-admin-entries-20260714T193114Z`.

## Verification snapshot

At `2026-07-14T19:34:12.731Z`, Mini round 7 contained 12 tickets across 3 wallets:

- `Cy2M8D8LWaqzZrhdbMD7244kxZmmaXCUpbU9FEZyt7t5`: 1 ticket;
- `GvcV1D3wLPGoia9VkHBiTrJN3ZKBhMF6mEh1862DDCXR`: 10 tickets;
- `4i7qYXgcFCs8V57zSipbj9iG86PY29GpVF6gWHCXVKL3`: 1 ticket.

Normal round 6, High round 6, and Premium round 7 contained no tickets at that snapshot. For every pool, the sum of the displayed entry ticket counts and lamports matched the round totals.

## Test evidence

- JavaScript syntax checks passed.
- Admin/notification test file: 9 of 9 passed.
- Full project suite: 140 of 140 passed.
- Mainnet release audit passed.
- A staging run against mainnet verified all four pools before production installation.
