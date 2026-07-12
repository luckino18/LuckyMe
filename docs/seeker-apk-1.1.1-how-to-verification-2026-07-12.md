# Seeker APK 1.1.1 How To verification — 2026-07-12

Status: **EAS cloud build complete and artifact verified.**

## Fix

The Seeker `How To` pool guide no longer forces its `570px` desktop table
width onto the phone viewport. The screen now has an explicit bounded mobile
container and the pool table becomes readable card-style rows below `520px`.
No other tab layout was changed.

Chromium verification at a `360px` viewport reported:

- document scroll width: `360px`;
- body scroll width: `360px`;
- responsive table width: `302px`;
- elements outside the viewport: `0`.

## Artifact

- EAS build ID: `f6ecaeab-84f5-41ff-be42-2d5d5bea78c0`
- EAS artifact:
  `https://expo.dev/artifacts/eas/Rrx4CcfsAWWbOMi8qpB5TW3uBMZjjxWiVJlcCRQno9s.apk`
- Completed: `2026-07-12T16:44:49.809Z`
- Desktop copy:
  `/Users/victor/Desktop/LuckyMe-Seeker-HOW-TO-FIX-1.1.1-code4-2026-07-12.apk`
- File size: `118199237` bytes
- SHA-256:
  `edd66851314cb777adb8351cd4cbbdcae9631835a692371792989b9c2e85f55d`
- Package: `com.luckyme.seeker`
- Version: `1.1.1` (`versionCode 4`)
- Android SDK: minimum `24`, target `36`, compile `36`
- ZIP integrity: passed

## Signing and embedded configuration

- EAS credentials: `Build Credentials iNPMBDRiCC (default)`
- APK Signature Scheme v2: passed
- Certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`
- RSA key size: `2048`
- Embedded cluster: `mainnet-beta`
- Embedded Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Embedded bundle contains the bounded `.how-to-page`, mobile table rules and
  `data-label` cells used by the responsive card layout.

The signer matches the established EAS release lane, so this APK can update an
installed code-3 EAS build in place. A physical Seeker install and visual smoke
test remain the final device-only confirmation.
