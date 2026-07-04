# LuckyMe Handoff

Last updated: 2026-07-04 20:33 CEST

## Repository

- Public repo: https://github.com/luckino18/LuckyMe
- Branch: `main`
- Program id: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Latest code/test commit: `2cbf191 Close audit hardening gaps`
- CI: https://github.com/luckino18/LuckyMe/actions/runs/28715541850
- Devnet pre-release:
  https://github.com/luckino18/LuckyMe/releases/tag/v0.1.2-devnet

## Current State

LuckyMe has:

- Anchor/Solana program for fixed Mini, Normal, and High pools
- deterministic local simulator tests
- backend dev API for pool state, wallet transaction builders, optional submit
  relay, settlement tooling, and refund discovery
- Expo/React Native Seeker app
- Mobile Wallet Adapter join flow
- in-app transaction review before wallet signing
- devnet manual settlement/refund tooling

The Seeker app now asks the backend to build and simulate an unsigned
`buy_tickets` transaction, then shows a review panel with pool, round, tickets,
amount, cluster, program, wallet, and simulation status. Phantom is opened only
after the user presses `Sign in wallet`.

## Localnet Validation

Tested on Samsung `SM-S908B` over ADB.

Local services used:

- backend LAN: `http://192.168.178.130:8788`
- app package: `com.luckyme.seeker`

Phantom dev/test wallet used:

```text
EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW
```

Validated flow:

- connected Phantom through Mobile Wallet Adapter
- bought 1 Normal ticket on localnet through Phantom
- user manually approved wallet warning
- settled the round on localnet
- winner was the Phantom wallet
- payout was `0.0095 SOL`
- app displayed recent rounds and transparency correctly

Hardening validation:

- pressing `Join round` no longer opens Phantom directly
- Mini localnet review panel showed `0.005 SOL`
- cluster showed `http://127.0.0.1:8899`
- simulation showed `Passed`
- no user transaction was signed during hardening validation

## Checks Passed

For commit `53c51ea`:

```bash
npm run app:typecheck
npm --prefix app-seeker run doctor
git diff --check
npm test
```

GitHub Actions passed on `main`.

## Devnet Deployment And Samsung Validation

Solana CLI is configured for devnet:

```text
https://api.devnet.solana.com
```

Deployer/keeper CLI address:

```text
9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc
```

Phantom/player address:

```text
EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW
```

Devnet was funded manually after the public faucet rate limits blocked
bootstrap. Do not pay for devnet SOL; test SOL has no monetary value.

Program deployment:

- program id: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- program data: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- upgrade authority: `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`
- last deployed slot: `473936216`
- IDL metadata: `JEHgVkjaF6ATRTG7whkL6rx8KBnS6DPMtcfJFqxmjp19`
- rent held by program: `1.93235352 SOL`

Pool initialization:

- config: `Cvx2ffKnwanpUZGsDBKyo2uwoo6gjucQmrRZpiYVyKh`
- Mini pool: `AgZCfxkrsUb5iYaR1DhANVdM133hBgGzB2TPZaExiGRv`
- Normal pool: `14mtJnGcu3ASaM5ZvzsUcn2ZGjPR73tv5Fug9UWjSj9s`
- High pool: `PL7Yn89kfs9FjVWcuHXcN6vcHkiN8wPABvE9L1bUH61`

Live services:

- backend: `NO_DNA=1 ANCHOR_PROVIDER_URL=https://api.devnet.solana.com PORT=8788 node backend/src/server.mjs`
- backend status source: `onchain`
- app package on Samsung: `com.luckyme.seeker`
- test device: Samsung `SM-S908B`

Phantom/player setup:

- Phantom/player address: `EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW`
- Phantom must be in Developer Settings with `Solana Devnet` selected. The
  Phantom banner still says `Testnet Mode`; that banner is generic for
  non-mainnet mode and is not sufficient to distinguish Testnet from Devnet.
- CLI transferred `0.5 SOL` devnet to Phantom before the test.

