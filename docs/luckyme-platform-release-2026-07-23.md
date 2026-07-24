# LuckyMe users, missions and promotional notifications

Date: 2026-07-23

## Product surface

- Official APK Home: Pools, Promotions, Missions and Profile.
- Referral League is not exposed by the official APK navigation.
- Profiles are keyed by the authenticated Solana wallet.
- A deterministic temporary username is created on first profile access.
- Each user may finalize one permanent, globally unique username.
- Lucky Points use the existing promotional-points ledger.
- Promotions supports multiple simultaneous Mainnet pools and deep-links to a
  specific promotion.

## Missions

- X verification uses a one-time post challenge and requires manual Admin
  approval before awarding Lucky Points.
- Discord verification uses OAuth identity plus official-guild membership and
  awards Lucky Points automatically and idempotently.
- One X or Discord identity cannot reward multiple wallets.
- The initial Discord and X rewards are five Lucky Points each.

Discord is deployed in `paused` state until these values are configured in
`/etc/luckyme/luckyme-api.env`:

- `LUCKYME_DISCORD_CLIENT_ID`
- `LUCKYME_DISCORD_CLIENT_SECRET`
- `LUCKYME_DISCORD_GUILD_ID`
- `LUCKYME_DISCORD_REDIRECT_URI`

After configuring them, activate `task-discord-community` from Admin Tasks.

## Admin and persistence

- Admin has protected Users and Tasks tabs.
- Users exposes wallet, username, Lucky Points, completed/pending tasks,
  verified identities, points history and promotion entries.
- Tasks supports creation, reward/status edits and manual X approval/rejection.
- Migration: `backend/migrations/003_luckyme_platform.sql`.
- Production database:
  `/var/lib/luckyme-promotions/promotional-pools.sqlite`.

## Push notifications

- A successfully confirmed Mainnet promotion sends one Expo push to registered,
  opted-in APK tokens.
- Deep-link format:
  `luckyme://promotions?promotion=<promotion-id>`.
- Token store: `/var/lib/luckyme/push-tokens.json`.
- Delivery is enabled with `LUCKYME_PUSH_SEND=true` in
  `/etc/luckyme/admin-promotions.env`.
- A notification failure is recorded but never changes the confirmed pool
  launch result.

## VPS rollout evidence

- VPS: `167.233.117.25`.
- Release staging:
  `/opt/luckyme/.release-staging/platform-20260723T1228Z`.
- Backup:
  `/var/backups/luckyme/platform-20260723T1228Z.tar.gz`.
- Services verified active:
  - `luckyme-seeker-referral.service`
  - `luckyme-admin-promotions.service`
  - `luckyme-promotional-pools-keeper.timer`
- Public referral health returned `ok: true`.
- Public promotions returned `enabled: true`.
- Unauthenticated protected Admin API returned HTTP `401`.
- SQLite startup uses a five-second busy timeout to prevent concurrent service
  migrations from failing during a restart.

## Verification

- Repository tests: `238/238`.
- APK TypeScript: passed.
- Production environment validation: passed.
- Expo Doctor: `20/20`.
- APK version: `1.2.4`.
- Android version code: `17`.
- EAS cloud build `490afb7d-11bd-4f25-80c5-17f52164f412` failed
  during dependency installation because the remote worker reused a stale
  lockfile.
- Equivalent local EAS release build: passed (`BUILD SUCCESSFUL`).
- APK: `/Users/victor/Desktop/LuckyMe-Seeker-1.2.4-code17.apk`.
- APK SHA-256:
  `555246064f9add8b593660f1b907e79f32c673b0d7529cedc01ca7f64e7966e4`.
- APK Signature Scheme v2: verified; signer certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.
- Manifest: `com.luckyme.seeker`, version `1.2.4` / code `17`, min SDK `24`,
  target SDK `36`.
- ADB installation on Seeker: passed. Package/version and process startup were
  verified with no fatal Android or React Native exception. Visual runtime
  validation remains pending because the phone was locked.
