# Required Links Pre-Submit Asset

Configure these final HTTPS URLs before building and submitting the signed APK:

- `EXPO_PUBLIC_LUCKYME_TERMS_URL`: final terms page.
- `EXPO_PUBLIC_LUCKYME_PRIVACY_URL`: final privacy policy page.
- `EXPO_PUBLIC_LUCKYME_SUPPORT_URL`: final support page.

These values must be set in the EAS project environment or EAS secrets for the
`dapp-store` profile. The production validators reject missing values,
non-HTTPS URLs, and placeholder hostnames.
