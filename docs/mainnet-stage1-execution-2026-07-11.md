# LuckyMe mainnet Stage 1 execution — 2026-07-11

> Historical Stage 1 evidence. Stage 2 recovery is now complete. The later
> minimum-ticket/refund release candidate remains undeployed and separately
> gated.

Status: **Stage 1 complete and verified. Program, KeeperConfig, production API,
site and the dry-run keeper are live. Rent recovery and keeper write mode remain
unapproved and untouched.**

## Approval boundary

The owner approved Stage 1: stop the old keeper, upgrade the program,
initialize KeeperConfig, and deploy the backend/site/keeper in dry-run. This
does not approve legacy rent recovery, keeper write mode, or an unspecified SOL
transfer.

## Keeper stop

- VPS signer: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- `luckyme-settlement-keeper.timer`: `disabled`, `inactive`
- `luckyme-settlement-keeper.service`: `inactive`
- Signer file, permissions, unit files and state directory were preserved.
- The old write-enabled unit was replaced by the checked-in dry-run unit. No
  write-approved override is installed.

## Program upgrade

- Cluster genesis:
  `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Temporary fee payer and initial buffer authority:
  `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`
- Temporary buffer: `9qCNwcWU2HRhJKbNHLKDF7RBLib1HTQ9iuA5cdi9Hf5E`
- Artifact size: `350352` bytes
- Artifact SHA-256:
  `f6dfc51b8799b4368d0a7be7f517b3f4a91e28a75788d664c57c2d0670d1277f`
- Buffer rent: `2439654000` lamports; returned to the fee payer by upgrade.

The buffer upload completed with `348` successful transactions and zero failed
transactions: one create/initialize transaction and 347 write transactions.
The buffer dump matched the local artifact byte-for-byte before its authority
was changed.

- Buffer-upload fees derived from exact payer/rent balance deltas:
  `1745000` lamports.
- Buffer-authority transaction:
  `3F8v7yQqrP2agRRQmLLVsda4eJWnKhn2BgqEUWNaBWSEiWua3sirfqyKTKte78BkXsA5YTuVXKgxSuvSuic95CKo`
- Buffer-authority fee: `5000` lamports; `err=null`.
- Upgrade transaction:
  `2zAaW1ZabqRXCNFk6k1Aiw7Poy9JAGVQdMj98WyNEz9DpVhiRoGwtpCvmPDnsUbV6S5wDLCqEmye7597UeSgyzeQ`
- Upgrade fee: `10000` lamports; `err=null`.
- Total non-refundable upgrade workflow fees: `1760000` lamports
  (`0.00176 SOL`).
- Program slot before: `431448819`.
- Program slot after: `432234649`.
- Program authority after: unchanged, `AApgo...`.
- ProgramData capacity after: `398120` bytes.
- On-chain dump: first `350352` bytes match the artifact hash; the remaining
  `47768` bytes are all zero.
- Buffer after upgrade: `0` lamports; RPC may retain a zero-lamport tombstone.
- Temporary fee payer after rent return and all upgrade fees:
  `2546528520` lamports.

The complete list of 348 buffer upload signatures and both loader transactions
is stored in `docs/mainnet-stage1-upgrade-evidence-2026-07-11.json`.

## KeeperConfig initialization

- KeeperConfig PDA: `8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y`
- Approved keeper: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- Rent: `1398960` lamports.
- Fee estimate: `5000` lamports.
- Authority and fee payer: Ledger `AApgo...`, one signer.
- Authority balance before the approved top-up: `890880` lamports.

The first post-upgrade dry-run correctly failed with
`InsufficientFundsForRent { account_index: 0 }`, returned exit code 1, and
emitted `planHash: null`. No Ledger access or transaction followed. At least
`513080` more lamports were needed.

The owner then explicitly approved a `0.002 SOL` transfer from the temporary
fee payer back to the authority. It was confirmed with signature
`JtyrWqXNQAXfhqBMA3CgYzLcDeQqVdMDbpmCJ2kHpqPhHoGv8aJPT3mLcBHaKZLxaBzJWKpe93T8MmxKfJLsvZv`;
fee `5000` lamports, `err=null`. Post-transfer balances were:

- temporary fee payer: `2544523520` lamports;
- Ledger authority: `2890880` lamports.

The second post-upgrade dry-run succeeded with `12506` compute units and no
error. Its exact plan hash is
`8c5960b1b56f199fc1b8ca63b30ba32b4b7e1d09fb8de7d092e83ed6098e2ed7`.
The owner approved that hash. The Ledger-signed initialization was finalized at
slot `432236180` with signature
`34Bj3CND8LbWan6WuRanK5mianxGEQnMYkDStGZzzJmg3jwqFpjWc1pWdtqni71fDzqh6L3dbLG2MUmWCudeG73U`;
fee `5000` lamports and `err=null`. The PDA contains exactly `1398960`
lamports and decodes to the approved Config and keeper. The authority balance
after initialization is `1486920` lamports.

## Off-chain staging and rollback

- Inactive VPS stage:
  `/opt/luckyme/.release-staging/stage1-20260711T140701Z`
- Payload SHA-256:
  `81aad803058eb767e67816db072c6e1109002f28cbd62bc04455e525f82f4130`
- Live backup:
  `/opt/backups/luckyme-lifecycle-20260711T135814Z/live-files.tar.gz`
- Backup SHA-256:
  `a78cb442bafe3a32dc79545bb7799fc3690bb3ef1e042ee3c230ab8c92d3f146`

The matching IDL/backend/scripts/site and dry-run unit were activated from this
stage. Public validation passed:

- `https://api.lucky-me.app/health`: `ok=true`, `MAINNET_RELEASE`, mainnet-beta;
- `/config`: upgraded Program ID, on-chain available, ORAO VRF;
- `/pools`: four initialized pools, source `onchain`;
- `wallet-standard.js`: HTTP 200, JavaScript MIME, live hash matches staging;
- browser modal: extension-free browser listed no fake installed wallet,
  displayed WalletConnect separately, and logged no console errors.

One manual systemd invocation completed successfully with `dryRun=true`, the
approved keeper, expected legacy actions in `planned`, and `executed=[]`.
Service and timer are both inactive; timer is disabled. Pool buttons remain in
`Maintenance` because Stage 1 did not authorize those planned on-chain writes.

## Fresh legacy rent dry-run

The post-upgrade/post-KeeperConfig report is
`docs/mainnet-rent-recovery-dry-run-post-upgrade-2026-07-11.json`:

- 19 Round accounts found;
- 18 eligible empty legacy rounds;
- all 18 transaction simulations succeeded;
- no invalid accounts;
- Mini round 2 remains blocked because it contains 4 tickets and 3 entrants;
- estimated treasury recovery: `52116480` lamports (`0.05211648 SOL`);
- estimated keeper fees: `90000` lamports (`0.00009 SOL`);
- plan hash:
  `51dac6fd3ff23acfa93392e52509c30477e7a42d13088b4cdfc64bac6463e47c`.

No recovery transaction was sent. This hash needs the separate Stage 2 owner
approval.
