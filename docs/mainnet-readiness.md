# Mainnet Technical Readiness

LuckyMe release mode is `MAINNET_RELEASE` for Solana mainnet-beta.

## Required Technical State

- Anchor Program ID is synchronized in `declare_id!`, `Anchor.toml`, IDL,
  SDK type helper, backend responses, app config, and docs.
- Backend release mode is `MAINNET_RELEASE`.
- Backend requires `LUCKYME_SOLANA_CLUSTER=mainnet-beta`.
- Backend requires an HTTPS `ANCHOR_PROVIDER_URL`.
- Backend requires `LUCKYME_RANDOMNESS_MODE=orao_vrf`.
- Backend requires `LUCKYME_PRODUCTION_RANDOMNESS=true`.
- Backend returns unavailable/error state rather than fake pool data when
  on-chain state cannot be read.
- App release env requires a production HTTPS backend URL.
- App release env requires final HTTPS terms, privacy, and support URLs.
- Mobile Wallet Adapter defaults to `solana:mainnet`.
- Solana Mobile release builds use the `dapp-store` EAS profile and produce a
  signed APK.
- The app review screen shows amount, pool, connected wallet, network,
  and expected ticket/refund behavior before signing.
- Legal and community pages are available through `Links`: Terms, Privacy,
  Support, and future X/Discord placeholders.
- Backend submit relay stays disabled for production.
- Keeper-only lifecycle instructions are constrained by the on-chain
  `KeeperConfig` PDA.
- The production `KeeperConfig` must authorize exactly
  `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`; the systemd unit pins the same
  expected public key.
- New rounds wait at `start_ts=0`, `end_ts=0`; only the first confirmed ticket
  starts the one-hour timer.
- Empty waiting rounds neither rotate nor request ORAO.
- Draw minimums are fixed in the program and mirrored by API/UI: Mini 25 total
  tickets, Normal 13, High 3, and Premium 3 tickets from 3 distinct wallets.
- An expired below-target round requests no ORAO and has no winner; the
  authorized keeper automatically returns complete ticket principal and Entry
  rent to each player after the 600-second refund delay. There is no claim
  transaction, and network fees are not refundable.
- Round and LuckyMe sidecar rent return to on-chain `config.treasury`; Entry rent
  returns to the Entry player. ORAO-owned request accounts are excluded.
- Historical empty-round cleanup uses only the dedicated dry-run-first recovery
  utility and a separately approved plan hash.

## Program ID

Current source Program ID:

```text
4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3
```

Files synchronized to that ID:

- `programs/luckyme/src/lib.rs`
- `Anchor.toml`
- `idl/luckyme.json`
- `sdk/luckyme.ts`
- `scripts/anchor-client.mjs`
- `backend/src/server.mjs`
- `app-seeker/app.json`
- `app-seeker/eas.json`
- `app-seeker/src/LuckyMeScreen.tsx`
- `docs/store-readiness.md`

If the production deployment uses a new Program ID, update all of the above in
the same commit and rebuild the IDL/SDK artifacts.

KeeperConfig PDA for the current Program ID and Config PDA:

```text
8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y
```

The lifecycle upgrade and this `KeeperConfig` initialization were completed on
2026-07-11. That does not deploy the later minimum-ticket/refund binary: current
source is a separate release candidate, the mainnet keeper remains disabled,
and the live API currently reports no active Round for any pool. Until the
separate upgrade is approved, the source/IDL and deployed program intentionally
differ.

## Validation

```bash
npm install
npm test
npm run app:validate:production
npm run app:typecheck
npm --prefix app-seeker run doctor
npm run audit:mainnet-release
cargo check
cargo test
```

## Solana Mobile Docs Scope

Solana Mobile submission scope in this repo is limited to the official store
items: signed APK, metadata, Publisher Portal, KYC/KYB, publisher wallet SOL,
storage provider, Publisher Policy review, and Developer Agreement review.
