# LuckyMe Handoff

Current objective: prepare the repository for a professional Solana Mobile /
Seeker Store mainnet release.

## Current Release Shape

- Release mode: `MAINNET_RELEASE`
- Cluster: `mainnet-beta`
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Mobile wallet chain: `solana:mainnet`
- Randomness: ORAO provider path
- Backend player signing: none
- Backend submit relay: disabled for production
- Production pool fallback: unavailable/error state, not fake data

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

## Remaining Credential Items

- Production HTTPS backend URL.
- Production mainnet RPC URL.
- Publisher Portal account and KYC/KYB.
- Publisher wallet with enough SOL for submission and storage costs.
- Release APK signing key or EAS-managed credentials.
- Signed APK artifact.
- Publisher Portal API key and signer keypair if using the optional CLI path.
- Real mainnet program deployment or confirmation that the synchronized Program
  ID is deployed and initialized on mainnet-beta.

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
