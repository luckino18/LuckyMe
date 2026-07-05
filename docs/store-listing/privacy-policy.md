# Privacy Policy Pre-Submit Asset

Required before submission:

- final privacy policy URL for `EXPO_PUBLIC_LUCKYME_PRIVACY_URL`;
- production privacy statement matching the deployed backend, hosting, logging,
  analytics, and support tooling.

Expected backend data categories to disclose if retained:

- wallet addresses submitted to state and transaction-builder endpoints;
- IP-derived rate-limit metadata;
- request timestamps and endpoint paths;
- transaction build payloads;
- operational logs needed to diagnose failed simulation, settlement, or refund
  states.

Do not state that no user data is processed unless production logging,
analytics, hosting, and support tooling are configured that way.

The app production validator requires `EXPO_PUBLIC_LUCKYME_PRIVACY_URL` to be a
final HTTPS URL.
