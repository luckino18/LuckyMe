# Seeker APK 1.1.7 Store Review Verification

Verified artifact: `LuckyMe-Seeker-1.1.7-code10.apk`

## Identity and signature

- Package: `com.luckyme.seeker`
- Version: `1.1.7`
- Version code: `10`
- Minimum SDK: `24`
- Target SDK: `36`
- APK SHA-256: `5b41ced1dafe384eff1d7df790c1836b61efc9c6656a4ee05974e6b711028e54`
- APK Signature Scheme v2: verified
- Signers: `1`
- Signer certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`

The certificate matches the established LuckyMe Seeker release certificate, so
the APK is an update of the same Android application.

## Permission review

The packaged manifest contains the expected networking, notification, wake,
Firebase messaging, and install-referrer permissions. It does not contain:

- `android.permission.SYSTEM_ALERT_WINDOW`
- `android.permission.READ_EXTERNAL_STORAGE`
- `android.permission.WRITE_EXTERNAL_STORAGE`

`app-seeker/app.json` blocks those three permissions explicitly and the test
suite verifies the block remains present.

## Product verification

- Device notification permission flow was manually confirmed.
- Push notifications reached both tested Android devices.
- Manual ticket quantity and `5 / 10 / 20 / 25` presets were manually confirmed.
- Smooth countdown and dedicated notification icon are included.
- Automatic refund, valid ORAO settlement, treasury split, jackpot contribution,
  and next-round opening were exercised on mainnet in the preceding release
  tests.
- The protected LuckyMe Admin APK is a separate package and is not part of this
  public store artifact.

## Store state

Victor confirmed that the release was uploaded through the Solana dApp Store
Publisher Portal and that the sensitive-permission warning no longer appeared.
The repository records the release as submitted and awaiting the portal's final
review result; the portal remains the authority for approval status.

No blockchain transaction or VPS mutation was performed during this
verification.
