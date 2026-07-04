# LuckyMe

LuckyMe is a Solana mobile-first luck pool game for fixed-entry rounds. Users
connect a Solana wallet, choose a pool, review the ticket transaction, and sign
with their wallet. Pool math is transparent: fixed ticket price, total tickets,
winner chance, prize, jackpot contribution, and treasury fee. Results and
payouts are executed by the Solana program.

## Product Overview

- Network target: Solana mainnet-beta
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Mobile app: Expo React Native with Mobile Wallet Adapter
- Backend: transaction builder and public state API
- Randomness mode: ORAO VRF provider path for `MAINNET_RELEASE`
- Player custody: the backend never signs player transactions and never
  custodies user funds
- Release mode: `MAINNET_RELEASE`

The app builds and reviews an unsigned transaction, the connected wallet signs
it, and the backend submit relay is disabled by default. Users see the amount,
pool, connected wallet, Solana mainnet network, Program ID, simulation result,
and expected ticket behavior before signing.

## Repository Layout

```text
programs/luckyme/        Anchor program
idl/                     Generated IDL
sdk/                     TypeScript IDL type helper
scripts/                 Operator and keeper transaction builders
backend/                 Public state API and transaction builders
app-seeker/              Solana Mobile / Seeker Expo app
docs/                    Publishing, APK signing, operations, and handoff docs
tests/                   Node and Anchor integration tests
sim/                     Economic simulator and unit tests
```

## Mainnet Environment

Required backend variables for `MAINNET_RELEASE`:

```bash
export LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export LUCKYME_SOLANA_CLUSTER=mainnet-beta
export ANCHOR_PROVIDER_URL=https://your-mainnet-rpc.example
export LUCKYME_RANDOMNESS_MODE=orao_vrf
export LUCKYME_PRODUCTION_RANDOMNESS=true
export CORS_ORIGIN=https://your-production-app.example
export ENABLE_TRANSACTION_SUBMIT=false
```

Required app variables for the dApp Store APK build:

```bash
export EXPO_PUBLIC_LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export EXPO_PUBLIC_LUCKYME_STORE_BUILD=true
export EXPO_PUBLIC_LUCKYME_API_URL=https://your-production-api.example
export EXPO_PUBLIC_LUCKYME_WALLET_CHAIN=solana:mainnet
export EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL=https://your-mainnet-rpc.example
export EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER=mainnet-beta
export EXPO_PUBLIC_LUCKYME_PROGRAM_ID=4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3
```

Release validation rejects missing env, localhost/LAN backend URLs, non-HTTPS
mainnet RPC URLs, non-mainnet wallet chain values, and production commit-reveal
randomness.

## Backend Setup

```bash
npm install
npm run app:validate:production
node backend/src/server.mjs
```

Important backend behavior:

- `GET /config` exposes release mode, cluster, Program ID, randomness mode,
  economics, and public release checks.
- `GET /pools` reads the Solana program state. In `MAINNET_RELEASE`, unavailable
  on-chain state returns an unavailable/error state rather than fake pool data.
- `POST /transactions/buy-tickets` builds and simulates an unsigned ticket
  transaction for the connected wallet.
- `POST /transactions/refund-entry` builds and simulates an unsigned refund
  transaction when refund state is available.
- `POST /transactions/request-randomness` and
  `POST /transactions/settle-provider-round` support the ORAO keeper flow.
- `POST /transactions/submit` is disabled unless explicitly enabled; keep it
  disabled for production.

## App Build

```bash
cd app-seeker
npm install
npm run validate:production
npm run typecheck
npm run doctor
```

The app defaults wallet authorization to `solana:mainnet` and uses
`https://api.mainnet-beta.solana.com` as the fallback wallet RPC. The dApp Store
profile still requires explicit production env through
`app-seeker/scripts/validate-production-env.mjs` and `app-seeker/app.config.js`.

Build the Solana dApp Store APK with EAS:

