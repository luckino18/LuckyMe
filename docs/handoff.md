# LuckyMe Handoff

Last updated: 2026-07-04

## Repository

- Public repo: https://github.com/luckino18/LuckyMe
- Branch: `main`
- Program id: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Latest pushed commit: `53c51ea Add join transaction review step`
- CI: https://github.com/luckino18/LuckyMe/actions/runs/28702120742

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

## Devnet Bootstrap

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

Current devnet status:

- CLI/deployer balance: `0 SOL`
- Phantom/player balance: `0 SOL`
- `solana airdrop 0.5` to CLI failed with rate-limit
- `solana airdrop 0.1` to Phantom failed with rate-limit
- `solana airdrop 0.001` to CLI also failed with the same rate-limit on 2026-07-04
- `devnet-pow 0.1.4` is installed
- `devnet-pow` cannot bootstrap while the payer has `0` lamports, because it needs fee lamports and tries the same rate-limited `request_airdrop` path if payer has less than `5000` lamports
- LuckyMe is not deployed on devnet yet
- rent-exempt minimum for `target/deploy/luckyme.so` is `1.93204032 SOL`
- practical deployer target: at least `3 SOL`

Alternative faucets to try manually with the CLI address:

- Chainstack: https://faucet.chainstack.com/solana-devnet-faucet
- QuickNode: https://faucet.quicknode.com/solana/devnet
- DevnetFaucet.org: https://www.devnetfaucet.org/
- SolFaucet: https://solfaucet.com/

Do not pay for devnet SOL. Test SOL has no monetary value.

## Next Commands After Funding

Once the CLI address has any fee lamports:

```bash
NO_DNA=1 solana balance 9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc --url devnet
NO_DNA=1 devnet-pow mine -d 3 --reward 0.02 -u dev -t 3000000000
NO_DNA=1 solana balance --url devnet
```

After the deployer has around `3 SOL`:

```bash
NO_DNA=1 anchor deploy --provider.cluster devnet
NO_DNA=1 ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npm run init:pools
NO_DNA=1 solana program show 4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3 --url devnet
```

Then:

1. Start backend with `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`.
2. Start Seeker app with `EXPO_PUBLIC_LUCKYME_API_URL=http://<mac-lan-ip>:8788`.
3. Fund Phantom with a small amount of devnet SOL.
4. Open a small round.
5. Verify the in-app review panel.
6. Let the user manually approve in Phantom.

## Safety Notes

LuckyMe has lottery/gambling mechanics. Do not launch with real funds without:

- external smart-contract audit
- legal review
- production-grade randomness plan
- multisig treasury and upgrade authority
- responsible gaming controls
