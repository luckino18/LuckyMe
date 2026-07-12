# Minimum-ticket/refund release candidate — 2026-07-11

Status: **program, backend, and site deployed and verified on 2026-07-12.** EAS
APK build `52056b37-8b78-44fc-b30b-0319a96c92cb` is recorded below. Keeper
writes and new Round openings remain deliberately disabled.

## Player rules implemented

| Pool | Ticket price | Minimum total tickets | Minimum wallets |
| --- | ---: | ---: | ---: |
| Mini | 0.005 SOL | 25 | 1 |
| Normal | 0.01 SOL | 13 | 1 |
| High | 0.05 SOL | 3 | 1 |
| Premium | 0.1 SOL | 3 | 3 |

- Mini, Normal, and High count total tickets, not distinct players.
- Premium remains one ticket per wallet and requires three wallets.
- The first confirmed ticket starts the one-hour timer.
- An expired eligible round uses ORAO and the winner path.
- An expired below-target round requests no ORAO and has no winner.
- After the production 600-second delay, the configured keeper automatically
  returns complete ticket principal and closes each Entry so its rent returns
  to that player. Solana network fees are not refundable; there is no claim.

## Program and keeper safety

- All draw/randomness paths reject rounds below the applicable minimum.
- Refund is authorized by keeper signer + KeeperConfig, not permissionless.
- Refund-mode Entry and Round accounts cannot be closed while principal remains.
- Refund progress is append-only, restart-safe, stale-lock recoverable, and
  pinned to genesis hash, Program ID, Round, Entry, player, and exact credit.
- Backend archive rows are accepted only when genesis hash, Program ID, and
  pool PDA match the current client.
- A buy instruction includes the exact on-chain ticket total reviewed by the
  player. If it changes before execution, the transaction fails and the player
  must refresh/review again.
- Old public refund builder returns `410 automatic_refund_only`; direct
  `refund:crank` writes are retired.

## Web and Seeker UX

- Every pool card and review screen shows live progress such as `1 / 25`.
- Missing, stale, or mismatched policy fields fail closed and disable buying.
- `/how-to-play/` explains targets, total tickets versus wallets, timer, draw,
  automatic refund, and network-fee boundary without operator details.
- Browser wallet modal detects compatible Wallet Standard extensions and keeps
  WalletConnect plus mobile Phantom/Solflare/Backpack routes.
- Seeker mirrors the rules and progress at version `1.1.0`, Android code `3`,
  package `com.luckyme.seeker`.

Visual verification used desktop `1280x720` and mobile `390x844`, with no
horizontal overflow and no browser console warning/error:

- `screenshots/minimum-tickets-home-desktop-2026-07-11.png`
- `screenshots/how-to-play-desktop-2026-07-11.png`
- `screenshots/how-to-play-mobile-390x844-2026-07-11.png`
- `screenshots/minimum-tickets-refund-desktop-2026-07-11.png`
- `screenshots/minimum-tickets-refund-mobile-390x844-2026-07-11.png`
- `screenshots/wallet-modal-mobile-390x844-2026-07-11.png`
- `screenshots/purchase-review-mobile-390x844-2026-07-11.png`

## Validation evidence

- Node repository suite: `89/89` passed.
- Rust workspace suite: `11/11` passed.
- Anchor local validator lifecycle suite: `1/1` passed, including stale review,
  valid draw, below-target refund, cleanup, and rent assertions.
- Seeker TypeScript: passed.
- Seeker production environment: passed.
- Expo Doctor: `20/20` passed.
- Backend production configuration: passed.
- MAINNET_RELEASE source audit: passed.
- npm audit: no high or critical finding; root reports 6 moderate and Seeker 16
  moderate transitive findings. Available automatic fixes are breaking changes
  and were not applied blindly.
- Mainnet keeper simulation: `dryRun=true`, `executed=[]`.
- Secret-pattern scan found only code/documentation placeholders, no embedded
  keypair, mnemonic, keystore password, or private key.

