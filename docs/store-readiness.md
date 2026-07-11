# Store Readiness

LuckyMe is prepared as a `MAINNET_RELEASE` Solana Mobile / Seeker Store
candidate.

## Release Alignment

- Release mode: `MAINNET_RELEASE`
- Wallet chain: `solana:mainnet`
- Solana cluster: `mainnet-beta`
- App package: `com.luckyme.seeker`
- Version: `1.1.0` (`versionCode 3`)
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
- Historical v1.0 store APK v2 built on 2026-07-08:
  `/Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk`
- Historical APK SHA-256:
  `c104ec372270dc175d54d26bf472edd9f489813324f66c9a6766df423fc05bc2`
- Historical APK signing verified with APK Signature Scheme v2 using EAS-managed
  Android credentials `Build Credentials iNPMBDRiCC (default)`.
- Minimum-ticket release-candidate APK `1.1.0` / code `3` completed as EAS build
  `52056b37-8b78-44fc-b30b-0319a96c92cb`; its verified Desktop copy is
  `/Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-1.1.0-2026-07-11.apk`
  with SHA-256
  `b0da48983e84fd361fe27e06a6ac3d5193b7fb9d0f04621ca963dbc6321af42d`.
- The code-3 APK uses the expected EAS certificate
  `e249bc55...2067`, passes v2 signature and ZIP checks, embeds the production
  Program ID/API/mainnet configuration, and contains the LuckyMe adaptive/round
  launcher artwork.
- The synchronized Program ID and lifecycle upgrade are deployed on
  mainnet-beta, but the later minimum-ticket program source is not. The live API
  currently returns `activeRound: null` for every pool and keeper writes remain
  disabled.
- The VPS backend exposes Expo push notification registration and the push
  keeper dry-run passed against the production configuration.

## User-Facing App Requirements

- The main screen presents pool choice, ticket price, jackpot, round status,
  user chance, wallet status, and entry action first.
- Legal and community navigation is limited to `Links`: Terms, Privacy,
  Support, and future X/Discord placeholders.
- The entry flow shows amount, pool, round, tickets, wallet, and Solana
  mainnet before wallet signing.
- Each pool shows verified progress toward `25 / 13 / 3 / 3`; copy explains
  total tickets versus Premium's three-wallet rule and the automatic full
  principal + Entry-rent refund if the applicable target is missed.
- How to Play explains the one-hour first-ticket timer, targets, winner path,
  automatic refund path, and non-refundable Solana network fees without
  exposing operational details.
- Winners can use the responsive share card with WhatsApp, X, Telegram, and PNG
  download actions once round winner data is available.
- The backend never signs player transactions and never custodies user funds.

## Final Release Checklist

- APK built with `eas build --platform android --profile dapp-store`: completed
  and verified for `1.1.0` / code `3`; evidence is in
  `docs/seeker-apk-1.1.0-verification-2026-07-11.md`.
- APK must remain signed with EAS-managed release credentials and the expected
  certificate recorded in the handoff.
- `apksigner verify --print-certs` must pass for the `1.1.0` APK before use.
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
- Post-approval real-device wallet entry test against a separately opened
  mainnet round.
- Install/launch/navigation/Mobile Wallet Adapter smoke test for the code-3 APK
  on Seeker; no ADB device was connected during build verification.
