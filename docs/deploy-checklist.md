# Deploy Checklist

This checklist covers the remaining manual deployment steps for the LuckyMe
`MAINNET_RELEASE`. It follows the Solana Mobile requirements for signed APK
submission, metadata, Publisher Portal, KYC/KYB, publisher wallet funding,
storage provider, Publisher Policy, and Developer Agreement.

## 1. Mainnet Program Deployment

- Confirm the synchronized Program ID:
  `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Deploy the Anchor program to Solana `mainnet-beta`.
- Confirm the deployed program account exists on `mainnet-beta`.
- Preserve the deploy logs and program binary hash for release records.

## 2. Program Initialization

- Initialize LuckyMe config with the production authority and treasury.
- Initialize the production pools.
- Confirm config, pool, pool vault, and jackpot vault PDA addresses.
- Open the first production round only after backend and app release env are
  configured.

## 3. Backend HTTPS Deployment

- Set backend production env:

```bash
export LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export LUCKYME_SOLANA_CLUSTER=mainnet-beta
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export LUCKYME_RANDOMNESS_MODE=orao_vrf
export LUCKYME_PRODUCTION_RANDOMNESS=true
export CORS_ORIGIN=https://lucky-me.app
export ENABLE_TRANSACTION_SUBMIT=false
npm run backend:validate:production
npm run backend:start
```

- Deploy behind a production HTTPS URL.
- Confirm `GET /health`, `GET /config`, and `GET /pools` respond from the
  production URL.
- Keep `POST /transactions/submit` disabled unless there is a deliberate
  production relay policy.

## 4. EAS Environment

Configure these values in the EAS project environment or secret set before the
`dapp-store` build:

```bash
EXPO_PUBLIC_LUCKYME_RELEASE_MODE=MAINNET_RELEASE
EXPO_PUBLIC_LUCKYME_STORE_BUILD=true
EXPO_PUBLIC_LUCKYME_API_URL=https://api.lucky-me.app
EXPO_PUBLIC_LUCKYME_WALLET_CHAIN=solana:mainnet
EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL=https://api.mainnet-beta.solana.com
EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER=mainnet-beta
EXPO_PUBLIC_LUCKYME_PROGRAM_ID=4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3
EXPO_PUBLIC_LUCKYME_TERMS_URL=https://lucky-me.app/terms
EXPO_PUBLIC_LUCKYME_PRIVACY_URL=https://lucky-me.app/privacy
EXPO_PUBLIC_LUCKYME_SUPPORT_URL=https://lucky-me.app/support
```

`app-seeker/eas.json` contains HTTPS production-like public defaults so the
`dapp-store` profile cannot miss required public env keys. Before the submitted
build, replace or override those values with the final production API, RPC,
terms, privacy, and support URLs through the Expo dashboard project environment
or the installed EAS CLI environment/secret command supported by that CLI
version. Do not put keystores, private keys, or private operational secrets in
the repository.

Validate before building:

```bash
npm run app:validate:production
npm run app:typecheck
```

## 5. Signed APK Build

Build the Solana Mobile APK:

```bash
npm run app:build:dapp-store
```

Use EAS-managed credentials or a dedicated dApp Store signing key.

Verify the final APK:

```bash
APK_PATH=/path/to/app-release.apk npm run app:apk:verify
```

Record the build URL and verification output in
`docs/final-release-evidence.md`.

## 6. Publisher Portal Submission

- Prepare store metadata, screenshots, app icon, and adaptive icon.
- Create or confirm the Publisher Portal account.
- Complete KYC/KYB.
- Connect the publisher wallet and keep enough SOL for submission and storage
  costs.
- Select the storage provider.
- Upload the signed APK.
- Submit the release in the Publisher Portal and approve required wallet
  signing prompts.