Devnet Samsung result:

- Mini round `7` opened on devnet.
- round address: `GKwsvpTeCejnDopJSnbCNAsbE4PhScFgYk7GR7dziFUX`
- open-round tx: `3VJ77oP2FHytMRonzGjsVh7u55ttYXmzrNQu3NcPXAzGuyAjMxutiJ4QvFbebqJr4HV1nEzMdzT6fQSgEbSGHkh`
- reveal for settle: `3c59f4b6f053fb4f63e4617342d18037aeebd8b85a6cdcaf38c781c43e0b528e`
- user manually confirmed Phantom transaction.
- backend confirmed `totalTickets: 1`, `totalSol: 0.005`, `entrantCount: 1`.
- Phantom/player balance after buy: `0.493354 SOL`.
- deployer/keeper balance after buy check: `3.0222605 SOL`.
- app displayed Round 7, Tickets 1, Pool `0.005 SOL`, source `On-chain RPC`.

Devnet settlement result:

- Round 7 Mini was settled on devnet after explicit approval.
- settlement tx:
  `5ZddxuV8hJmTVbcaF3XTZ4ciUvYDV4p8jZGyNpQhXh3yMTAmhU1JzieErdcF8ke7gpURBkBFGJFFxtUaFtVVdAmh`
- explorer:
  `https://explorer.solana.com/tx/5ZddxuV8hJmTVbcaF3XTZ4ciUvYDV4p8jZGyNpQhXh3yMTAmhU1JzieErdcF8ke7gpURBkBFGJFFxtUaFtVVdAmh?cluster=devnet`
- pre-send simulation: `ok`, `14371` compute units.
- round `GKwsvpTeCejnDopJSnbCNAsbE4PhScFgYk7GR7dziFUX` is now `settled: true`.
- winner: Phantom/player `EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW`.
- main payout: `0.00475 SOL`.
- house fee to treasury/keeper: `0.00015 SOL`.
- jackpot add: `0.0001 SOL`.
- jackpot did not trigger; pool jackpot is now `100000` lamports.
- Phantom/player balance after settle: `0.498104 SOL`.
- deployer/keeper/treasury balance after settle: `3.0224055 SOL`.
- pool vault after settle: `890880` lamports.
- jackpot vault after settle: `990880` lamports.

Samsung/app verification after refresh:

- backend `GET /pools` reports `source: onchain`.
- Mini Round 7 appears with `settled: true`.
- app displays status `Settled`.
- history displays `Round 7`, badge `Settled`, `Tickets 1 | Pool 0.005 SOL`.
- history displays shortened winner `EdWN...rLHW`.
- app displays jackpot `0.0001 SOL`.
- local screenshot:
  `/Users/victor/Documents/Codex/2026-07-04/hai-2/work/luckyme-screens/round7-history-settled.png`

Known follow-up:

User chance fix:

- The app previously displayed `Your chance 50.00%` after the first ticket was
  purchased because it used the projected chance for buying one more ticket
  (`ticketCount / (currentTickets + ticketCount)`), not the already-owned
  player chance.
- Backend `GET /pools` now accepts `?player=<wallet-public-key>`.
- When `player` is present, the backend returns `userEntry` for each fetched
  round: `address`, `player`, `ticketStart`, `ticketCount`, `lamports`,
  `chancePercent`.
- The app sends the connected wallet to `GET /pools`.
- `Your chance` now uses `userEntry.chancePercent`, computed as
  `entry.ticketCount / round.totalTickets`.
- For Round 7 Mini, the Phantom wallet has `ticketCount: 1`,
  `totalTickets: 1`, and `chancePercent: 100.00`.
- Verified on Samsung: Mini Round 7 displays `Your chance 100.00%`.
- local screenshot:
  `/Users/victor/Documents/Codex/2026-07-04/hai-2/work/luckyme-screens/round7-chance-mini.png`

External audit follow-up:

