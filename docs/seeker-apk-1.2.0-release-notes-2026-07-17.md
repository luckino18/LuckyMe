# LuckyMe Seeker APK 1.2.0 (13)

Release lane: official Solana dApp Store candidate. The APK is built with the existing production application ID and official EAS signing credentials.

## Included

- LuckyMe Seeker Pass cNFT verification using one SIWS authentication signature.
- Free, idempotent promotion registration: one wallet and one cNFT asset per entry.
- Live `0 / 1,000` campaign counter refreshed from the LuckyMe API.
- Automatic commitment freeze and 20-winner draw at exactly 1,000 entries.
- Approved 3 SOL prize schedule shown in full inside the APK.
- Privacy-preserving dApp Store build activation and launch measurement.
- Existing LuckyMe pools, wallet connection, notifications and APK-only referral flow remain available.

## Funding boundary

Prize funding is not loaded in this release. Both `funded` and `payoutEnabled` remain false. The promotion implementation does not construct or submit prize transfers; funding and payouts require a later, separate authorized operation.

## Verification gates

- Root automated test suite: 171 passing.
- Promotion threshold and deterministic draw test: passing at 1,000 unique entries and 20 unique winners.
- TypeScript: passing.
- Expo Doctor: 20/20.
- Production environment validation: passing.
- Live API/Admin smoke: campaign open at 0/1,000, 3 SOL, 20 prizes, unfunded and payout locked.
- EAS build: `124df00c-7b39-40b9-8c66-bc9c2ff9e1d6` (`FINISHED`).
- APK: `/Users/victor/Desktop/LuckyMe-Seeker-1.2.0-code13-READY-TO-PUBLISH.apk`.
- SHA-256: `7e940ed398c991dc6d2ce2b45ebb5ffc7e06006cdf4f697df333712024ebfc36`.
- Package/version: `com.luckyme.seeker`, `1.2.0`, code `13`.
- Native ABIs: ARM64, ARMv7, x86 and x86_64.
- ZIP and 16 KiB alignment: verified.
- APK Signature Scheme v2: verified, one signer.
- Signer certificate SHA-256: `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`, matching the verified 1.1.9 update candidate.
- Forbidden overlay and legacy external-storage permissions: absent.
