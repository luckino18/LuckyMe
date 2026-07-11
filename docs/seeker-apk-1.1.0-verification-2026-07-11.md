# Seeker APK 1.1.0 verification — 2026-07-11

Status: **EAS cloud build complete and artifact verified.** This is the signed
test APK for the minimum-ticket/refund release candidate. It does not imply that
the matching program, backend, site, or keeper has been deployed to mainnet.

## Artifact

- EAS build ID: `52056b37-8b78-44fc-b30b-0319a96c92cb`
- EAS artifact:
  `https://expo.dev/artifacts/eas/Lqx36OarEahVKfnzetcsla_jYoBk2DatmMZUFpntNfU.apk`
- Completed: `2026-07-11T20:15:01.351Z`
- Desktop copy:
  `/Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-1.1.0-2026-07-11.apk`
- File size: `118196973` bytes (approximately 112.7 MiB)
- SHA-256:
  `b0da48983e84fd361fe27e06a6ac3d5193b7fb9d0f04621ca963dbc6321af42d`
- Package: `com.luckyme.seeker`
- Version: `1.1.0` (`versionCode 3`)
- Android SDK: minimum `24`, target `36`, compile `36`
- Native ABIs: `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`
- ZIP integrity: passed

## Signing

- EAS credentials: `Build Credentials iNPMBDRiCC (default)`
- Signers: `1`
- Signature scheme: APK Signature Scheme v2 passed; v1, v3, v3.1, and v4 are
  absent, as expected for this EAS artifact.
- Certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`
- Public-key algorithm/size: RSA 2048
- Repository `npm run app:apk:verify`: passed

The signer matches the established EAS release lane. The available local
code-2 test APK is signed with a different certificate (`f28c328e...a64a5`).
If that code-2 APK is installed, uninstall it before installing this code-3
APK. An older EAS-signed build with certificate `e249bc55...2067` can update in
place.

## Embedded production configuration

The extracted `assets/app.config` contains:

- Program ID `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- cluster `mainnet-beta`
- package/version `com.luckyme.seeker` / `1.1.0` / code `3`

The production bundle contains `https://api.lucky-me.app`, `mainnet-beta`,
`solana:mainnet`, `expectedRoundId`, and `expectedTotalTickets`. The repository
production-environment validator passed and rejects preview mode, loopback/LAN
API values, non-HTTPS production services, and non-mainnet configuration.

## Launcher and manifest checks

- Application label: `LuckyMe`
- Adaptive launcher: `res/BW.xml`
- Extracted xxxhdpi launcher: `res/sK.webp`
- Extracted xxxhdpi foreground: `res/5c.webp`
- Extracted round launcher: `res/-6.webp`
- Visual inspection confirmed the green/gold LuckyMe + Solana + rocket artwork
  in all three resources; the default orange Expo icon is not present as the
  launcher.

Manifest permissions are the expected Expo/notification and Android support
set: Internet, notifications, network state, wake lock, vibration, boot/push
receivers, launcher badges, system-alert support, and legacy storage only
through Android 12L (`maxSdkVersion 32`).

## Device-test boundary

No ADB device was connected during final verification, so install, launch,
Mobile Wallet Adapter, and transaction-review smoke tests on Seeker remain a
manual device step. No mainnet transaction is required to verify installation,
navigation, pool targets, How to Play, wallet connection UI, and purchase
review up to (but not including) wallet signing.

## Local signing note

Native regeneration removed the ignored local upload JKS and
`keystore.properties`; no recoverable local copy was found. The regenerated
Android tree has only the debug keystore. Do not distribute a local
`assembleRelease`; use the verified EAS cloud signer until an approved release
keystore with the exact expected certificate is restored.
