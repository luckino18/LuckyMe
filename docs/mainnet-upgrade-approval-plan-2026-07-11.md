# LuckyMe mainnet upgrade approval plan — 2026-07-11

> Superseded execution plan retained as evidence. Stage 2 recovery subsequently
> completed. It does not authorize or describe the separate minimum-ticket
> binary; use `mainnet-minimum-tickets-upgrade-approval-plan-2026-07-11.md`.

Status: **Stage 1 complete. Program, KeeperConfig, production backend/site and
the dry-run keeper are deployed and verified. Rent recovery and keeper write
mode remain unapproved and have not executed.**

## Verified identities and current read-only state

- Cluster: `mainnet-beta`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- ProgramData capacity: `398120` bytes
- Upgrade/config authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Authority balance after KeeperConfig initialization: `0.00148692 SOL`
- Config: `Cvx2ffKnwanpUZGsDBKyo2uwoo6gjucQmrRZpiYVyKh`
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`
- Treasury balance: `0.052579335 SOL`
- Operational keeper: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- Keeper balance: `0.001527625 SOL`
- New KeeperConfig PDA: `8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y`
- KeeperConfig currently exists: yes; keeper is exactly `6BU...`
- Historical, non-operational keeper plan address:
  `8TN3gVGp86EUnmpa3ncMpPHoWDAV7t997RuXaLesRWqV`

There is no single wallet that performs every role. The authority controls the
upgrade and keeper configuration, the keeper signs automated lifecycle work,
and treasury receives LuckyMe Round and sidecar rent.

## Final local artifact

- Production binary: `target/deploy/luckyme.so`
- Size: `350352` bytes
- ProgramData headroom: `47768` bytes
- SHA-256:
  `f6dfc51b8799b4368d0a7be7f517b3f4a91e28a75788d664c57c2d0670d1277f`
- Root and generated production IDLs are byte-for-byte identical.
- Production IDL exposes ORAO settlement and does not expose the test-only
  commit-reveal settlement instruction.

## Validation evidence

- Node tests: `74/74` passed.
- Rust tests: `8/8` passed.
- Anchor local-validator lifecycle suite: `1/1` passed.
- Seeker TypeScript typecheck: passed.
- Seeker production environment validation: passed.
- Backend production environment validation: passed.
- MAINNET_RELEASE audit: passed.
- Browser-rendered wallet modal: passed; zero compatible extensions were
  correctly shown as installed in an extension-free browser, and the separate
  Reown / WalletConnect option was visible.

The local-validator suite verified first-ticket timer start, no timer reset on
the second purchase, idle waiting behavior beyond the configured test duration,
no randomness request for an idle round, at most one LuckyMe randomness
sidecar, settlement/refund behavior, and exact rent destinations for Entry,
RoundRandomness, and Round accounts.

## Mandatory coordinated mainnet order

### 1. Stop and verify the old VPS keeper

Completed at `2026-07-11T13:25:36Z`. The authorized VPS session ran:

```bash
sudo systemctl disable --now luckyme-settlement-keeper.timer
sudo -u luckyme env NO_DNA=1 solana-keygen pubkey /etc/luckyme/keeper.json
```

The public key was exactly the operational keeper above. The timer is now
`disabled` and `inactive`, the service is inactive, and its unit, signer file,
permissions and state directory were preserved. No keypair contents were read
or copied.

### 2. Upgrade the existing program

- Program/instruction: upgradeable loader buffer create/write followed by
  `Upgrade` for the existing Program ID.
- Upgrade authority: `AApgo...`
- Proposed temporary upload fee payer: local deployment wallet
  `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`, only after the owner
  explicitly funds/selects it. It was funded and its post-upgrade balance is
  `2.54652852 SOL` after the buffer rent returned.
- A CLI `3.1.10` local-validator rehearsal of this exact 350352-byte artifact
  funded the temporary buffer with `2.439654 SOL`. The loader returned that
  rent to the fee payer after the successful upgrade.
- The rehearsal used distinct payer and buffer-authority signers and therefore
  measured two-signature write transactions. The live flow safely used the same
  `9DvCo...` key as payer and initial buffer authority, reducing the actual
  upload fees to `0.001745 SOL`; buffer-authority transfer cost `0.000005 SOL`
  and upgrade cost `0.00001 SOL`. Actual total: `0.00176 SOL`, without priority
  fee. All `348` buffer create/write transactions succeeded and zero failed.
- The funded temporary payer was sufficient; the complete buffer rent returned
  after upgrade. Funding remains a separate owner action, not implied by Stage
  1 approval.

The deployed bytecode cannot be replaced inside an ordinary RPC simulation.
The new program behavior was instead exercised on the local validator. The
upgrade command must retain preflight and must not use `--skip-preflight`.

### 3. Initialize KeeperConfig

- Program/instruction: LuckyMe `initialize_keeper_config`
- Authority and fee payer: Ledger `AApgo...` (one signer)
- New account: KeeperConfig PDA `8sHT...`
- Configured keeper: `6BU...`
- Rent deposit: `1398960` lamports (`0.00139896 SOL`)
- Estimated transaction fee: `5000` lamports (`0.000005 SOL`)
- Rent destination while the account remains active: KeeperConfig PDA

The pre-upgrade unsigned mainnet simulation returns Anchor error `101`
(`InstructionFallbackNotFound`), which is expected because the old deployed
program does not contain this instruction. It must be simulated again after the
upgrade and must succeed before signing. The mainnet script is pinned to the
approved identities, permits initialization only, uses the Ledger as the sole
fee payer/signer, and binds write mode to the reviewed dry-run plan hash.

### 4. Deploy matching clients, then keep the service in dry-run

Deploy the production IDL, backend, site, and keeper together. The checked-in
systemd unit is safe-by-default with `DRY_RUN=true`, mainnet write confirmation
false, expected keeper pinned to `6BU...`, one action per invocation, and a
`0.05 SOL` minimum keeper reserve. Do not install the write-approved systemd
override yet. The activated, verified payload is staged at
`/opt/luckyme/.release-staging/stage1-20260711T140701Z` with SHA-256
`81aad803058eb767e67816db072c6e1109002f28cbd62bc04455e525f82f4130`.

### 5. Second approval: legacy empty-round rent recovery

The refreshed read-only inventory at `2026-07-11T14:16:33.400Z` found:

- `19` existing historical Round accounts checked;
- `18` eligible empty Round accounts;
- `1` blocked paid round: Mini round 2, with 4 tickets and 3 entrants;
- estimated recoverable to on-chain treasury: `52116480` lamports
  (`0.05211648 SOL`);
- estimated fees for 18 individual transactions: `90000` lamports
  (`0.00009 SOL`), paid by keeper;
- all `18/18` recovery transaction simulations succeeded;
- reviewed plan hash:
  `51dac6fd3ff23acfa93392e52509c30477e7a42d13088b4cdfc64bac6463e47c`.

KeeperConfig exists and authorizes the operational keeper. The fresh report and
plan hash still require a separate owner approval before write mode. Recovery
then runs in batches of at most four, confirming and re-reading every account
between writes.

### 6. Fund and dry-run the keeper before opening entries

The configured `0.05 SOL` reserve minus the current balance is
`0.048472375 SOL`. Any funding transfer needs an explicit source wallet and is
not authorized here. Four new waiting Round accounts require a total rent
deposit of `0.01158144 SOL` plus approximately `0.00002 SOL` in transaction
fees. Their rent later returns to the on-chain treasury.

The keeper must first run in dry-run, then with the separately approved systemd
write override. Each new Round starts with `start_ts=0` and `end_ts=0`; opening
these four waiting rounds does not request ORAO. The first confirmed ticket in
each pool starts its one-hour timer.

## Approval boundary

Approval for steps 1–4 does not approve rent recovery or any unspecified SOL
transfer. Step 5 requires the second explicit approval after a fresh successful
mainnet dry-run. No service write mode is enabled until both the keeper identity
and the dry-run output are verified on the VPS.
