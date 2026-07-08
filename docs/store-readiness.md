# Store Readiness

LuckyMe is prepared as a `MAINNET_RELEASE` Solana Mobile / Seeker Store
candidate.

## Release Alignment

- Release mode: `MAINNET_RELEASE`
- Wallet chain: `solana:mainnet`
- Solana cluster: `mainnet-beta`
- App package: `com.luckyme.seeker`
- Version: `1.0.0`
- EAS profile: `dapp-store`
- Android artifact: signed APK
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`

Local validator flows are developer/testing mode only. They are not the store
positioning and must not be used for production screenshots or release copy.

## Solana Mobile Submission Items

Based on the official Solana Mobile publishing docs, prepare:

- release-ready APK signed with the release key;
- app metadata: name, description, screenshots, and icon;
- Publisher Portal account with KYC/KYB complete;
- publisher wallet with enough SOL for submission and storage costs;
- Publisher Policy and Developer Agreement review;
- storage provider selection;
- first release submission in the Publisher Portal.

## Current Repository Support

- `app-seeker/eas.json` builds an APK through the `dapp-store` profile.
- `app-seeker/App.tsx` defaults Mobile Wallet Adapter to `solana:mainnet`.
- `app-seeker/src/LuckyMeScreen.tsx` defaults release UI to
  `MAINNET_RELEASE` / `mainnet-beta`.
- `app-seeker/app.config.js` and
  `app-seeker/scripts/validate-production-env.mjs` reject missing production
  env, loopback/LAN backends, non-HTTPS backend/RPC URLs, non-mainnet wallet chain,
  and malformed Program IDs.
- `README.md` and `docs/mainnet-readiness.md` document the same release mode,
  wallet chain, cluster, APK profile, and remaining credential-owned items.
- Victor reported the signed Seeker build tested on a Seeker phone on
  2026-07-07.
- Final store APK built on 2026-07-08:
  `/Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-2026-07-08.apk`
- Final APK SHA-256:
  `bb83e7f14f287fc0bd781d6cae4769ba94b2243565ab439e13455e5c176567e4`
- Final APK signing verified with APK Signature Scheme v2 using EAS-managed
  Android credentials `Build Credentials iNPMBDRiCC (default)`.
- The synchronized Program ID is deployed and initialized on mainnet-beta.
  `GET https://api.lucky-me.app/pools` returns `source: onchain` and active
  round `1` for Mini, Normal, High, and Premium.
- The VPS backend exposes Expo push notification registration and the push
  keeper dry-run passed against the production configuration.

## User-Facing App Requirements

- The main screen presents pool choice, ticket price, jackpot, round status,
  user chance, wallet status, and entry action first.
- Technical data such as mode, cluster, RPC/source details, Program ID,
  treasury, vaults, randomness mode, randomness commitment, and jackpot odds
  sits behind `Details / Transparency`.
- The entry flow shows amount, pool, round, tickets, wallet, and Solana
  mainnet before wallet signing. Program ID and other account-level details sit
  behind transparency/details views, not in the primary purchase UI.
- Winners can use the responsive share card with WhatsApp, X, Telegram, and PNG
  download actions once round winner data is available.
- The backend never signs player transactions and never custodies user funds.

## Final Release Checklist

- APK built with `eas build --platform android --profile dapp-store`: done.
- APK signed with EAS-managed release credentials: done.
- `apksigner verify --print-certs` passes for the final APK: done.
- Backend production HTTPS URL configured in the EAS environment: done.
- App opens without loopback, LAN, or non-mainnet references: validator passed.
- `EXPO_PUBLIC_LUCKYME_TERMS_URL`, `EXPO_PUBLIC_LUCKYME_PRIVACY_URL`, and
  `EXPO_PUBLIC_LUCKYME_SUPPORT_URL` point at final HTTPS URLs.
- Screenshots and icon/adaptive icon assets are ready or refreshed for the
  final portal submission.
- Publisher Portal account, KYC/KYB, publisher wallet, SOL balance, and storage
  provider must be ready before submission.

## Remaining Credential-Owned Items

- Publisher Portal account and KYC/KYB.
- Publisher wallet with SOL.
- Publisher Portal storage provider and final submission.
- Post-deploy real-device wallet entry test against the active mainnet rounds.
