# Solana dApp Store / Seeker Store Readiness

## Current Verdict

- `DEVNET_STORE_DEMO` ready for technical review: mostly yes, pending final APK
  signing assets and publisher portal details.
- `MAINNET_BETA_CANDIDATE` ready: no.
- Real-money launch ready: no.

## Ready

- Mobile-first Seeker app prototype.
- Visible devnet/no-real-funds banner.
- Fee, pool, treasury, vault, cluster, randomness, and refund transparency.
- Mobile Wallet Adapter transaction review before signing.
- Backend read/build paths do not require a private wallet.
- Submit relay disabled by default.
- CI runs simulator tests, app typecheck, Expo doctor, cargo check/test, Anchor
  build, and Anchor localnet tests.
- Refund discovery and cranking tooling exists.
- ORAO provider-randomness path exists behind `LUCKYME_RANDOMNESS_MODE=orao_vrf`
  with sidecar state, backend builders, keeper scripts, and local state-machine
  tests.

## Not Ready

- Production randomness still needs live funded devnet ORAO request,
  fulfillment, and settlement evidence before any mainnet claim.
- Legal/compliance review not complete.
- Mainnet multisig authority handover not complete.
- Release APK, icon, screenshots, privacy URL, terms URL, support URL, and
  publisher KYC/KYB are not completed in this repo.

## DEVNET_STORE_DEMO Submission Steps

1. Start backend on devnet with `LUCKYME_RELEASE_MODE=DEVNET_STORE_DEMO`.
2. Confirm `GET /config` returns devnet, 98/1/1 economics, and the intended
   randomness mode. Store demo can use `commit_reveal_demo`; ORAO review runs
   should use `orao_vrf`.
3. Build a signed release APK with `EXPO_PUBLIC_LUCKYME_API_URL` pointing to the
   review backend.
4. Capture screenshots showing the devnet banner, pool screen, transparency
   panel, transaction review, and safety section.
5. Prepare store metadata and URLs.
6. Submit through the Solana dApp Publisher Portal.

## APK Build Steps

```bash
npm install --prefix app-seeker --omit=optional
cd app-seeker
EXPO_PUBLIC_LUCKYME_STORE_BUILD=true \
EXPO_PUBLIC_LUCKYME_RELEASE_MODE=DEVNET_STORE_DEMO \
EXPO_PUBLIC_LUCKYME_API_URL=https://<review-backend> \
npm run prebuild:android
```

Use a real release keystore and secure it outside the repository. Do not commit
keystores, private keys, publisher wallets, or API secrets.

## Required Assets

- icon
- screenshots
- title: `LuckyMe`
- short description
- long description
- category: Games
- website URL
- support contact URL/email
- privacy policy URL
- terms URL
- release notes

## Publisher Portal Checklist

- Publisher account created.
- KYC/KYB completed.
- Publisher wallet funded for submission fees and storage costs.
- Storage provider selected.
- APK uploaded.
- Metadata and screenshots match the app.
- Policy and developer agreement reviewed before signing.

Solana Mobile's submission docs currently require a signed APK, metadata,
publisher wallet, sufficient SOL, publisher profile/KYC/KYB, storage provider,
and review of policy/developer agreement.

## Policy Compliance Checklist

- No real-money claims in devnet demo.
- No hidden private-key handling.
- No remote script execution or hidden downloads.
- No unnecessary Android permissions.
- No misleading screenshots or descriptions.
- Gambling/legal risk disclosed.
- Privacy and support links present.

## Security Checklist

- Backend submit relay disabled by default.
- Backend refuses unsafe production/mainnet config.
- App fails loudly if store build has no API URL.
- Transaction review shown before wallet signing.
- Program id and cluster visible.
- Randomness mode and proof/status visible.
