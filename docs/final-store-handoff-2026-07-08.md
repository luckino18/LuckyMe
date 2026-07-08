# LuckyMe Final Store Handoff - 2026-07-08

## Final APK

- Artifact:
  `/Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk`
- Size: 113 MB
- Package: `com.luckyme.seeker`
- Version: `1.0.0`
- Version code: `1`
- Min SDK: `24`
- Target SDK: `36`
- SHA-256:
  `c104ec372270dc175d54d26bf472edd9f489813324f66c9a6766df423fc05bc2`

The APK was built with the EAS `dapp-store` profile using EAS-managed Android
credentials `Build Credentials iNPMBDRiCC (default)`.

## Signature Evidence

`apksigner verify --verbose --print-certs` passed.

- APK Signature Scheme v2: true
- Number of signers: 1
- Signer certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`
- Signer certificate SHA-1:
  `7d840dbded97a42b3e59bacf1ffc31dc3ce0159f`
- Key algorithm: RSA
- Key size: 2048

## Production Configuration

- Release mode: `MAINNET_RELEASE`
- Solana cluster: `mainnet-beta`
- Wallet chain: `solana:mainnet`
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Backend: `https://api.lucky-me.app`
- Terms: `https://lucky-me.app/terms`
- Privacy: `https://lucky-me.app/privacy`
- Support: `https://lucky-me.app/support`
- Expo/EAS project ID:
  `e054857c-6dfb-46ec-9d60-09ce2150dcc4`
- WalletConnect Project ID used for web wallet flows:
  `13ad45e384e61cf9c9c391ca0f3ea074`

## Included In This Build

- Mainnet LuckyMe pool UI for Mini, Normal, High, and Premium.
- Final v2 UI correction: no visible Settings/Configuration screen. The
  support/legal screen is now `Links` only, with Terms, Privacy, Support, and
  disabled future X/Discord links.
- Home copy explicitly shows `95% prize / 3% jackpot / 2% treasury`.
- Simplified purchase flow: choose pool, choose ticket count, then wallet signs.
- Real on-chain pool/round state from the production backend.
- No backend player signing and no custodial wallet flow.
- Push notification opt-in and Expo push registration. The final v2 APK uses a
  new opt-in storage key so older dismissed prompts do not suppress this build's
  explainer.
- Round alert backend support: max two alerts per round.
- Dynamic winner share card with WhatsApp, X, Telegram, and PNG download.
- Store URLs for terms, privacy, and support.

## Backend Status

The VPS backend is live on `https://api.lucky-me.app`.

Verified on 2026-07-08:

- `GET /health` returned healthy `MAINNET_RELEASE` mainnet status.
- `GET /config` exposes notification registration at `/notifications/register`.
- Push token register/unregister smoke test passed.
- `npm run push:round-alerts` dry-run passed on the VPS.
- Production backend validator passed.

## Verification Already Run

```bash
npm --prefix app-seeker run typecheck
npm test
npm run audit:mainnet-release
npm run app:validate:production
npm run app:apk:verify
apksigner verify --verbose --print-certs /Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk
shasum -a 256 /Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk
```

Results:

- Typecheck passed.
- Test suite passed: 44/44.
- Mainnet release audit passed.
- Production app env validator passed.
- APK verifier passed.
- APK signature verifier passed.

## Remaining Before Submission

- Install this final APK on the Seeker and do one real-device smoke test.
- Test wallet connect and a low-value wallet signing flow against active mainnet
  rounds.
- Install this final v2 APK on the Seeker and confirm the notification
  explainer/Android permission prompt and token registration on device.
- Prepare final Publisher Portal assets if the portal requires fresh
  screenshots.
- Complete Publisher Portal account/KYC/KYB, storage provider, wallet funding,
  and final release submission.

## Notes

- The local EAS build succeeded first, so the queued cloud build
  `d53bc7a1-0ace-4676-aa5b-8c8dda9ccb6c` was cancelled while still queued.
- `expo-doctor` reported that `expo` is `57.0.2` while the expected patch range
  is `~57.0.4`. This did not block the final APK build or verification, but it
  can be cleaned before a future rebuild.
