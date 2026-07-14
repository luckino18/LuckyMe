# LuckyMe scalable rotation — mainnet program upgrade evidence

Date: 2026-07-15

Status: completed and verified. The scalable program, matching keeper, IDL,
SDK, and systemd configuration are live. No game transaction was submitted by
the upgrade operation.

## Approved scope

- Upgrade program `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3` from buffer
  `5bTH1JnxLPce1XbkWnQTNgdTfMpPJzY1QZeiJZmxVSD1`.
- Use Ledger authority `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Temporarily stop and then restart the settlement keeper.
- Install the matching scalable keeper configuration.
- Return recovered buffer funds to the Ledger.
- Do not submit any other game transaction.

## Preflight

- Buffer data was byte-identical to the approved program artifact.
- Approved artifact SHA-256:
  `eac891b994cac2373bb729be3c845703061b4d59a141e1945868c60e4f8ecb41`.
- ProgramData authority was the approved Ledger.
- All four pools had zero tickets with `startTs=0` and `endTs=0`.
- The keeper timer was disabled and inactive before the upgrade.
- The keeper service was inactive, with no keeper process or transaction in
  flight. Its last result contained `executed: []`.

## Program upgrade

- Upgrade signature:
  `3UGSTL5ob7DkQ2CmKDSzKrqbX5ZsBu9JkAPJU6PHQk1GmYyJe9E9UVLP3JdPANSGiJsAPxKmGX6oKcm7dQSVNz3k`.
- Status: finalized, no error.
- Upgrade slot: `432938728`.
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`.
- Upgrade authority after execution:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- ProgramData capacity: 398,120 bytes.
- Deployed program payload: first 376,752 bytes exactly match the approved
  artifact; the remaining 21,368 reserved bytes are all zero.
- The upgrade transaction closed the buffer and recovered 2.623398 SOL into
  the temporary payer.

## VPS deployment

- Pre-deployment backup:
  `/opt/backups/luckyme-scalable-20260715-001513`.
- Keeper SHA-256:
  `e623633de6619e96326176cfac3b263949cb66bb6a26fd468fec55bfcef07ad1`.
- IDL SHA-256:
  `f9e120ec8ec66727b8ed02a20e49194d3a2e69d5df9f25beacb44791ceeabf80`.
- SDK SHA-256:
  `4249a1a47aad5a6f3a1cfc1c289c41f2d38e93b5f1c6e8b24520a960d23ea60e`.
- Systemd service SHA-256:
  `c05e1a6f9cf684e2c4ecb918185beb32d2b5f1dabf2bec8129a7cc64249973be`.
- Scalable cleanup batch size: 8 entries per cleanup transaction.
- Maximum keeper actions: one transaction per service run.

## Post-upgrade validation

- Manual dry-run inspected Mini 8, Normal 6, High 6, and Premium 7.
- Every pool planned only `wait_first_ticket`.
- Dry-run result: `executed: []`.
- Dry-run log SHA-256:
  `67112037a2fc485a06cca3284efba816c762adf8f7dc676babdfec372cc0a19a`.
- Helius returned temporary HTTP 429 responses; built-in retries recovered and
  both the dry-run and first live keeper run completed successfully.
- First live keeper run after restart also returned `executed: []`.
- Keeper timer after validation: enabled and active.
- Public API after validation: healthy, `MAINNET_RELEASE`, `mainnet-beta`.
- Pool state remained unchanged: zero tickets, `startTs=0`, `endTs=0` for all
  four pools.

## Returned funds

- Temporary payer balance before return: 2.648105 SOL.
- Transfer to Ledger: 2.648100 SOL.
- Transfer fee: 0.000005 SOL.
- Return signature:
  `XYPrkEzSbAQFandZui68ZqpeiW6MzmupLrh9G44nb1owzSefjP2FRKqpzqkboYF4wk2uA8mfFqwMoiYuGUBE6PH`.
- Status: finalized, no error.
- Temporary payer balance after return: 0 SOL.
- Ledger balance after return: 2.71564344 SOL.