```bash
cd app-seeker
eas build --platform android --profile dapp-store
```

For a local build with Android SDK/NDK installed:

```bash
cd app-seeker
eas build --platform android --profile dapp-store --local
```

## APK Signing And Verification

The Solana dApp Store accepts signed APK files. `app-seeker/eas.json` contains a
`dapp-store` profile with `android.buildType` set to `apk`.

Create a dedicated dApp Store signing key if you manage signing locally:

```bash
keytool -genkey -v -keystore luckyme-dapp-store.keystore \
  -alias luckyme-dapp-store \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Verify the signed APK:

```bash
apksigner verify --print-certs app-release.apk
```

Do not commit keystores, key passwords, Expo credentials, Solana keypairs, or
Publisher Portal API keys.

## Solana Mobile Publishing Checklist

Based on the official Solana Mobile dApp Store docs:

- Prepare a release-ready APK signed with the release key.
- Prepare app metadata: name, description, screenshots, and icon.
- Use a Solana browser-extension wallet with enough SOL for submission fees and
  storage costs.
- Review the Publisher Policy and Developer Agreement.
- Create a Publisher Account in the Publisher Portal and complete KYC/KYB.
- Connect the publisher wallet and keep access to it for future submissions.
- Set the storage provider for APK and asset uploads.
- Add LuckyMe app details and submit the first release version.
- After submission, monitor the publisher email for review results.

Optional CLI path:

```bash
npm install -g @solana-mobile/dapp-store-cli
export DAPP_STORE_API_KEY=<publisher-portal-api-key>
dapp-store \
  --apk-file ./app-release.apk \
  --keypair ./publisher-keypair.json \
  --whats-new "$(cat docs/store-listing/whats-new-v1.0.0.txt)"
```

The CLI path requires an app already created in the Publisher Portal, an App NFT
minted, a signed APK, a Solana signer keypair, and a Publisher Portal API key.

## Store Metadata

Store listing material is in `docs/store-listing/`:

- `short-description.txt`
- `full-description.md`
- `whats-new-v1.0.0.txt`
- `screenshot-checklist.md`
- `icon-adaptive-icon-checklist.md`
- `privacy-policy.md`
- `support-contact.md`
- `category.txt`

The privacy placeholder is included because the backend may receive wallet
addresses and request metadata while serving state and transaction builders.

Store readiness is tracked in `docs/store-readiness.md`; it uses the same
`MAINNET_RELEASE`, `solana:mainnet`, `mainnet-beta`, and signed APK release
positioning as this README.

## Solana Mobile Docs Scope

The official Solana Mobile docs specify APK signing, metadata, Publisher Portal
account/KYC, wallet funding for submission/storage costs, Publisher Policy,
Developer Agreement, and optional publishing CLI requirements.

Not specified by the cited Solana Mobile docs as universal submission artifacts:

- a third-party smart-contract audit report;
- a written legal opinion;
- an uploaded gambling license.

The Publisher Policy still requires submitted assets, content, transactions, and
user-data practices to comply with the policy and applicable law. That is a
publisher responsibility, not a repo-side build blocker encoded in LuckyMe.

## Validation Commands

```bash
npm install
npm test
npm run app:validate:production
npm run app:typecheck
npm --prefix app-seeker run doctor
cargo check
cargo test
NO_DNA=1 anchor build --provider.cluster localnet
npm run test:anchor
```

For production backend smoke testing:

```bash
LUCKYME_RELEASE_MODE=MAINNET_RELEASE \
LUCKYME_SOLANA_CLUSTER=mainnet-beta \
ANCHOR_PROVIDER_URL=https://your-mainnet-rpc.example \
LUCKYME_RANDOMNESS_MODE=orao_vrf \
LUCKYME_PRODUCTION_RANDOMNESS=true \
CORS_ORIGIN=https://your-production-app.example \
ENABLE_TRANSACTION_SUBMIT=false \
node backend/src/server.mjs
```
