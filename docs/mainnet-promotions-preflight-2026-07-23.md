# LuckyMe Promotions — Mainnet preflight 2026-07-23

## Outcome

The SOL and classic SPL-token promotion lifecycle is complete on Solana Devnet:
fund, multi-user entry, Lucky Points deduction after confirmed entry, capacity
lock, MagicBlock randomness, winner selection, payout, entry closure and
promotion/vault archival.

The ProgramData capacity extension and the byte-identical program upgrade were
later approved, submitted and verified on Mainnet. The upload buffer was closed
by the upgrade and all recovered funds were returned to the Ledger. No
production application deployment was submitted.

## Final product-driven Devnet settlement

- Local promotion: `18dbe9ac-8e7f-4f75-8f04-a852cdc37ce7`
- Promotion PDA: `CioQGpmpujSvLdZgo9eRSy7Z7nmLCHF9iHm2QzvFvtHZ`
- Prize: `0.01 Devnet SOL`
- Winner index: `1`
- Winner player: `FBuePAfBs7CrbkTdpbKEae4PoQoc8H1XYKbkeGomYeb4`
- Payout: `o2aJKDF5HzB7Tg8y9pTjY7eiDSnmSd7x1zPs477iaTkNwAGpfAcavCiHUJfx9ZHb6DQEMnyyF9TienkvAHTWpRM`
- Archive: `4H2LXwt365wbcwzT75LC5ziiuGr43GqjYerymtp6siSmWQNSApsteTCdUCPqzA1PfG1C9iEp7aSaYVJahoyx8YtG`
- Verified recipient delta: `10,000,000` lamports
- Payout, both entry closures and archive: `finalized`, `err: null`
- Promotion, vault and both entry accounts: closed

Earlier product/API-driven multi-user cycles also completed for SOL and mock
SKR, including the 100-participant SKR pool.

## Canonical source and artifact

The compact promotion module is now present in the canonical repository under
`programs/luckyme/src/promotion_compact.rs` and wired into the existing LuckyMe
program. It does not create a second Solana program.

- Canonical build size: `480,352` bytes
- Canonical SHA-256: `2b68987ddc10e49075685b4c89354bef536b2718d96a1083c8336aeb8556bd59`
- Devnet-verified SHA-256: `2b68987ddc10e49075685b4c89354bef536b2718d96a1083c8336aeb8556bd59`
- Rust tests: `15/15`
- Mainnet release source audit: passed
- Production APK environment validation with the `dapp-store` profile: passed

## Pre-upgrade Mainnet inventory

