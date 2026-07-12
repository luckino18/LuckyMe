# Mainnet minimum-ticket upgrade approval plan — 2026-07-11

Status: **approved actions completed and verified on 2026-07-12.** The keeper
timer remains disabled/inactive, the temporary upload payer is back at `0 SOL`,
and the live API reports `activeRound: null` for all four pools. Execution
signatures and final balances are recorded in
`mainnet-minimum-tickets-upgrade-execution-2026-07-12.md`.

## Fixed identities

- Cluster/genesis: Solana `mainnet-beta` /
  `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- ProgramData capacity: `398120` bytes
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`
- Keeper: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- KeeperConfig: `8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y`
- Temporary upload payer: `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`

Read-only balances at the final preflight:

- authority: `2.54600544 SOL`;
- keeper: `0.001437625 SOL` (below the configured `0.05 SOL` write reserve);
- temporary upload payer: `0 SOL`.

## Exact release artifact

- Production `.so`: `target/deploy/luckyme.so`
- Size: `359312` bytes
- SHA-256:
  `ab541a8eac1c3525199f9f409e4134274484183a1b67c9826fa0badf7cbb9576`
- IDL SHA-256:
  `55bf4c6d975212b04ec326eb0b84168fa286014ab59ca3ae36c9a521ea164fee`
- TypeScript SDK SHA-256:
  `db10b2347d3b6f149fc879f3910c08d0f239d4acd2a5fdbd97c7e4a9f416868b`
- ProgramData headroom after upgrade: `38808` bytes.
- Increase over the deployed `350352`-byte artifact: `8960` bytes.

The artifact enforces targets Mini `25`, Normal `13`, High `3`, Premium `3`
plus three distinct Premium wallets; starts the one-hour timer at the first
ticket; skips ORAO below target; requires KeeperConfig-authorized refunds; and
binds a ticket purchase to the exact ticket total reviewed by the player.

## Buffer rent and fee ceiling

Upgradeable-loader buffer data is program size plus 45 bytes: `359357` bytes.
The current mainnet rent-exempt minimum reported by `solana rent` is
`2.5020156 SOL`. At 1012 payload bytes per write, upload needs 356 write
transactions.

Without priority fees:

- buffer create/initialize (two signatures): `0.000010 SOL`;
- 356 buffer writes: `0.001780 SOL`;
- buffer-authority transfer: `0.000005 SOL`;
- program upgrade (two signatures): `0.000010 SOL`;
- loader workflow total: `0.001805 SOL`;
- authority-to-payer funding transaction: `0.000005 SOL`;
- final payer-to-authority sweep: `0.000005 SOL`;
- expected total non-refundable transaction fees: `0.001815 SOL`.

A conservative exact temporary funding amount is `2.5038206 SOL` (buffer rent
plus complete loader workflow). Buffer rent is returned after a successful
upgrade; any remainder must then be swept back to the authority. Recalculate
rent and ordinary fees immediately before signing; stop if the required amount
or artifact hash differs.

## Approved execution order

1. Reconfirm timer/service are disabled and inactive; save the live program,
   authority, KeeperConfig, pool, balance, and API snapshots.
2. Re-run every local test and production validator. Confirm the hashes above
   and that `359312 <= 398120`.
3. Only after a new explicit approval, transfer at most `2.5038206 SOL` from
   the Ledger authority to the exact temporary payer above.
4. Create/write the upgrade buffer with the temporary payer. Verify the buffer
   dump byte-for-byte against SHA-256 `ab541a8e...b9576` before changing its
   authority.
5. Set buffer authority to the Ledger upgrade authority and present the final
   upgrade transaction for signing. Upgrade only the fixed Program ID above.
6. Verify new slot, unchanged authority, unchanged ProgramData address and
   capacity, and a mainnet program dump whose first `359312` bytes match the
   approved hash and whose remaining capacity is zero-filled.
7. Deploy the matching IDL/backend/site/keeper source as one coordinated
   release. Keep submit relay off, keeper dry-run, timer disabled, and no Round
   open. Validate `/config`, `/pools`, `/how-to-play/`, wallet modal, and the
   automatic-refund `410` route behavior.
8. Run the settlement keeper in mainnet dry-run. It must execute `[]`; opening
   Mini 5, Normal 6, High 6, and Premium 6 remains a separate approval.
9. Sweep all recoverable remainder from the temporary payer back to
   `AApgo...`, confirm its balance is `0 SOL`, and archive signatures/hashes.

No step may silently start the keeper, fund the keeper, open a round, request
ORAO, recover additional rent, or submit a player transaction.

## Rollback boundary

The currently deployed program artifact is `350352` bytes with SHA-256
`f6dfc51b8799b4368d0a7be7f517b3f4a91e28a75788d664c57c2d0670d1277f`.
Before any new round opens, an unsuccessful coordinated service smoke test can
be rolled back by redeploying that verified artifact and the matching prior
backend/site/keeper. Its buffer rent was `2.439654 SOL` and the historical
loader workflow cost was `0.001760 SOL`; both must be rechecked before use.
Once players enter a round under the new instruction/API contract, rollback
requires a separate incident plan and must not be improvised.

## Approval consumed

The following approval was received and consumed for this completed execution:

`APROB upgrade-ul minimum-tickets cu program hash ab541a8e...b9576 si transfer temporar maxim 2.5038206 SOL, fara pornire keeper si fara deschidere runde.`

The separately approved `0.00089088 SOL` supplementary top-up was also consumed
and swept with the recovered buffer rent. Opening rounds and enabling keeper
writes still require later, separate approvals.