- Fixed duplicate-entry ticket accounting risk by allowing only one buy
  transaction per wallet per round. A wallet can still buy multiple tickets, but
  it must choose the count in that first purchase.
- On-chain `buy_tickets` now rejects duplicate round entries with
  `AlreadyEnteredRound`.
- Backend `/transactions/buy-tickets` now rejects duplicate round entries with
  `409 already_entered_round` before building a transaction.
- Seeker disables the join controls for the connected wallet after that wallet
  already has a `userEntry` in the active round.

Devnet Mini Round 8 open result:

- Mini Round 8 was opened on devnet after explicit approval.
- open-round tx:
  `TuZd4bRR3iDkJYV9g9qS8VEuW9bgi7dVPZuVcdDk18cPELdxq3rFvkBrJaxaoPZmUnA2dkx6fgHmFZLDrqMKEJ7`
- explorer:
  `https://explorer.solana.com/tx/TuZd4bRR3iDkJYV9g9qS8VEuW9bgi7dVPZuVcdDk18cPELdxq3rFvkBrJaxaoPZmUnA2dkx6fgHmFZLDrqMKEJ7?cluster=devnet`
- transaction is `Finalized`.
- pre-send simulation: `ok`, `11549` compute units.
- round address: `Yw4v481Bq348VX5dzcVdjsRnLtaPUrXsgG1N7M3fhCL`.
- commitment:
  `c5a08a2506a88986c9796a4bd28ed5b500968ec19996347871f48d547f3ad822`
- reveal for settlement:
  `7b5c2cc16125ffd32812aec0a0f0272dd7481897bf4e7556369c6dab3cf6cc0e`
- backend `GET /pools?player=...` reports `currentRound: 8`.
- Round 8 is `settled: false`, `totalTickets: 0`, `totalSol: 0`,
  `userEntry: null`.
- Mini jackpot remains `0.0001 SOL`.
- local prep/reveal file:
  `/Users/victor/Documents/Codex/2026-07-04/hai-2/work/luckyme-rounds/devnet-mini-round-8-open-prep.json`
- Next test: refresh the Samsung app to confirm Mini Round 8 is visible/open,
  then buy 1 ticket through Phantom after the in-app review step.

Devnet Mini Round 8 buy result:

- The user manually confirmed the 1-ticket buy in Phantom.
- buy tx:
  `5jbj89GrzoirhvU4a1rNhrAjQjoP1XqpYXfYUw5VqeGezR99UAsa5wLUw7Z6uasoN7c7iEcSGAyzMB1stjG5Umm7`
- explorer:
  `https://explorer.solana.com/tx/5jbj89GrzoirhvU4a1rNhrAjQjoP1XqpYXfYUw5VqeGezR99UAsa5wLUw7Z6uasoN7c7iEcSGAyzMB1stjG5Umm7?cluster=devnet`
- transaction status: `Finalized`.
- round: `Yw4v481Bq348VX5dzcVdjsRnLtaPUrXsgG1N7M3fhCL`.
- entry:
  `4gZA4kR6o4giti3nWYHYUkix8Soo7ahvbMgVB69ZV8mb`
- player: `EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW`.
- `totalTickets: 1`, `totalSol: 0.005`,
  `userEntry.chancePercent: 100.00`.
- app displayed `Sent 5jbj...Umm7`.
- local screenshot:
  `/Users/victor/Documents/Codex/2026-07-04/hai-2/work/luckyme-screens/round8-after-user-buy.png`
- Round 8 is closed and settlement is prepared locally, but not sent.
- settle prep:
  `/Users/victor/Documents/Codex/2026-07-04/hai-2/work/luckyme-rounds/devnet-mini-round-8-settle-prep.json`
- settlement simulation: `ok`, `14371` compute units.
- expected settlement: winner
  `EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW`, main payout
  `0.00475 SOL`, house fee `0.00015 SOL`, jackpot add `0.0001 SOL`,
  jackpot does not trigger.

Devnet Mini Round 8 settlement result:

