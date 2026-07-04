# LuckyMe Seeker App

Expo React Native app for the LuckyMe Solana mobile-first luck pool game.

## Release Env

```bash
export EXPO_PUBLIC_LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export EXPO_PUBLIC_LUCKYME_STORE_BUILD=true
export EXPO_PUBLIC_LUCKYME_API_URL=https://your-production-api.example
export EXPO_PUBLIC_LUCKYME_WALLET_CHAIN=solana:mainnet
export EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL=https://your-mainnet-rpc.example
export EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER=mainnet-beta
export EXPO_PUBLIC_LUCKYME_PROGRAM_ID=4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3
```

The release validator rejects missing variables, localhost/LAN backend URLs,
non-HTTPS backend/RPC URLs, non-mainnet wallet chain values, and malformed
Program IDs.

## Commands

```bash
npm install
npm run validate:production
npm run typecheck
npm run doctor
eas build --platform android --profile dapp-store
```

For a local EAS build:

```bash
eas build --platform android --profile dapp-store --local
```

## Wallet And Signing Flow

- Mobile Wallet Adapter defaults to `solana:mainnet`.
- The backend builds and simulates unsigned transactions.
- The app displays amount, pool, connected wallet, Solana mainnet, Program ID,
  simulation result, and expected ticket/refund behavior before signing.
- The connected wallet signs the transaction.
- The backend does not hold user private keys and does not sign player
  transactions.

## Error States

The UI has explicit states for missing wallet support, rejected wallet requests,
insufficient SOL, failed simulation, stale or closed rounds, backend
unavailability, RPC failures, settlement, and refund mode.

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
apksigner verify --print-certs app-release.apk
```
