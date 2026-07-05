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

Local build:

```bash
cd app-seeker
npm run validate:production
eas build --platform android --profile dapp-store --local
```

## Signing Key

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