- Mini Round 8 was settled on devnet after explicit approval.
- settlement tx:
  `2jhZPP2Cv8d2XpBFweK94qbAd7asbS53ciNtVbpy8B8ND1sc8VykJ1qmvJwArFQftmJ5VnjyzYM1c3LdKkGYCshk`
- explorer:
  `https://explorer.solana.com/tx/2jhZPP2Cv8d2XpBFweK94qbAd7asbS53ciNtVbpy8B8ND1sc8VykJ1qmvJwArFQftmJ5VnjyzYM1c3LdKkGYCshk?cluster=devnet`
- transaction status: `Finalized`.
- pre-send simulation: `ok`, `14371` compute units.
- round: `Yw4v481Bq348VX5dzcVdjsRnLtaPUrXsgG1N7M3fhCL`.
- round is now `settled: true`.
- winner: `EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW`.
- jackpot did not trigger.
- main payout: `0.00475 SOL`.
- house fee: `0.00015 SOL`.
- jackpot add: `0.0001 SOL`.
- Mini jackpot is now `0.0002 SOL`.
- Samsung app displays Round 8 `Settled`, `Tickets 1`, `Pool 0.005 SOL`,
  winner `EdWN...rLHW`.
- local screenshot:
  `/Users/victor/Documents/Codex/2026-07-04/hai-2/work/luckyme-screens/round8-after-settle-refresh-top.png`

Devnet duplicate-entry fix deployment and Mini Round 9 result:

- Code commit deployed/tested: `7881964 Reject duplicate round entries`.
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Upgrade authority / keeper:
  `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`.
- First deploy attempt did not modify the program. Preflight rejected automatic
  extension because the new binary was 656 bytes larger, while the upgradeable
  loader required a minimum extension of 10240 bytes.
- ProgramData was extended by 10240 bytes.
- extend tx:
  `3vKKVupDodAXWmH7CybyJ6ttVybpLhza7isQHnHUHPCE8ZZ7CxdxcbSUMb4FiaoAJwmNB8281PyZx6DyexFPaMMp`
- deploy tx:
  `2MjwdMKSxNq9W1thVtk1e4cLMwBqAr6SFHmc8fzixmNbeyDw2ikw8UrBPAHYm7vGRCmDDRTR3haUSsFRRJgznaKP`
- program deployed slot: `473957836`.
- ProgramData length after deploy: `287704` bytes.

Mini Round 9 open:

- open tx:
  `3pPxvKmXLD1FTLDSZzXhdMgYsvjAMgwAbbw2xiNKa6eEKy38wkTeThpi4xCkENvU3AtqGaQyBpYDN462cS5TudTM`
- round:
  `FgUizGeaU1pCxHWwnbhfRHK6amUYx3BC2atzG8yZ1ADu`
- commitment:
  `14ffecd821bf8adc235161851486d1f0cb533727578dbb9222514707710adbff`
- reveal:
  `1c9edf44b8f05a194f6235c3acf3bddd7315fdda15cb00ca7a9e831b50aa999e`
- pre-send simulation: `ok`, `11549` compute units.

Mini Round 9 buy and duplicate-entry test:

- The user manually confirmed the 1-ticket buy in Phantom.
- buy tx:
  `1Ghas7CkvpgLcVhDvzQdoKYKUPup6ee3sHKyAdpKMFUuPWNQgDE33Z1HsWwJfmmBkkWAR7Btzgkw4sjen7zh3sb`
- entry:
  `2PFw1E8knQ7Kxk8cDTXLYvFkhSR8ToQGgNBguAVBuJ8f`
- `totalTickets: 1`, `totalLamports: 5000000`.
- Backend duplicate build test returned:
  `409 already_entered_round`.
- Direct on-chain duplicate-buy simulation returned Anchor custom error:
  `6019 AlreadyEnteredRound`.

Mini Round 9 settlement:

- settlement tx:
  `2X8t7cMBpwTofb4GxGbsKF8GPwBpDwvWbzkBiPwer6mXtgJQiJjmKsmnw2uYKuMG1e45QNwpdVCvKoQqwGzHyZsL`