## Production program artifact

- Size: `359312` bytes.
- SHA-256:
  `ab541a8eac1c3525199f9f409e4134274484183a1b67c9826fa0badf7cbb9576`.
- IDL SHA-256:
  `55bf4c6d975212b04ec326eb0b84168fa286014ab59ca3ae36c9a521ea164fee`.
- SDK SHA-256:
  `db10b2347d3b6f149fc879f3910c08d0f239d4acd2a5fdbd97c7e4a9f416868b`.
- ProgramData capacity/headroom: `398120 / 38808` bytes.
- Buffer rent at 359357 bytes: `2.5020156 SOL` recoverable after upgrade.
- Expected upgrade workflow fee: `0.001805 SOL`; total including funding and
  final sweep transactions: approximately `0.001815 SOL`, without priority fee.

See `mainnet-minimum-tickets-upgrade-execution-2026-07-12.md` for transaction
signatures, recovered rent, exact fees, and the current approval boundary.

## Target-level fee sensitivity

The ORAO cost assumption is `0.0023494 SOL` per eligible pool draw, never per
below-target refund round. Estimated net 2% treasury fee after ORAO and ordinary
keeper transaction fees:

| Pool at target | Treasury 2% | One Entry | Maximum Entries at target |
| --- | ---: | ---: | ---: |
| Mini 25 | 0.0025 | +0.0001156 SOL | -0.0000044 SOL |
| Normal 13 | 0.0026 | +0.0002156 SOL | +0.0001556 SOL |
| High 3 | 0.0030 | +0.0006156 SOL | +0.0006056 SOL |
| Premium 3 | 0.0060 | n/a | +0.0036056 SOL |

Mini 25 is therefore economically almost break-even but can be short by about
4400 lamports in the maximum-entry assumption. This is documented risk, not a
hidden guarantee; the approved threshold remains 25.

## APK evidence

- EAS build: `52056b37-8b78-44fc-b30b-0319a96c92cb`.
- Desktop artifact:
  `/Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-1.1.0-2026-07-11.apk`.
- Size: `118196973` bytes; SHA-256:
  `b0da48983e84fd361fe27e06a6ac3d5193b7fb9d0f04621ca963dbc6321af42d`.
- Package/version: `com.luckyme.seeker`, `1.1.0`, Android code `3`; minimum SDK
  `24`, target/compile SDK `36`; four native ABIs.
- EAS certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`.
- One RSA-2048 signer; APK Signature Scheme v2 passed. ZIP integrity and the
  repository APK verifier passed.
- Extracted adaptive, foreground, full, and round launcher resources visually
  show the LuckyMe artwork, not the default Expo icon.
- Embedded app configuration contains the approved Program ID and
  `mainnet-beta`; the bundle contains the production API, wallet chain, and
  reviewed-round binding fields.

Full APK evidence is in `seeker-apk-1.1.0-verification-2026-07-11.md`. No ADB
device was connected, so final Seeker install/launch/MWA smoke testing remains
manual.

The ignored local upload JKS and `keystore.properties` were removed during
native regeneration and no recoverable local backup was found. EAS cloud
credentials remain the approved signing lane. A local `assembleRelease` would
use the debug key and must not be distributed.

The available code-2 test APK is signed by certificate `f28c328e...a64a5`, while
the established EAS lane uses `e249bc55...2067`. A Seeker currently running the
code-2 test APK must uninstall it before installing the EAS-signed code-3 APK.
An EAS-signed older build can update in place.

## Live boundary after deployment

- Program slot: `432325448`; the approved threshold upgrade is verified.
- Authority balance: `2.54418544 SOL` after exactly `0.00182 SOL` total fees.
- Temporary upload payer: `0 SOL`.
- Keeper balance: `0.001437625 SOL`, below its write reserve.
- Live API: `activeRound: null` for all pools.
- Matching site/backend are live; public smoke checks passed.
- Keeper timer: disabled/inactive; no round, ORAO request, refund, or keeper
  write was executed.
