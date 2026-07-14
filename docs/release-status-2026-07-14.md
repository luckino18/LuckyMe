# LuckyMe Production and Store Status - 2026-07-14

This is the authoritative handoff for the GitHub snapshot created while the
current Seeker release is in Solana dApp Store review.

## Store release

- Android package: `com.luckyme.seeker`
- Version: `1.1.7`
- Version code: `10`
- APK: `LuckyMe-Seeker-1.1.7-code10.apk`
- APK SHA-256: `5b41ced1dafe384eff1d7df790c1836b61efc9c6656a4ee05974e6b711028e54`
- Signer certificate SHA-256:
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`
- Publisher Portal: submitted by Victor; final review result pending

The APK excludes the unused overlay and legacy external-storage permissions.
It retains notification, network, Firebase messaging, and wake permissions
needed by the application.

## Mainnet identity

- Cluster: `mainnet-beta`
- Program ID: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Upgrade/config authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`
- Authorized keeper: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- Backend: `https://api.lucky-me.app`
- Web: `https://www.lucky-me.app/`
- Browser dApp: `https://www.lucky-me.app/play/`

## Read-only production verification

Verified on 2026-07-14 without sending a transaction or changing the VPS:

- API health: healthy `MAINNET_RELEASE` on `mainnet-beta`
- On-chain program/config: available and not paused
- Randomness: ORAO VRF production mode
- Player transaction relay: disabled
- Settlement keeper timer: enabled and active
- Push notification timer: enabled and active
- Operations monitor timer: enabled and active
- Protected admin control: enabled and active
- Mainnet write override: absent

Current waiting rounds:

| Pool | Round | Tickets | startTs | endTs |
| --- | ---: | ---: | ---: | ---: |
| Mini | 7 | 0 | 0 | 0 |
| Normal | 6 | 0 | 0 | 0 |
| High | 6 | 0 | 0 | 0 |
| Premium | 7 | 0 | 0 | 0 |

## Implemented product surface

- Solana mainnet pool UI and unsigned wallet transaction construction
- Mini/Normal/High/Premium targets `25 / 13 / 3 / 3`
- First-ticket one-hour countdown
- Automatic below-target refunds without ORAO
- ORAO settlement for valid rounds
- Entry-rent return and operational rent-return program upgrade
- Web and APK custom ticket quantities and presets
- Smooth APK countdown and dedicated notification icon
- Native Android notification permission and multi-device push fan-out
- Protected read-only web admin and private biometric Admin APK
- Fixed-action protected admin controls with dry-run settlement preview
- Keeper, RPC, stuck-round, transaction, and notification monitoring
- Current privacy/support contact and push-notification disclosure

## Validation at snapshot time

- Project tests: `111/111` after adding the admin-control regression coverage
- Mainnet release audit: passed
- Seeker TypeScript typecheck: passed
- Admin TypeScript typecheck: passed
- APK package/signature/permissions: passed
- Live API and service status: passed read-only

The RPC optimization is intentionally kept on the separate local branch
`local/rpc-optimization` and is not part of this store-review snapshot.

See `docs/disaster-recovery.md` for restoration boundaries and the Desktop
backup inventory.
