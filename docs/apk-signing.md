# APK Signing

Solana dApp Store submission uses a signed APK file.

## EAS APK Profile

`app-seeker/eas.json` includes:

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

Build:

```bash
cd app-seeker
npm run validate:production
npm run build:dapp-store
```

Local build (only after an operator restores an approved release keystore and
verifies its certificate before Gradle runs):

```bash
cd app-seeker
npm run validate:production
eas build --platform android --profile dapp-store --local
```

## Signing Key

Current release lane: use EAS cloud credentials
`Build Credentials iNPMBDRiCC (default)`. The ignored local upload-keystore copy
was removed when the native Android tree was regenerated on 2026-07-11 and no
recoverable local backup was found. The regenerated tree contains only the
Android debug keystore, so a local release build is not an approved signed
artifact and must not be distributed.

The expected EAS release certificate SHA-256 is
`e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.
Every release APK must be checked against it. Do not silently replace the
certificate: Android updates require the installed app and update APK to share
the same signer.

If managing signing locally, create a dedicated dApp Store keystore:

```bash
keytool -genkey -v -keystore luckyme-dapp-store.keystore \
  -alias luckyme-dapp-store \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Keep keystore files and passwords outside the repository.

## Verify Signed APK

```bash
APK_PATH=/path/to/app-release.apk npm run apk:verify
```

The command should print certificate details and exit successfully.
