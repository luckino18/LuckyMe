# Devnet Checklist

## Toolchain

- Install Rust and Cargo.
- Install Solana CLI.
- Install Anchor CLI.
- Create a devnet wallet and fund it from the faucet.
- Confirm the public program id in `Anchor.toml` matches `declare_id!`.

## Program

- Build with `anchor build`.
- Run local validator tests.
- Confirm duplicate wallet entries in the same round are rejected.
- Deploy to devnet.
- Publish and verify the devnet program id.
- Initialize config with:
  - house fee: `300` bps
  - jackpot fee: `200` bps
  - round duration: `300` seconds
  - jackpot odds denominator: `288`
- Initialize three pools:
  - Mini: `5_000_000` lamports
  - Normal: `10_000_000` lamports
  - High: `100_000_000` lamports

## Randomness hardening

Before mainnet, replace simple commit-reveal with one of:

- external VRF
- multi-party commit-reveal
- reveal bond plus fallback path

The current commit-reveal MVP prevents arbitrary settlement randomness, but the reveal provider can still withhold a reveal. Devnet now includes a no-reveal recovery path: after the reveal timeout, each entrant can refund their own entry. This prevents permanent pool-vault lockup, but it does not make the randomness production-grade.

## Mobile

- Add Solana Mobile Wallet Adapter.
- Add transaction builders for:
  - buy tickets
  - refund entry after reveal timeout
  - open round
  - settle round
- Show exact transaction effects before wallet approval.

## Launch gates

- External audit.
- Public source and verified program id.
- Legal review for gambling/lottery treatment.
- Mainnet treasury controlled by multisig and timelock.
- Production-grade randomness provider or hardened multi-party reveal flow.
