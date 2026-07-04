# Devnet Checklist

## Toolchain

- Install Rust and Cargo.
- Install Solana CLI.
- Install Anchor CLI.
- Create a devnet wallet and fund it from the faucet.
- Confirm the public program id in `Anchor.toml` matches `declare_id!`.

## Program

- Build with `anchor build`.
- Run local validator tests with `npm run test:anchor`.
- Confirm duplicate wallet entries in the same round are rejected.
- Confirm refund mode with at least two entries on localnet:
  - first refund marks the round as refund mode
  - second refund still succeeds
  - normal settlement is rejected after refund mode starts
  - vault balance returns to the pre-round value after all refunds
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

See `docs/mainnet-readiness.md` for the required mainnet evidence.

## Mobile

- Add Solana Mobile Wallet Adapter.
- Add transaction builders for:
  - buy tickets
  - refund entry after reveal timeout
  - open round
  - settle round
- Show exact transaction effects before wallet approval.
- For manual settlement, use `docs/manual-settlement.md` to verify the reveal,
  derive `winner_entry`/`jackpot_entry`, and simulate the unsigned transaction.
- Use `GET /refunds` or `npm run refund:crank` to find abandoned-round refunds.

## Launch gates

- External audit.
- Public source and verified program id.
- Legal review for gambling/lottery treatment.
- Mainnet treasury controlled by multisig and timelock.
- Production-grade randomness provider or hardened multi-party reveal flow.
- Backend production guardrails and edge rate limiting.
- Private security contact and disclosure process.
