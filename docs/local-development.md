# Local Development

Local development uses a local validator and may use `commit_reveal_demo` for
fast program tests.

## Backend

```bash
LUCKYME_RELEASE_MODE=LOCAL_DEVELOPMENT \
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
LUCKYME_RANDOMNESS_MODE=commit_reveal_demo \
node backend/src/server.mjs
```

## App

```bash
cd app-seeker
EXPO_PUBLIC_LUCKYME_RELEASE_MODE=LOCAL_DEVELOPMENT \
EXPO_PUBLIC_LUCKYME_API_URL=http://localhost:8788 \
EXPO_PUBLIC_LUCKYME_WALLET_CHAIN=solana:mainnet \
EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL=https://api.mainnet-beta.solana.com \
EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER=mainnet-beta \
npm run start:go
```

The production APK profile should use `MAINNET_RELEASE`, not the local
development mode.
