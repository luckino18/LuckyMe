# Deploy Checklist

This checklist covers the remaining manual deployment steps for the LuckyMe
`MAINNET_RELEASE`. It follows the Solana Mobile requirements for signed APK
submission, metadata, Publisher Portal, KYC/KYB, publisher wallet funding,
storage provider, Publisher Policy, and Developer Agreement.

## 1. Mainnet Program Deployment

- Completed on 2026-07-07 for synchronized Program ID:
  `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Deploy tx:
  `Euf5ociVf2MyeyVpypC7EcwyQgnWBvsnuqhuxPGSMCeta9Ho1u7dKNGiLFczKbwkamjZMf8Ajb6Ykbj4mMXAP8N`.
- Confirmed program account on `mainnet-beta`:
  owner `BPFLoaderUpgradeab1e11111111111111111111111`, executable `true`,
  ProgramData `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`, authority
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.

## 2. Program Initialization

- Completed on 2026-07-07 with production authority
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds` and treasury
  `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`.
- Config PDA: `Cvx2ffKnwanpUZGsDBKyo2uwoo6gjucQmrRZpiYVyKh`.
- Pool PDAs: Mini `AgZCfxkrsUb5iYaR1DhANVdM133hBgGzB2TPZaExiGRv`, Normal
  `14mtJnGcu3ASaM5ZvzsUcn2ZGjPR73tv5Fug9UWjSj9s`, High
  `PL7Yn89kfs9FjVWcuHXcN6vcHkiN8wPABvE9L1bUH61`, Premium
  `9jBXss91gNEDLpjbRymWpn561GoDFdaxHd6iyXHKGTtp`.
- First production rounds opened for all four pools after backend and app env
  were already configured.

## 2.1 July 11 lifecycle completion

The lifecycle program upgrade, production `KeeperConfig` initialization, and
approved Stage 2 cleanup are complete. All 18 eligible legacy empty Round
accounts were closed in batches of at most four, returning exactly
`0.05211648 SOL` to treasury. The funded Mini round was excluded. The upload
buffer was closed and its remainder swept back to the Ledger authority.

Execution evidence:

- `docs/mainnet-stage1-execution-2026-07-11.md`
- `docs/mainnet-stage1-upgrade-evidence-2026-07-11.json`
- `docs/mainnet-stage2-rent-recovery-execution-2026-07-11.md`
- `docs/mainnet-stage2-rent-recovery-evidence-2026-07-11.json`

Current live state is deliberately idle: `activeRound: null` for every pool,
the keeper timer is disabled and inactive, and no new waiting round was opened.

## 2.2 Minimum-ticket/refund upgrade completed

The fixed targets `25 / 13 / 3 / 3`, Premium's three-wallet rule, no-ORAO
refund mode, automatic keeper-only refunds, API/UI progress, and How to Play
were deployed on 2026-07-12. The program is at slot `432325448`; the matching
backend/site public smoke checks passed.

Execution evidence is in
`docs/mainnet-minimum-tickets-upgrade-execution-2026-07-12.md`. The upload
buffer rent was recovered and the temporary payer swept to zero.

No round opening, keeper funding, write override, or keeper start is authorized
merely by this checklist. Those operational actions remain separate.

## 3. Backend HTTPS Deployment

- Set backend production env:

```bash
export LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export LUCKYME_SOLANA_CLUSTER=mainnet-beta
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export LUCKYME_RANDOMNESS_MODE=orao_vrf
export LUCKYME_PRODUCTION_RANDOMNESS=true
export CORS_ORIGIN=https://lucky-me.app,https://www.lucky-me.app
export ENABLE_TRANSACTION_SUBMIT=false
npm run backend:validate:production
npm run backend:start
```

- Deployed behind production HTTPS URL `https://api.lucky-me.app`.
- Confirmed `GET /config` and `GET /pools` respond from the production URL with
  `source: onchain`; after Stage 2, `GET /pools` reports `activeRound: null` for
  all four pools until separately approved rounds are opened.
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
