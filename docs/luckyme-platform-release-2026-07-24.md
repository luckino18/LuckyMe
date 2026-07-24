# LuckyMe platform transformation — release handoff

Date: 2026-07-24

## Release lane

- Canonical repository: `/Users/victor/Desktop/Luckyme Work/Project/LuckyMe`
- Official Android package: `com.luckyme.seeker`
- App version: `1.2.6`
- Android version code: `19`
- Solana cluster: `mainnet-beta`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- EAS project: `e054857c-6dfb-46ec-9d60-09ce2150dcc4`
- EAS owner: `vykytorrios-team`
- Android signing credential: `Build Credentials iNPMBDRiCC (default)`

The first code-19 job, `393148e5-42dc-4935-a1a2-29e286943bb1`,
failed before Android compilation because `package.json` and
`package-lock.json` were not synchronized. EAS reported missing lock entries
for `typescript@5.9.3` and `utf-8-validate@5.0.10`.

The lockfile was regenerated with npm `10.9.8`, matching the EAS worker.
`npm ci --include=dev --dry-run` then passed. Replacement job
`c879b069-2e2f-4e75-8fc6-dd0646011a8c` was submitted with `--no-wait`.
At this handoff it is only a submitted cloud build. No APK, checksum, manifest,
signer or physical-device verification is claimed.

Pre-push source verification:

- repository tests: `260/260`
- Rust unit tests: `15/15`
- TypeScript: passed
- production environment validation with the `dapp-store` profile: passed
- Expo Doctor: `20/20`
- npm `10.9.8` clean-install dry run: passed

## Mainnet promotional pools

The compact promotional-pool lifecycle is part of the existing LuckyMe
program, not a second Solana program. It supports SOL and classic SPL-token
prizes, including the official SKR mint.

- Official SKR mint:
  `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`
- Capacity-only promotions can run without a user-facing time limit.
- A promotion locks only when its selected participant capacity is full.
- MagicBlock scoped VRF supplies randomness after capacity lock.
- The program selects one unbiased winner index, pays the exact prize, closes
  entry accounts and archives the promotion/vault.
- SOL and token vaults are isolated per promotion even when one Ledger-backed
  sponsor wallet funds multiple simultaneous campaigns.
- The sponsor wallet retains only unallocated funds; a launch moves the exact
  prize into the promotion-specific vault.

Mainnet program state was re-read on 2026-07-24:

