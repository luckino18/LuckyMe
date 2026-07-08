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
- Final store APK: `/Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk`
- Final APK SHA-256:
  `c104ec372270dc175d54d26bf472edd9f489813324f66c9a6766df423fc05bc2`
- APK signing: EAS-managed Android credentials
  `Build Credentials iNPMBDRiCC (default)`, verified with APK Signature Scheme
  v2. Signer certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.
- Push notifications: APK includes Expo push registration and the VPS backend
  exposes `/notifications/register`. The live register/unregister smoke test
  and keeper dry-run passed on 2026-07-08. The final v2 APK uses a new
  notification prompt key so older dismissed prompts do not suppress this
  build's explainer.
- Final v2 UI correction: `Settings` / `Configuration` was removed from the
  visible app. The legal/community screen is now `Links` only, with Terms,
  Privacy, Support, and future X/Discord placeholders.
- Home copy now states `95% prize / 3% jackpot / 2% treasury`.
- Winner share card: included in the APK/WebView flow as a dynamic,
  responsive card with WhatsApp, X, Telegram, and PNG download actions.

## Main Files Changed In This Pass

- `README.md`
- `SECURITY.md`
- `Anchor.toml`
- `backend/src/server.mjs`
- `backend/src/push-notifications.mjs`
- `app-seeker/App.tsx`
- `app-seeker/src/LuckyMeScreen.tsx`
- `app-seeker/app.json`
- `app-seeker/app.config.js`
- `app-seeker/eas.json`
- `app-seeker/scripts/validate-production-env.mjs`
- `scripts/push-round-alerts.mjs`
- `docs/apk-signing.md`
- `docs/solana-mobile-publishing.md`
- `docs/store-listing/*`
- `scripts/audit-mainnet-release.mjs`
- `scripts/init-pools-ledger.mjs`

## Remaining Credential Items

- Publisher Portal account and KYC/KYB.
- Publisher wallet with enough SOL for submission and storage costs.
- Publisher Portal API key and signer keypair if using the optional CLI path.
- Post-deploy real-device wallet entry test against the active mainnet rounds.
- Final Publisher Portal submission and storage provider selection.

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

Final store APK verification commands:

```bash
npm run app:apk:verify
apksigner verify --verbose --print-certs /Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk
shasum -a 256 /Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk
```

## Mainnet Operations Notes

- The successful deployment used a temporary local fee-payer/buffer wallet for
  program upload, then set the final upgrade authority to the Ledger authority
  `AApgo...`.
- `npm run init:pools:ledger` initializes config/pools with a Ledger authority
  while using a local fee payer for transaction fees.
- The temporary deployment wallet was drained after setup and verified at
  `0 SOL`.
- The 32-character value `13ad45e384e61cf9c9c391ca0f3ea074` is treated as the
  WalletConnect Project ID for web wallet flows. The Expo/EAS project ID used
  by the APK for push tokens is
  `e054857c-6dfb-46ec-9d60-09ce2150dcc4`.