- pre-send simulation: `ok`, `14371` compute units.
- round is now `settled: true`.
- winner:
  `EdWNHnbG1iQtaZ5BzZkzjsHopjfaQiB8Dzw1sRevrLHW`.
- jackpot did not trigger.
- Mini jackpot is now `0.0003 SOL`.
- Final checked balances:
  - player wallet: `0.494312 SOL`
  - keeper wallet: `2.94513418 SOL`
- Operational note: aggressive polling against the public devnet RPC caused
  temporary `429 Too Many Requests` responses and one backend restart during the
  test. Use slower polling or a dedicated RPC for repeated phone/backend tests.

External audit follow-up: no-reveal recovery and backend hardening:

- Code commit deployed/tested: `cbba6f9 Add no-reveal refund path`.
- Added program instruction `refund_entry_after_timeout`.
- Refund delay: `600` seconds after `round.end_ts`.
- Any caller can build/submit the refund transaction, but the refunded lamports
  always go to `entry.player`.
- The instruction does not change the `Round` or `Entry` account layout, so old
  devnet entries remain decodable.
- Refund mode uses existing fields: `round.settled = true`, default
  `winner`/`jackpot_winner`, `jackpot_triggered = false`, and zero randomness.
- Each refund zeroes `entry.ticket_count` and `entry.lamports`, decrements round
  totals, and prevents duplicate refunds with `NothingToRefund`.
- Normal settlement remains blocked after refund mode starts.
- Backend `/pools` now reports `refundDelaySeconds`, `refundAfterTs`,
  `refundAvailable`, and `refundMode`.
- Backend `/transactions/refund-entry` builds and simulates unsigned refund
  transactions for wallet signing.
- Seeker shows `Refund entry` when a connected wallet has a refundable entry.
- Backend hardening added: configurable `CORS_ORIGIN`, in-memory rate limiting,
  `MAX_JSON_BYTES`, and `ENABLE_TRANSACTION_SUBMIT=false` support for public
  deployments.
- CI now runs `cargo test` in addition to `cargo check`, simulator tests, app
  typecheck, Expo doctor, and dependency audits.
- GitHub CI run for this commit: `28713207257`, success.
- Devnet deploy:
  - ProgramData was extended by 10240 bytes.
  - extend tx:
    `2j21ZgDo9GayFHLwzjH6h3RtyzRZcYnKjh4utuGsVQciFePda5T74cSkzwkmna6zDu6B3Wq7ZAKqXNXnU9ws8zRY`
  - deploy tx:
    `2jyNVm2zaVxUw3AEeKdDQvNh6ZhYmLAhjWfwDiNv5Ct3Z8rACGx7hTKEwty3nhdZWoq8LwwACkQoN7tBK4jKNhJj`
  - deployed slot: `473962070`.
  - ProgramData length after deploy: `297944` bytes.
  - keeper balance after deploy: `2.87239378 SOL`.
- Refund success was not exercised live on devnet in this handoff because a real
  no-reveal refund requires an entered round, no settlement reveal, and waiting
  `300 + 600` seconds before the instruction becomes valid. Local simulator and
  Rust unit tests cover the timeout logic, refund-mode marker, and duplicate
  refund prevention.
- Important remaining blocker: commit-reveal is still not production-grade
  randomness. The refund path prevents funds from being permanently stuck, but
  it does not stop selective reveal withholding. Mainnet still requires
  VRF/Entropy or a bonded multi-party reveal design.

External audit follow-up: settlement tooling and security policy:

- Public GitHub `main` was verified at `8ea0192`; the auditor's latest text
  still described the old no-recovery/backend-hardening state.
- Added backend builder `POST /transactions/settle-round`.
- The settlement builder accepts a fee-paying `settler`, pool slug, round id,
  and 32-byte reveal; verifies the commitment; scans on-chain `Entry` accounts;
  derives the winner/jackpot ticket using the same byte offsets as the program;
  and returns the correct `winner_entry`, `jackpot_entry`, payouts, simulation,
  and unsigned transaction.
