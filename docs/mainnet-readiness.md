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
  simulation result, and expected ticket/refund behavior before signing.
- Program ID, mode, cluster, randomness, commitment, source/RPC, treasury,
  vaults, and jackpot odds are available in the expandable
  `Details / Transparency` panel.
- Backend submit relay stays disabled for production.

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
