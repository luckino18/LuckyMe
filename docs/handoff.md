# LuckyMe Handoff

Current objective: preserve the deployed minimum-ticket/refund
`MAINNET_RELEASE` while keeping keeper writes and new rounds separately gated.

## Current Release Shape

- Release mode: `MAINNET_RELEASE`
- Cluster: `mainnet-beta`
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Mainnet deploy tx:
  `Euf5ociVf2MyeyVpypC7EcwyQgnWBvsnuqhuxPGSMCeta9Ho1u7dKNGiLFczKbwkamjZMf8Ajb6Ykbj4mMXAP8N`
- Upgrade/config authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`
- Production keeper: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- Backend: `https://api.lucky-me.app`
- Mobile wallet chain: `solana:mainnet`
- Randomness: ORAO provider path
- Backend player signing: none
- Backend submit relay: disabled for production
- Production pool fallback: unavailable/error state, not fake data
- Historical on-chain status on 2026-07-07: config and all four pools were
  initialized and their first rounds opened. Current status is Mini 5, Normal
  6, High 6 and Premium 6 active and waiting for their first tickets; all have
  `startTs=0` and `endTs=0`.
- Historical v1.0 store APK:
  `/Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-v2-2026-07-08.apk`
- Historical v1.0 APK SHA-256:
  `c104ec372270dc175d54d26bf472edd9f489813324f66c9a6766df423fc05bc2`
- APK signing: EAS-managed Android credentials
  `Build Credentials iNPMBDRiCC (default)`, verified with APK Signature Scheme
  v2. Signer certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.
- Push notifications: APK includes Expo push registration and the VPS backend
  exposes `/notifications/register`. The live register/unregister smoke test
  and keeper dry-run passed on 2026-07-08. The final v2 APK uses a new
  notification prompt key so older dismissed prompts do not suppress this
  build's explainer.
- Final v2 UI correction: `Settings` / `Configuration` was removed from the
  visible app. The legal/community screen is now `Links` only, with Terms,
  Privacy, Support, and future X/Discord placeholders.
- Home copy now states `95% prize / 3% jackpot / 2% treasury`.
- Winner share card: included in the APK/WebView flow as a dynamic,
  responsive card with WhatsApp, X, Telegram, and PNG download actions.

## July 11 lifecycle upgrade status

The lifecycle program upgrade and `KeeperConfig` initialization are deployed.
The approved Stage 2 recovery closed all 18 eligible legacy empty Round
accounts in five batches of at most four and returned exactly `0.05211648 SOL`
to the on-chain treasury. Mini round 2, which contains four tickets and player
funds, was excluded and remains unchanged. The temporary upload payer was
drained back to the Ledger authority and the upgrade buffer is closed.

The post-recovery keeper dry-run executed nothing and plans one new waiting
Round for each pool. Mini round 5 was later opened with approved signature
`2uDPC1D6DvHw86qviMcAzZWbLF77iS6WnzgEw4Z2wcBKo4ttokLEzxsi7ysfvvLJkSoEeejQjQ5yhTUE3S4fRkfd`.
The next full-lifecycle invocation unexpectedly prioritized the already
archived Mini round 2 sidecar cleanup and returned `1969680` lamports to the
treasury with signature
`eyPNoNN1UoknTpr9bbq6P3xZFvo1czxwbnje93M7eeJJbc2H8SjL33Z1yVffCMkpRE6PJzAGp6QHbr97w4AkS95`.
Execution stopped immediately. After the strict scope fix and a new explicit
approval, Normal 6, High 6 and Premium 6 were opened individually and verified.
See `docs/mainnet-open-round-only-execution-2026-07-12.md`.
The keeper now has a separately confirmed `open_round_only` scope with an exact
`pool:roundId` allowlist which returns before all cleanup, refund, ORAO and
settlement paths. The timer remains `disabled` and `inactive`, the write
override is absent, and the base unit is dry-run-only. The keeper balance after
the three approved openings is `0.589832185 SOL`.

