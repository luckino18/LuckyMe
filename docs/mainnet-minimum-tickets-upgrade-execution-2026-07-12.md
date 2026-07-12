# Mainnet minimum-ticket upgrade execution — 2026-07-12

Status: **completed and verified.** The approved minimum-ticket program,
backend, and public site are live. The keeper timer remains disabled/inactive,
the write override is absent, and no new Round was opened.

## Approved artifact and identities

- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Temporary payer: `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`
- Buffer: `9hCDhWdubTQWancgPKcHjckpbBEL2eBjFREm37zCCJMq`
- Program size/hash: `359312` bytes /
  `ab541a8eac1c3525199f9f409e4134274484183a1b67c9826fa0badf7cbb9576`
- IDL hash: `55bf4c6d975212b04ec326eb0b84168fa286014ab59ca3ae36c9a521ea164fee`
- SDK hash: `db10b2347d3b6f149fc879f3910c08d0f239d4acd2a5fdbd97c7e4a9f416868b`

## Mainnet transactions

- Initial temporary funding, `2.5038206 SOL`:
  `SRBUnLVmVHyZ4kcTotK6evKzUW2Xft4RDFJkBHvV7XfXSipZ8Ko6oYBkh2r2EDnKJN2VeTNg6uaxfRkbqEsbq8T`
- Approved supplementary top-up, `0.00089088 SOL`:
  `2BKKzV8w9ZyHqLqf8GhheoGt6JDM3yEWbLWkUTzZ4umCDkMuCQZStEoe4RQykkLzrBpgtFjxZXnpaBjf3qrNErhP`
- Buffer creation:
  `vXyEB3uf6Uyqgwbx4Suv5UAgSAAwYgoFyrCN9vE7afW9FnxxRijgLKJmrXSEfNptH61UwhiryBXHFagYECFkkfp`
- Buffer authority transferred to the Ledger authority:
  `2WQMZGFnyL5Re1ziznYcevR1edkS1otbVsSTWwvSX9B9AbMqqMvAApFCLiCfQkEKKz6KVFDEHWqjdjqmo7S455j5`
- Program upgrade, slot `432325448`:
  `4FpfG2rfMNzKTwmd3hZ1xYjghEtzXrt3PYM1MHQHLnyU1kAn5rjgJScgkKTTsfy4azPW6TaWRDR68Hp3zUwoiRf`
- Final sweep of `2.50290148 SOL` back to the authority:
  `3qdqZNjENbrCN9ueeGDRfVHD88j24tfPEHnwd1RCmiXC4igVo7vWa34A64mbDk475iTCFFwxDZwFCt9qPRchjrQ3`

The buffer history contains 359 successful transactions: creation, 356 data
writes, authority transfer, and upgrade. All have `err: null`. The initial QUIC
upload stopped after confirmation observation failed; the safe resume queried
the buffer, wrote only missing chunks with fresh blockhashes, simulated each
transaction, and then verified the final buffer byte-for-byte before the
authority transfer. No duplicate chunk changed the approved result.

## Post-upgrade verification and cost

- ProgramData capacity remains `398120` bytes.
- The first `359312` deployed bytes match the approved hash; the remaining
  `38808` bytes are zero-filled.
- Upgrade authority and ProgramData address are unchanged.
- Buffer balance: `0 SOL`; its `2.5020156 SOL` rent was recovered.
- Temporary payer final balance: `0 SOL`.
- Authority final balance: `2.54418544 SOL`.
- Authority net reduction: exactly `0.00182 SOL`, equal to all transaction
  fees across funding, buffer creation/writes, authority transfer, upgrade,
  and sweep. No buffer rent remained spent.
- Keeper balance: `0.001437625 SOL`, below the configured `0.05 SOL` reserve.

## Coordinated service release

The matching backend, site, IDL, SDK, and dry-run-only keeper files were
deployed from commit `d2ec0106db187eb4d10343c1ff9b6226b5bd0792`.

- VPS release staging: `/opt/luckyme/.release-staging/minimum-tickets-20260712T001647Z`
- VPS backup: `/opt/backups/luckyme-minimum-20260712T001647Z`
- Previous site: `/var/www/luckyme/public.prev-20260712T001647Z`
- Deployment payload hash:
  `e54983586df8374df681e1f4af450121629fc9852e4ae0f599ec4812f50fe883`

Public smoke checks passed for `/health`, `/config`, `/pools`,
`/how-to-play/`, wallet-standard assets, and the automatic-refund-only `410`
route. `/config` exposes Mini `25`, Normal `13`, High `3`, Premium `3`, with
three wallets required for Premium. All four pools report `activeRound: null`.
The live keeper dry-run returned `dryRun: true`, `executed: []`; its planned
Round openings were not submitted.

## Remaining approval boundary

This execution does **not** authorize funding the keeper, installing the write
override, starting its timer, or opening Mini 5, Normal 6, High 6, and Premium
6. Those actions require a new explicit approval. Until then the public rules
are live, but ticket purchase remains unavailable because every pool is idle.
