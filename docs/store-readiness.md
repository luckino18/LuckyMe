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

## User-Facing App Requirements

- The main screen presents pool choice, ticket price, jackpot, round status,
  user chance, wallet status, and entry action first.
- Technical data such as mode, cluster, RPC/source details, Program ID,
  treasury, vaults, randomness mode, randomness commitment, and jackpot odds
  sits behind `Details / Transparency`.
- The transaction review shows amount, pool, round, tickets, wallet, Solana
  mainnet, and simulation result before wallet signing. Program ID and other
  account-level details sit behind `Details / Transparency`.
- The backend never signs player transactions and never custodies user funds.

## Final Release Checklist

- APK built with `eas build --platform android --profile dapp-store`.
- APK signed with the release key or EAS-managed release credentials.
- `apksigner verify --print-certs` passes for the final APK.
- Backend production HTTPS URL configured in the EAS environment or secret set.
- App opens without loopback, LAN, or non-mainnet references.
- `EXPO_PUBLIC_LUCKYME_TERMS_URL`, `EXPO_PUBLIC_LUCKYME_PRIVACY_URL`, and
  `EXPO_PUBLIC_LUCKYME_SUPPORT_URL` are final HTTPS URLs.
- Screenshots and icon/adaptive icon assets are ready.
- Publisher Portal account, KYC/KYB, publisher wallet, SOL balance, and storage
  provider are ready.

## Not Solana Mobile Blockers

The cited Solana Mobile docs do not list these as universal submission
artifacts:

- third-party smart-contract audit report;
- written legal opinion;
- uploaded gambling license.

Publisher Policy compliance and truthful user-data disclosures remain publisher
responsibilities, but they are not encoded in this repo as invented release
blockers.

## Remaining Credential-Owned Items

- Real production HTTPS backend URL.
- Real production mainnet RPC URL.
- Final terms, privacy, and support URLs.
- Publisher Portal account and KYC/KYB.
- Publisher wallet with SOL.
- Release signing key or EAS-managed credentials.
- Final signed APK artifact.
- Confirmation that the synchronized Program ID is deployed and initialized on
  mainnet-beta.