The required production keeper is still
`6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.
`8TN3gVGp86EUnmpa3ncMpPHoWDAV7t997RuXaLesRWqV` is only an older plan and is not
the VPS signer. Full Stage 2 evidence is in
`docs/mainnet-stage2-rent-recovery-execution-2026-07-11.md` and
`docs/mainnet-stage2-rent-recovery-evidence-2026-07-11.json`.

## Minimum-ticket deployment status

Source now implements Mini `25`, Normal `13`, High `3`, and Premium `3`
minimum tickets; Premium also requires three distinct wallets. The first ticket
starts the one-hour timer. An expired below-target round requests no ORAO and
has no winner: after the 600-second delay, the configured keeper returns full
ticket principal and Entry rent to each player automatically. Network fees are
not refundable and players do not claim manually.

Program, IDL/SDK, settlement keeper/journal, backend, static site, How to Play,
wallet selector, and Seeker `1.1.0`/code `3` are synchronized in this branch.
The signed code-3 test APK is
`/Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-1.1.0-2026-07-11.apk`
with SHA-256
`b0da48983e84fd361fe27e06a6ac3d5193b7fb9d0f04621ca963dbc6321af42d`.
It uses the established EAS certificate `e249bc55...2067`; signature v2, ZIP,
package/version, production configuration, and extracted LuckyMe launcher
resources passed verification. See
`docs/seeker-apk-1.1.0-verification-2026-07-11.md`. No ADB device was connected,
so the physical Seeker smoke test remains outstanding.
The final production program artifact is `359312` bytes with SHA-256
`ab541a8eac1c3525199f9f409e4134274484183a1b67c9826fa0badf7cbb9576`;
the IDL and SDK hashes are recorded in the release-candidate report.
All local test suites and the mainnet keeper dry-run pass; the dry-run executes
zero transactions. The approved binary and its matching backend/site were
deployed on 2026-07-12 at program slot `432325448`. Buffer rent was recovered,
the temporary payer was swept to zero, and the exact net fee was `0.00182 SOL`.
The live timer remains disabled/inactive, the write override is absent, and all
pools remain idle. See
`docs/mainnet-minimum-tickets-upgrade-execution-2026-07-12.md`. Funding or
starting the keeper and opening the next four rounds require separate approval.

## Main Files Changed In This Pass

- `README.md`
- `SECURITY.md`
- `Anchor.toml`
- `backend/src/server.mjs`
- `backend/src/push-notifications.mjs`
- `app-seeker/App.tsx`
- `app-seeker/src/LuckyMeScreen.tsx`
- `app-seeker/app.json`
- `app-seeker/app.config.js`
- `app-seeker/eas.json`
- `app-seeker/scripts/validate-production-env.mjs`
- `scripts/push-round-alerts.mjs`
- `docs/apk-signing.md`
- `docs/solana-mobile-publishing.md`
- `docs/store-listing/*`
- `scripts/audit-mainnet-release.mjs`
- `scripts/init-pools-ledger.mjs`

## Remaining Credential Items

- Publisher Portal account and KYC/KYB.
- Publisher wallet with enough SOL for submission and storage costs.
- Publisher Portal API key and signer keypair if using the optional CLI path.
- Post-approval real-device wallet entry test against a separately opened
  mainnet round.
- Final Publisher Portal submission and storage provider selection.

## Validation Commands

```bash
npm install
npm test
npm run app:validate:production
npm run app:typecheck
npm --prefix app-seeker run doctor
npm run audit:mainnet-release
cargo check
cargo test
```

Current release-candidate APK verification commands:

```bash
npm run app:apk:verify
apksigner verify --verbose --print-certs /Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-1.1.0-2026-07-11.apk
shasum -a 256 /Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-1.1.0-2026-07-11.apk
```

## Mainnet Operations Notes

- The successful deployment used a temporary local fee-payer/buffer wallet for
  program upload, then set the final upgrade authority to the Ledger authority
  `AApgo...`.
- `npm run init:pools:ledger` initializes config/pools with a Ledger authority
  while using a local fee payer for transaction fees.
- The temporary deployment wallet was drained after setup and verified at
  `0 SOL`.
- The owner-controlled Reown project `LuckyMe Web` uses public Project ID
  `5d4fd67345e3a0d071c527fd2c1067bb` for web WalletConnect flows. Its domain
  allowlist contains both `https://lucky-me.app` and
  `https://www.lucky-me.app`. The Expo/EAS project ID used
  by the APK for push tokens is
  `e054857c-6dfb-46ec-9d60-09ce2150dcc4`.
