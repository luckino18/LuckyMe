# LuckyMe Handoff

Last updated: 2026-07-04 17:02 CEST

## Repository

- Public repo: https://github.com/luckino18/LuckyMe
- Branch: `main`
- Program id: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Latest pushed commit before this handoff update: `6c82871 Update devnet bootstrap handoff`
- CI: https://github.com/luckino18/LuckyMe/actions/runs/28708667728

## Current State

LuckyMe has:

- Anchor/Solana program for fixed Mini, Normal, and High pools
- deterministic local simulator tests
- backend dev API for pool state and wallet transaction build/submit
- Expo/React Native Seeker app
- Mobile Wallet Adapter join flow
- in-app transaction review before wallet signing

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

Known follow-up:

- The app displayed `Your chance 50.00%` after the first ticket was purchased.
  That value is the projected chance for buying one more ticket
  (`ticketCount / (currentTickets + ticketCount)`), not the already-owned
  player chance. Rename it or compute the connected wallet's actual entry
  count before production.
- Round 7 settlement is pending. Use the reveal above after the round closes,
  and require explicit approval before sending the keeper settlement
  transaction.

## Safety Notes

LuckyMe has lottery/gambling mechanics. Do not launch with real funds without:

- external smart-contract audit
- legal review
- production-grade randomness plan
- multisig treasury and upgrade authority
- responsible gaming controls