- Added `docs/manual-settlement.md` with reproducible settlement and refund
  commands.
- Expanded `SECURITY.md` with supported scope, sensitive reporting guidance,
  severity definitions, response targets, and incident-response steps.
- Remaining mainnet blockers are unchanged: production VRF/Entropy or bonded
  multi-party randomness, legal review, multisig authorities, production
  indexer/monitoring, and broader production test coverage.

External audit follow-up: Anchor localnet tests:

- Added `test-short-timers` program feature for CI/local tests only. Normal
  builds keep the production timers: minimum 60 second rounds and 600 second
  no-reveal refund delay.
- Added `tests/anchor-localnet.test.mjs` and `npm run test:anchor`.
- Localnet test coverage now includes config/pool initialization, zero-space
  vault funding, ticket buy, duplicate buy rejection, normal settlement,
  refund blocked after normal settlement, no-reveal refund mode, second entrant
  refund after first refund marks the round settled, settlement blocked after
  refund mode starts, duplicate refund rejection, and final vault balance.
- CI installs Solana CLI and Anchor CLI, runs `anchor build`, and runs the
  Anchor localnet integration test.

External audit follow-up: hardening closure matrix:

- Code/test commit: `2cbf191 Close audit hardening gaps`.
- Added `docs/audit-closure.md` so every auditor finding has an explicit status:
  fixed in repo, mitigated for devnet, or external blocker.
- Added `docs/mainnet-readiness.md` with non-negotiable evidence gates for
  production randomness, legal/compliance, multisig authorities, production
  backend, security program, indexer/cranking, and independent audit.
- Added Anchor events for config initialization, pool initialization, round
  opening, ticket purchase, settlement, refund, and pause changes.
- Regenerated public `idl/luckyme.json` and `sdk/luckyme.ts` with the event
  definitions.
- Backend no longer reads the local wallet for read/build/submit-relay paths;
  it uses `createClient({ requireSigner: false })`.
- Backend defaults are now safer:
  - `HOST=127.0.0.1`
  - `ENABLE_TRANSACTION_SUBMIT=false`
  - mainnet RPC refused unless mainnet, legal, production randomness, and
    multisig signoff env vars are all set
  - production mode refuses wildcard CORS, submit relay, and direct
    `HOST=0.0.0.0`
- Added wallet/subject rate limiting around transaction builders in addition to
  IP-level rate limiting.
- Added `GET /refunds` for abandoned-round refund discovery.
- Added optional refund `feePayer`, so a cranker can pay transaction fees while
  the program still refunds only `entry.player`.
- Added `scripts/refund-cranker.mjs` and `npm run refund:crank` for keeper-run
  refund cranking. `DRY_RUN=true` prints refundable entries without sending.
- Added backend runtime guard tests:
  - mainnet RPC refused without signoffs
  - production wildcard CORS refused
  - transaction submit relay disabled by default
- Updated README, backend README, Seeker README, devnet checklist, manual
  settlement/refund docs, and security policy to match the new behavior.
- Important: this does not solve production randomness, legal, or multisig by
  declaration. Those remain explicit external mainnet blockers.
- GitHub prerelease `v0.1.2-devnet` was created for this source/test hardening
  state. No new devnet on-chain deployment was performed for this release.

Local verification for `2cbf191`:

```bash
node --check backend/src/server.mjs
node --check scripts/refund-cranker.mjs
node --check tests/backend-config.test.mjs
npm test
cargo check
cargo test
npm run app:typecheck
npm --prefix app-seeker run doctor
NO_DNA=1 anchor build --provider.cluster localnet
npm run test:anchor
git diff --check
```

## Safety Notes

LuckyMe has lottery/gambling mechanics. Do not launch with real funds without:

- external smart-contract audit
- legal review
- production-grade randomness plan
- multisig treasury and upgrade authority
- responsible gaming controls
