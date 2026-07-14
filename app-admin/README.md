# LuckyMe Admin

Private Android operations application for the protected LuckyMe admin API.

## Security boundaries

- The APK never contains the keeper key, a Solana seed phrase, or server credentials.
- The operator enters the existing protected-admin username and password at runtime.
- Saved credentials use Android SecureStore and require enrolled biometrics.
- Server actions are a fixed allowlist. Arbitrary shell commands are not accepted.
- Every action requires an explicit confirmation, a single-use nonce, HTTP Basic authentication, and a trusted Nginx proxy header.
- Keeper preview is always `DRY_RUN=true` and cannot send a transaction.
- Mainnet lifecycle transactions remain owned by the existing automatic keeper, which simulates before sending and limits execution to one action per run.

## Private signing

The long-lived Android signing key is stored outside the repository under
`~/.luckyme-admin/`. Keep that directory backed up securely; future APK updates
must use the same certificate.

Build with:

```sh
npm run build:private-apk
```

The verified APK is written to `~/Desktop/LuckyMe-Admin-1.0.0-code1.apk`.

