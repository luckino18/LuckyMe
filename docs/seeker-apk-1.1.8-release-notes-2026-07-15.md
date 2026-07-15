# LuckyMe Seeker 1.1.8 — release notes

Android package: `com.luckyme.seeker`

Version: `1.1.8`

Version code: `11`

## User-facing changes

- Home is simplified to the essential game introduction and a single `View pools` action.
- Pool cards and detailed rules remain in their dedicated `Pools` and `How To` screens instead of being duplicated on Home.
- The Seeker Referral League is visible directly on Home and opens the native SGT/SIWS verification flow.
- Bottom navigation is now `Home / Pools / Activity / How To / Social`.
- Wallet access remains in the top-right header.
- Social provides direct access to `@LuckyMeSolana` on X and the LuckyMe Discord community.
- Production referral UI hides test simulation, test league data, fictitious rewards and unresolved `.skr` placeholders.
- Referral links use the production `/referral/LM-XXXXXX` route while the parallel test APK keeps its isolated test route and package.

## Release checks

- Full Node test suite: 158 passed.
- TypeScript: passed.
- Expo Doctor: 20/20 passed.
- Production environment validation: passed.
- Mainnet release audit: passed.
- The release must be signed by the established EAS certificate with SHA-256
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.

No Solana program, pool, keeper, VPS, or mainnet transaction is changed by this APK release.
