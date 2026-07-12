# Seeker APK 1.1.2 notification verification — 2026-07-12

## Artifact

- Local APK: `/Users/victor/Desktop/LuckyMe-Seeker-NOTIFICATION-FIX-1.1.2-code5-2026-07-12.apk`
- EAS build: `89f31151-49bb-4364-90c2-f574296bf6b4`
- EAS URL: `https://expo.dev/accounts/vvyktorrio/projects/luckyme-seeker/builds/89f31151-49bb-4364-90c2-f574296bf6b4`
- Git commit: `a2bf0afd06d51e26afbeeed0b2cf7883b8bc95cf`
- APK size: approximately 113 MiB
- SHA-256: `99de87d9b104b19880669368ba30558ef0d66f4e87ea71c2898f8130b7922845`

## Verified release identity

- Package: `com.luckyme.seeker`
- Version: `1.1.2`
- Android versionCode: `5`
- Cluster: `mainnet-beta`
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Manifest includes `android.permission.POST_NOTIFICATIONS`.
- APK Signature Scheme v2 verification passed.
- Signer certificate SHA-256: `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`
- ZIP integrity verification passed.

## Notification permission correction

The LuckyMe explainer no longer redirects an Android 13+ user to App Info.
`Enable alerts` calls the native `POST_NOTIFICATIONS` permission request. If
the user selects Android's `Allow`, the APK obtains its Expo push token and
registers that installation through `/notifications/register`.

Android does not allow an application to silently override a permission that
the user has already blocked. Because Android preserves permissions across an
APK update, validate the corrected first-run experience by uninstalling the
older LuckyMe APK once, installing code 5, selecting `Enable alerts`, and then
selecting `Allow` in the native Android dialog.

## Delivery-path verification

- The complete repository suite passed: 102 tests, 0 failures.
- TypeScript typecheck passed.
- Expo Doctor passed 20/20 checks before the build.
- Production environment validation passed before the build.
- A delivery test verified two distinct opted-in APK tokens receiving both
  alert types: four high-priority Expo messages total.
- Each message uses channel `luckyme-round-alerts` and a pool-specific
  `luckyme://pools?pool=...` deep link.
- `started` and `last10` use separate per-pool/per-round state keys, preventing
  duplicate delivery after a successful send.
- The production systemd timer is configured for a scan every 60 seconds and
  the service enables guarded mainnet delivery.

The two alerts are emitted only for a confirmed, active round that has started
its countdown: once when the first ticket starts the round countdown, and once
when 10 minutes or less remain. The sender fans each alert out to every stored
opted-in Expo token.

No real user notification was sent during automated verification. Final
physical delivery proof requires a controlled live round and at least two
devices with Android notification permission enabled.
