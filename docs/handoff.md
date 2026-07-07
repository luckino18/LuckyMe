# LuckyMe Handoff

Current objective: operate the deployed LuckyMe `MAINNET_RELEASE` Solana Mobile
/ Seeker Store release candidate.

## Current Release Shape

- Release mode: `MAINNET_RELEASE`
- Cluster: `mainnet-beta`
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Mainnet deploy tx:
  `Euf5ociVf2MyeyVpypC7EcwyQgnWBvsnuqhuxPGSMCeta9Ho1u7dKNGiLFczKbwkamjZMf8Ajb6Ykbj4mMXAP8N`
- Upgrade/config authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`
- Backend: `https://api.lucky-me.app`
- Mobile wallet chain: `solana:mainnet`
- Randomness: ORAO provider path
- Backend player signing: none
- Backend submit relay: disabled for production
- Production pool fallback: unavailable/error state, not fake data
- On-chain status on 2026-07-07: config initialized, all four pools
  initialized, and first active round opened for Mini, Normal, High, and
  Premium.

## Main Files Changed In This Pass

- `README.md`
- `SECURITY.md`
- `Anchor.toml`
- `backend/src/server.mjs`
- `app-seeker/App.tsx`
- `app-seeker/src/LuckyMeScreen.tsx`
- `app-seeker/app.json`
- `app-seeker/app.config.js`
- `app-seeker/eas.json`
- `app-seeker/scripts/validate-production-env.mjs`
- `docs/apk-signing.md`
- `docs/solana-mobile-publishing.md`
- `docs/store-listing/*`
- `scripts/audit-mainnet-release.mjs`
- `scripts/init-pools-ledger.mjs`

## Remaining Credential Items

- Publisher Portal account and KYC/KYB.
- Publisher wallet with enough SOL for submission and storage costs.
- Release APK signing key or EAS-managed credentials.
- Signed APK artifact.
- Publisher Portal API key and signer keypair if using the optional CLI path.
- Post-deploy real-device wallet entry test against the active mainnet rounds.

## Validation Commands

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

## Mainnet Operations Notes

- The successful deployment used a temporary local fee-payer/buffer wallet for
  program upload, then set the final upgrade authority to the Ledger authority
  `AApgo...`.
- `npm run init:pools:ledger` initializes config/pools with a Ledger authority
  while using a local fee payer for transaction fees.
- The temporary deployment wallet was drained after setup and verified at
  `0 SOL`.
