# Required Links Pre-Submit Asset

Configure these final HTTPS URLs before building and submitting the signed APK:

- `EXPO_PUBLIC_LUCKYME_TERMS_URL`: `https://lucky-me.app/terms`
- `EXPO_PUBLIC_LUCKYME_PRIVACY_URL`: `https://lucky-me.app/privacy`
- `EXPO_PUBLIC_LUCKYME_SUPPORT_URL`: `https://lucky-me.app/support`
- `EXPO_PUBLIC_LUCKYME_API_URL`: `https://api.lucky-me.app`

These values must be set in the EAS project environment or EAS secrets for the
`dapp-store` profile. The production validators reject missing values,
non-HTTPS URLs, and placeholder hostnames.
