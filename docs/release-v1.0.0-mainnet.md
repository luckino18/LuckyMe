# LuckyMe v1.0.0 Mainnet Release

Current target: `v1.0.0-mainnet` for Solana Mobile / Seeker dApp Store
submission.

## Historical Release Note

Historical `v0.1.x-devnet` GitHub releases are obsolete and are not the store
target. Keep them as historical GitHub artifacts only; do not use their copy,
screenshots, APKs, or metadata for this release.

## Final Validation Commands

Run these before building the final APK:

```bash
npm test
npm run app:validate:production
npm run app:typecheck
npm --prefix app-seeker run doctor
npm run audit:mainnet-release
cargo check
cargo test
```

## EAS dApp Store APK Build

Build the signed dApp Store APK with the `dapp-store` EAS profile:

```bash
eas build --platform android --profile dapp-store
```

The root wrapper is also available:

```bash
npm run app:build:dapp-store
```

## APK Signature Verification

After downloading or producing the final APK, verify the signing certificate:

```bash
apksigner verify --print-certs final.apk
```

The root wrapper accepts an explicit APK path:

```bash
APK_PATH=/path/to/final.apk npm run app:apk:verify
```

## Publisher Portal Submission Checklist

- Signed APK built from the production `dapp-store` profile.
- Metadata ready: app name, description, screenshots, icon, adaptive icon, and
  support/privacy/terms links.
- Publisher Portal account ready.
- KYC/KYB completed.
- Publisher wallet connected and funded with SOL for submission and storage.
- Storage provider selected for APK and asset uploads.
- Publisher Policy and Developer Agreement reviewed.
- First release version created, APK uploaded, and required wallet prompts
  approved in the Publisher Portal.

## Production Safety That Must Stay

- HTTPS backend validation.
- Mainnet wallet chain validation.
- Mainnet RPC validation.
- ORAO VRF production randomness.
- Backend never signs player transactions.
- Production pool reads do not fall back to fake pools.

## Mainnet Deployment Status

- Program deployed on 2026-07-07 at
  `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Upgrade/config authority:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`.
- Config and all four pools are initialized on `mainnet-beta`.
- The first active production round is open for Mini, Normal, High, and
  Premium.

## Acceptance Checklist

- `npm test`
- `npm run app:validate:production`
- `npm run app:typecheck`
- `npm --prefix app-seeker run doctor`
- `npm run audit:mainnet-release`
- `cargo check`
- `cargo test`
- `eas build --platform android --profile dapp-store`
- `apksigner verify --print-certs final.apk`

## Requires Real Credentials Or Infrastructure

- Production HTTPS backend URL.
- Production mainnet RPC URL.
- ORAO VRF provider production configuration.
- EAS account/project access and release signing credentials.
- Publisher Portal account with completed KYC/KYB.
- Publisher wallet with SOL.
- Storage provider funding/configuration.
- Final terms, privacy, and support URLs.