- ProgramData:
  `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- Upgrade authority:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Deployment slot: `434705773`
- ProgramData capacity: `480352` bytes
- Program remains upgradeable and loader-owned.

The verified Mainnet upgrade and temporary-buffer recovery are documented in
`docs/mainnet-promotions-production-rollout-2026-07-23.md`.

## All-in-one Admin

The protected Admin now contains:

- one promotion form with title, subtitle, description, Lucky Points entry
  cost, maximum participants, prize asset, prize value, level access and
  optional duration;
- SOL and SKR treasury balances, available balances, reserved amounts and the
  exact sponsor/vault addresses;
- live SOL/USD and SKR/USD conversion through Jupiter Price API V3;
- automatic participant and LP-per-entry recommendations;
- a readable economy terminal that explains every calculation;
- a standard promotion lane that refuses intentional House subsidy;
- an Ultra Promotion lane that allows reviewed overrides and requires the
  explicit `APPROVE INTENTIONAL HOUSE SUBSIDY` confirmation when coverage is
  below the safe floor;
- wallet-standard funding/signing with strict prepared-transaction comparison,
  simulation, confirmed submission and on-chain account verification;
- Users, Tasks and task-submission review tabs.

The Admin never holds the sponsor's Ledger secret. It prepares the exact
transaction, while the connected wallet remains the signer.

## LuckyMe economy v1

The source of truth is `backend/src/luckyme-economy.mjs`.

### Promotion economy

- Internal LP accounting value: `$0.0025` per LP.
- Standard coverage target: `120%` of the live prize value.
- Ultra coverage target: `100%` of the live prize value.
- Prize value: `prize amount × fresh USD asset price`.
- Adjusted budget: `prize USD × coverage target`.
- Required LP burn: `ceil(adjusted budget / 0.0025)`.
- Live-audience calculations are reliable only from at least `50` eligible
  active non-internal users.
- When live audience is enabled and reliable:
  `floor(active users × historical conversion × 80% fill confidence)`.
- Otherwise the engine uses a premium baseline derived from required LP burn
  and the prize-value band.
- Recommended LP per entry is rounded upward to a multiple of five.
- Standard launches below the required LP burn are blocked.
- Ultra launches may record an intentional subsidy, its USD value, selected
  overrides, approver and timestamp.
- LP is an internal utility unit; the terminal explicitly does not represent it
  as real House revenue.

Every prepared promotion stores an immutable economy snapshot with price
source/time, calculator version, recommendation, selected values, audience
inputs, coverage ratio and any intentional override.

### XP progression and ranks

Maximum level is `100`. XP required for the next level is:

`100 + 30 × (level - 1) + 8 × (level - 1)^2`

Ranks and frame families:

1. Levels 1–9: Junior — Bronze Clover
2. Levels 10–19: Explorer — Silver Orbit
3. Levels 20–34: Challenger — Emerald Circuit
4. Levels 35–49: Vanguard — Vanguard Sapphire
5. Levels 50–64: Elite — Royal Amethyst
6. Levels 65–79: Master — Master Gold
7. Levels 80–89: Legend — Legendary Flame
8. Levels 90–99: Mythic — Mythic Prism
9. Level 100: LuckyMe Icon — Crowned Icon

### Fixed mission rewards

Admin does not allow arbitrary LP/XP rewards for the supported presets:

- X Like: `5 LP / 10 XP`
- X Follow: `8 LP / 16 XP`
- X Repost: `10 LP / 20 XP`
- X Comment: `12 LP / 24 XP`
- Discord membership: `5 LP / 20 XP`
- Community fallback: `5 LP / 10 XP`

Gameplay task rewards are calculated from the number of valid, settled pool
rounds and are capped at `1,000 LP / 5,000 XP`.

### Valid pool participation

Every unique, settled, winner-producing round can reward its participant once:

- Mini: `2 LP / 8 XP`
- Normal: `5 LP / 18 XP`
- High: `12 LP / 40 XP`
- Premium: `25 LP / 80 XP`

Cancelled or refunded rounds do not count. Each gameplay mission counts only
events at or after that mission's own `starts_at`, so a later mission starts
from zero instead of reusing old participation.

## Users, missions and persistence

Profiles are keyed by the authenticated Solana wallet and stored in
`/var/lib/luckyme-promotions/promotional-pools.sqlite`.

Each profile has:

- a deterministic temporary username;
- one permanent, globally unique username finalization;
- Lucky Points balance and reservations;
- XP, level, rank and level progress;
- verified X/Discord identities;
- completed and pending mission counts;
- avatar ownership and active-avatar state;
- referral state and invited-user status;
- official LuckyMe NFT ownership results.

Admin Users exposes the wallet, username, LP, XP/level, completed/pending
missions, verified identities, promotion entries and points history.

Mission creation supports:

- Discord, X and community/gameplay;
- X actions Like, Follow, Repost and Comment;
- an X target URL that is normalized into the direct action flow;
- title, description, initial state, participant limit and level range;
- Any, Mini, Normal, High or Premium gameplay counters;
- fixed LP/XP presets from the economy engine.

X verification remains manual review: LuckyMe opens the target/action flow, but
does not press a social button or act in the user's name. Discord uses OAuth
and official-guild membership for automatic, idempotent verification.

Published missions can be paused, archived and then soft-deleted. Deletion is
refused while pending submissions exist. On 2026-07-24 the two temporary TEST
missions were archived and deleted. The real Discord and X community tasks
remain active.

## Profile, Referral, NFT and avatars

The APK profile surface is separated into clean Profile, Referral and NFTs
views. Referral is not duplicated on Home and Missions is not duplicated inside
Profile.

- The permanent username appears once in the profile header.
- Tapping the active avatar opens the avatar selector instead of showing the
  whole catalog inline.
- The starter avatar is free.
- Higher avatars require both the configured level and the configured LP price.
- Acquisition debits only available, unreserved LP and is idempotent.
- Owned avatars can be activated without repurchase.
- Referral shows the permanent invite code, invited users and
  pending/qualified/invalidated state.
- NFTs performs signed-wallet verification and lists assets from supported
  official LuckyMe collections.
- Background profile refresh is four hours, while returning the app to the
  foreground performs an immediate refresh.

Avatar prices:

- Clover Scout: level 1, free
- Fortune Explorer: level 10, 60 LP
- Emerald Challenger: level 20, 150 LP
- Vanguard Keeper: level 35, 350 LP
- Royal Elite: level 50, 700 LP
- Fortune Master: level 65, 1,200 LP
- Clover Legend: level 80, 2,000 LP
- Mythic Oracle: level 90, 3,200 LP
- LuckyMe Icon: level 100, 5,000 LP

## APK information architecture and UI

Official Home presents four primary actions:

- Pools
- Promotions
- Missions
- Profile

The duplicate Pools item was removed from the bottom navigation. Activity now
contains Active, My History, Missions and All Rounds. How To contains aligned
sections for Pools, Missions, Referral, NFT Pass and Jackpot.

The Promotions screen is user-facing and deliberately omits Admin/Mainnet
implementation copy. It shows the promotion selector, prize, entry progress,
LP cost, remaining places, status, optional level restriction, winner and
Solscan proof when available.

User-facing technical exceptions are sanitized. Wallet cancellation maps to
`Wallet request was cancelled.` and Java/Android/RPC/network diagnostics do not
leak into the interface.

The approved visual set includes:

- nine progressively premium avatars;
- nine matching rank frames;
- a new Pools navigation medallion;
- aligned Jackpot art;
- regenerated X, Discord, Website and Support medallions;
- approved Missions, Profile and Lucky Rewards medallions;
- removal of the obsolete NFT watermark from Promotions;
- more opaque pool-card backgrounds for readability;
- removal of redundant synchronization/refund footer strips.

All committed raster assets live under `app-seeker/assets/`; optimized WebP
copies used by the embedded UI are generated from the same originals.

## Notifications

Users who grant notification permission can receive a push when a confirmed
promotion launches. The push deep-links to:

`luckyme://promotions?promotion=<promotion-id>`

Registration now includes a stable application device identifier. The backend
deduplicates stale same-device registrations and compatible legacy
same-wallet registrations without changing the launch result if push delivery
fails.

## Production state at the handoff

Read-only checks on 2026-07-24 confirmed:

- `luckyme-api.service`: active
- `luckyme-seeker-referral.service`: active
- `luckyme-admin-promotions.service`: active
- `luckyme-promotional-pools-keeper.timer`: enabled
- the real Discord and X tasks are active;
- the two temporary TEST missions are deleted;
- the Mainnet program, ProgramData and Ledger upgrade authority match the
  documented production identities.

The most recent backend deployment changed only
`backend/src/luckyme-economy.mjs` and
`backend/src/push-notifications.mjs`, with rollback backup:

`/var/backups/luckyme/release-1.2.6-code19-20260723T235430Z`

No Publisher Portal upload, store publication, new promotion funding or new
Solana write is implied by this handoff.
