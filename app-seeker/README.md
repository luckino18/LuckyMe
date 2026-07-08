# LuckyMe Seeker App

Expo React Native app for the LuckyMe Solana Mobile / Seeker Store release.

## MAINNET_RELEASE

Production builds target:

- release mode: `MAINNET_RELEASE`
- wallet chain: `solana:mainnet`
- Solana cluster: `mainnet-beta`
- Android artifact: signed APK through the EAS `dapp-store` profile
- backend: production HTTPS API only

The production app reads real backend and on-chain state. It must not depend on
local fallback pool data for store builds.

## Production Environment

Set these variables before running validation or building the store APK:

```bash
export EXPO_PUBLIC_LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export EXPO_PUBLIC_LUCKYME_STORE_BUILD=true
export EXPO_PUBLIC_LUCKYME_API_URL=https://api.lucky-me.app
export EXPO_PUBLIC_LUCKYME_WALLET_CHAIN=solana:mainnet
export EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL=https://api.mainnet-beta.solana.com
export EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER=mainnet-beta
export EXPO_PUBLIC_LUCKYME_PROGRAM_ID=4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3
export EXPO_PUBLIC_LUCKYME_TERMS_URL=https://lucky-me.app/terms
export EXPO_PUBLIC_LUCKYME_PRIVACY_URL=https://lucky-me.app/privacy
export EXPO_PUBLIC_LUCKYME_SUPPORT_URL=https://lucky-me.app/support
```

For EAS cloud builds, configure `EXPO_PUBLIC_LUCKYME_API_URL`,
`EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL`, `EXPO_PUBLIC_LUCKYME_TERMS_URL`,
`EXPO_PUBLIC_LUCKYME_PRIVACY_URL`, and `EXPO_PUBLIC_LUCKYME_SUPPORT_URL` in the
EAS project environment or as EAS secrets before running the `dapp-store`
profile. Do not hardcode loopback, LAN, or non-HTTPS URLs.

The release validators reject missing variables, loopback/LAN backend URLs,
non-HTTPS backend/RPC URLs, non-mainnet wallet chain values, malformed Program
IDs, and placeholder policy/support URLs.

## Commands

```bash
npm install
npm run validate:production
npm run typecheck
npm run doctor
npm run build:dapp-store
```

For a local EAS build:

```bash
eas build --platform android --profile dapp-store --local
```

## Wallet And Signing Flow

- Mobile Wallet Adapter uses `solana:mainnet` in production.
- The backend builds and simulates unsigned transactions.
- The app displays amount, pool, connected wallet, Solana mainnet, simulation
  result, and expected ticket/refund behavior before signing.
- Program, vault, cluster, randomness, commitment, treasury, source, and
  jackpot-odds details are available in `Details / Transparency`.
- The connected wallet signs the transaction.
- The backend does not hold user private keys and does not sign player
  transactions.

## Error States

The UI has explicit states for missing wallet support, rejected wallet requests,
insufficient SOL, failed simulation, stale or closed rounds, backend
unavailability, RPC failures, settlement, and refund mode.

## APK Engagement Features

- First-run notification explainer is implemented before the Android permission
  request. Copy says alerts are only for pool starts and near-close reminders.
- APK notification policy is max two alerts per active round per opted-in
  device: one when the first ticket starts a pool countdown, and one at 10
  minutes remaining.
- Accepted Expo push tokens are registered with the backend through
  `/notifications/register` and persisted server-side for the keeper sender.
- Deep links are implemented for `luckyme://pools` and
  `luckyme://winner?pool=...&round=...&amount=...&wallet=...`.
- Post-win winner card sharing is implemented as a standalone WebView screen
  with WhatsApp, X, Telegram, and Download PNG actions. The screen is populated
  dynamically from settlement/deep-link data and does not expose wallet
  addresses beyond the shortened public winner address.

The backend keeper sender is `npm run push:round-alerts`. It reads confirmed
on-chain rounds and sends the two alert types only after tickets exist in the
round. It is dry-run by default; production delivery requires
`LUCKYME_PUSH_SEND=true`.

## APK Profile

`eas.json` contains a `dapp-store` profile:

```json
{
  "build": {
    "dapp-store": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

Verify a signed APK with:

```bash
APK_PATH=/path/to/app-release.apk npm run apk:verify
```

## Local Development Only

Use local development mode only for engineering and simulator workflows, never
for store screenshots, release copy, or signed store APKs.

```bash
export EXPO_PUBLIC_LUCKYME_RELEASE_MODE=LOCAL_DEVELOPMENT
export EXPO_PUBLIC_LUCKYME_STORE_BUILD=false
export EXPO_PUBLIC_LUCKYME_API_URL=http://localhost:8788
npm start
```