- Cluster genesis: `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- Current deployment slot: `434510719`
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Current ProgramData capacity: `448,120` bytes
- Required extension: `32,232` bytes
- Additional permanent ProgramData rent at the observed epoch: `224,334,720` lamports
- Recoverable upload-buffer rent at the observed epoch: `3,344,398,320` lamports
- Estimated base transaction-fee budget: `2,000,000` lamports
- Finalized Ledger balance observed before transaction preparation:
  `4,501,638,440` lamports (`4.501638440 SOL`)
- Estimated peak requirement before buffer recovery: `3,570,733,040` lamports
- Estimated balance margin at peak: `930,905,400` lamports (`0.930905400 SOL`)

Release-profile probes did not remove the extension requirement. The verified
`opt-level = "z"` build remains the smallest safe build tested. Disabling
overflow checks saved only `2,968` bytes and was rejected; `panic = "abort"` and
`opt-level = "s"` increased the artifact size. Removing or manually replacing
the MagicBlock VRF SDK would change the already validated randomness request
path and therefore requires a fresh Devnet upgrade and full lifecycle retest.

Rent and fees must be recalculated immediately before any approved transaction.

## Mainnet ProgramData extension

The owner approved the exact extension after a successful unsigned Mainnet
simulation. The Ledger authority signed one loader transaction:

- Signature:
  `59zeii3i2MEjFUoTVniK2AbM6HB6TDQhtMNc2F9pwRCih96NxhdiwiYZ1y2BdDmjz8HAK2ao9bKpjbPZKSfkQ2aT`
- Status: `finalized`, `err: null`
- Slot: `434691593`
- Additional bytes: `32,232`
- ProgramData capacity: `448,120` to `480,352` bytes
- Permanent rent added: `224,334,720` lamports
- Transaction fee: `5,000` lamports
- Exact Ledger debit: `224,339,720` lamports (`0.224339720 SOL`)
- Ledger balance after finalization: `4.277298720 SOL`
- Upgrade authority after finalization:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Program remains executable and owned by the upgradeable BPF loader
- Program code was not changed by this transaction

## Mainnet buffer and program upgrade

The owner separately approved the funding, buffer-authority transfer, final
Ledger upgrade and recovered-funds return after successful simulations.

- Temporary uploader:
  `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`
- Funding amount: `3.35 SOL`
- Funding signature:
  `3o8Cyh1cZzSsXHfZe52L9fkCmGZXw2fu9hdr6umiDnR4xkeKdCMnMCcSZXvCgiioezzRfdCk12bkYvYwnyLsLv5z`
- Buffer: `45BHXWHY2BkBK4NudLAMfG3ZuZRSurREuAMCmw8wc2wS`
- Buffer payload length: `480,352` bytes
- Buffer payload SHA-256:
  `2b68987ddc10e49075685b4c89354bef536b2718d96a1083c8336aeb8556bd59`
- Buffer/local byte comparison before authority transfer: identical
- Buffer rent: `3,344,454,000` lamports
- Buffer-authority transfer signature:
  `3xxbTsok4w7xGrDfmKbsjyLkkTWLQYAu5MFAvdgoekEgV65ayK492firiJSooeTfhtLmSbovSJUwwmiaY7UWpT73`
- Buffer authority before upgrade:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`

Final upgrade:

- Signature:
  `4jCrLqn9dttUhmn23D5eSsp5oBe3PPGpzy1B11JkzGsWJ2cY9DCNzDpzF75crfZF6BnMxzkD3tPHAqqh2VGng5Mf`
- Status: `finalized`, `err: null`
- Slot: `434696545`
- Transaction fee: `5,000` lamports
- Deployed payload length: `480,352` bytes
- Deployed SHA-256:
  `2b68987ddc10e49075685b4c89354bef536b2718d96a1083c8336aeb8556bd59`
- Deployed/local byte comparison: identical
- Upgrade authority after finalization:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Program remains executable and owned by the upgradeable BPF loader
- Upload buffer after finalization: closed

Recovered funds:

- Returned to Ledger: `3.347605 SOL`
- Return signature:
  `3baReuwZ35R9UQF7frPwxvVapRqoom57d9zYkvBkJGHD1J8yXB3vspDAJ3K62teFhWCm8EAqZe6pCjLtMe2xEUbk`
- Status: `finalized`, `err: null`
- Return transaction fee: `5,000` lamports
- Temporary uploader final balance: `0 SOL`
- Ledger final balance: `4.274913720 SOL`

Post-upgrade production reads remained healthy: the public API reported
`MAINNET_RELEASE` on `mainnet-beta`, on-chain state was available, and Mini,
Normal, High and Premium each still had zero tickets.

## Remaining release boundary

The installed code-5 APK is intentionally parallel and test-only:

- package: `app.luckyme.localtest`
- version: `1.2.2-devnet-promotions.3` / code `5`
- signer: LuckyMe local test certificate
- backend: local `127.0.0.1:8788` through ADB reverse
- identity and Lucky Points: isolated demo data

It must not be relabelled or published as a Mainnet build. Mainnet release still
requires a production Promotions API tied to real authenticated LuckyMe users
and real Lucky Points, APK wallet/user identity wiring, protected Admin
authorization, official SKR mint configuration, keeper operation and the normal
production signing lane.

The ProgramData extension and program upgrade are complete. Production API/APK
deployment and any Mainnet prize funding remain separate operations and each
requires its own exact transaction summary, simulation and explicit owner
approval.
