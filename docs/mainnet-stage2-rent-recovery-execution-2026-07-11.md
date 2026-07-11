# Mainnet Stage 2 rent recovery execution — 2026-07-11

> This completed recovery evidence remains current. The separate
> minimum-ticket/refund release candidate was prepared afterward and is not
> deployed by any transaction recorded here.

Stage 2 completed on Solana mainnet under the approved inventory hash
`51dac6fd3ff23acfa93392e52509c30477e7a42d13088b4cdfc64bac6463e47c`
and the approved maximum of four actions per batch.

## Result

- Eligible empty Round accounts closed: `18/18`.
- Estimated rent: `52,116,480` lamports (`0.05211648 SOL`).
- Actual rent returned to on-chain `config.treasury`: `52,116,480`
  lamports (`0.05211648 SOL`).
- Treasury: `52,579,335` -> `104,695,815` lamports.
- Keeper transaction fees: `90,000` lamports across 18 transactions.
- Keeper: `1,527,625` -> `1,437,625` lamports.
- Final recovery inventory: zero eligible accounts, zero invalid accounts.
- Settlement archive: 15 records, mode `600`, owner `luckyme:luckyme`.

The sole surviving historical Round is Mini round 2,
`8oFKiFhyRSfJjF7xHsJba1npVFuVXzf1DSerMk2GjzaG`. It contains 4 tickets,
`20,000,000` player lamports and 3 entrants. It remained classified
`contains_tickets_or_funds`, was excluded from every batch, and was not changed.

The complete batch table, all 18 transaction signatures, PDAs, plan hashes,
balances and the temporary fee-payer return signature are retained in
`docs/mainnet-stage2-rent-recovery-evidence-2026-07-11.json`.

## Temporary upgrade payer return

After the program upgrade and buffer close, the entire remaining balance of
`9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc` was returned to the approved
Ledger authority `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.

- Signature:
  `67qGDis4BZHDJzSzd8CEjbhXjKdfZaiAmvnkLwMmGFumqvSULQvfZ2gYoZ1k5675LJSn2DBqqwP6jUEzfFjDg6SJ`
- Transferred: `2,544,518,520` lamports.
- Fee: `5,000` lamports.
- Temporary payer after: `0` lamports.
- Upgrade buffer `9qCNwcWU2HRhJKbNHLKDF7RBLib1HTQ9iuA5cdi9Hf5E`
  after: `0` lamports.

## Post-recovery dry-run

The new keeper was run only in dry-run. It executed no transaction. It plans
one new waiting Round per pool: Mini 5, Normal 6, High 6 and Premium 6. These
accounts have not been created because normal keeper writes and the timer were
not approved in Stage 2.

The API remains active. The keeper timer remains `disabled` and `inactive`.
The site and API now treat a missing current Round PDA as unavailable instead
of incorrectly presenting it as an open round. The live page therefore shows
`No active round / Maintenance required` and disables Join until the next
waiting Round accounts are deliberately created.

The wallet selector was checked in the live browser. It is a real modal, lists
only detected browser extensions, and keeps Reown / WalletConnect as a separate
option. A browser without a compatible Solana extension correctly lists no
extension as installed.

## Verification

- Node suite: `75/75` passed.
- Targeted lifecycle suite: `8/8` passed.
- Seeker typecheck: passed.
- Mainnet release audit: passed.
- API health: `MAINNET_RELEASE`, `mainnet-beta`.
- API pool state: all four `activeRound` values are `null` after cleanup.
- Live wallet modal: present with Reown / WalletConnect.
- Deployment rollback backup:
  `/opt/backups/luckyme-missing-round-20260711T145125Z`.

## Remaining approval boundary

The game is not ready for ticket purchases until four new waiting Round
accounts are created. Enabling write mode also requires funding the dedicated
keeper above its configured `0.05 SOL` safety floor. No waiting Round was
opened, no ORAO request was made, and the keeper timer was not enabled in this
stage.
