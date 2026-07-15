# LuckyMe Seeker 1.1.9 — release notes

Android package: `com.luckyme.seeker`

Version: `1.1.9`

Version code: `12`

## User-facing changes

- Referral League now explains the monthly prize pool of up to `10,000 SKR`.
- The prize table is visible directly in the referral screen.
- Referral is exclusive to verified Seeker owners using LuckyMe from the Solana dApp Store.
- Shared referrals open the LuckyMe dApp Store listing and show a separate invite code.
- Android declares the official `solanadappstore://details` visibility query for that listing link.
- Entering a referral code is optional; independent installs can activate without one.
- A referral requires three completed winner-producing rounds on three different days and seven distinct active-app days.
- Cancelled or refunded rounds do not count toward referral qualification.
- Referral progress shows winning rounds, distinct play days, and active days.
- After a confirmed purchase in a second distinct round, LuckyMe shows a one-time optional review request.
- The review button opens the LuckyMe listing in the Solana dApp Store.
- The Social screen now uses a permanent Discord invite that lands new members in `START HERE / #welcome`.

## Release checks

- Full Node test suite: `162/162` passed.
- TypeScript: passed.
- Expo Doctor: `20/20` passed.
- Discord invite: permanent and targeted to `#welcome`.
- EAS build: `addcad00-9db6-4e4a-8e7a-95bb6f7b9c8d` (`FINISHED`).
- APK: `LuckyMe-Seeker-1.1.9-code12-READY-TO-PUBLISH.apk`.
- SHA-256: `eb69cc3c91ea76cfb3b9ece6b964ac79673fdb6183d28423b4cdd040d85cfe63`.
- APK Signature Scheme v2: verified, one signer.
- Signer certificate SHA-256: `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.
- Manifest: package `com.luckyme.seeker`, version `1.1.9`, code `12`.
- Forbidden overlay and legacy external-storage permissions: absent.

No Solana program, pool, keeper, or mainnet transaction is changed by this APK release.

The companion read-only Admin was reorganized into Server Status, Treasury Estimate, Winners and Referrals tabs. Referral qualification is archive-backed and automatic on the production API.
