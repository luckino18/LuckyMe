# LuckyMe Mega Handoff — 2026-07-20

This document is the recovery and continuation entry point for the complete LuckyMe project. It contains no private keys, passwords, keystores, API secrets or `.env` values.

## Start here

- Authoritative repository: this directory.
- GitHub: `https://github.com/luckino18/LuckyMe`
- Branch: `main`.
- Recovery baseline commit: `62d1e6a1de3f8434e4f41512dc7cfe78fae5cd87` (pushed on 2026-07-20).
- Local project root: `/Users/victor/Desktop/LuckyMe_CURRENT`.
- Obsidian project brain: `/Users/victor/Desktop/LuckyMe_CURRENT/LuckyMe_Brain`.
- Public site: `https://lucky-me.app/` and `https://www.lucky-me.app/`.
- Public game: `https://lucky-me.app/play/`.
- Protected Admin: `https://lucky-me.app/admin/`.
- Production VPS: `167.233.117.25`.
- NAS recovery root: `/volumeUSB1/usbshare/CODEX/Proiecte/LuckyMe` on `nasvictor.local`.

Read `LuckyMe_Brain/wiki/hot.md`, then `LuckyMe_Brain/wiki/index.md`, before changing product or production behavior.

## Current release lanes

- Production Android package: `com.luckyme.seeker`.
- Verified release candidate: `LuckyMe-Seeker-Update-1.2.2-code15-READY-TO-PUBLISH.apk`.
- Version: `1.2.2`; Android version code: `15`.
- SHA-256: `a4ffe50842ebd93383aedc5d2add6764abfd4bba549276b1bdae725673fe6267`.
- The artifact passed package/version inspection, ARM64 inspection, v2 signature validation, signer comparison, ZIP integrity, 16 KiB alignment, production configuration, TypeScript, Expo Doctor and the release test suite.
- It is a release candidate. Do not describe it as published until the Solana Mobile Publisher portal confirms the new version is live.
- Code 14 and every isolated UI/referral/pass test APK are historical and must not be uploaded as production.

## Product split

- Web contains the four normal SOL pools, wallet connection, Activity, public All Rounds, How To and Social.
- Seeker APK additionally contains Referral League and NFT Holders promotion flows.
- Referral remains APK-only and requires a genuine Seeker Genesis Token.
- The NFT promotion remains APK-only. Its 3 SOL payout path is not funded or enabled.
- Public web and Android use the approved green clover visual system, but APK-only campaign features must not leak into the public web product.

## Solana public identities

- Cluster: `mainnet-beta`.
- LuckyMe program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Seeker Pass authority: `6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H`.
- Seeker Pass collection: `HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J`.
- Bubblegum tree: `6MaEv559doM7sUkL1tFWRQST9JKRskSd64DzdkL3B22k`.
- The server has no authority private key and cannot sign mints.

## Production services and paths

Verified active on 2026-07-20:

- `luckyme-api`
- `luckyme-admin-control`
- `luckyme-admin-cnft`
- `luckyme-seeker-referral`
- `luckyme-operations-monitor.timer`
- `luckyme-settlement-keeper.timer`

Nginx configuration validates successfully. Main paths:

- Application source on VPS: `/opt/luckyme`
- Public static tree: `/var/www/luckyme/public`
- Runtime state: `/var/lib/luckyme`
- SKR registry: `/var/lib/luckyme/admin-skr-registry.json`
- Production backups: `/var/backups/luckyme` and older `/opt/backups/luckyme-*`

The SKR registry must remain owned by `luckyme:luckyme`, mode `0600`. Any root-run migration must restore ownership and verify a service-user atomic write before restarting `luckyme-admin-cnft`.

## Admin Seeker Pass distribution

- `SKR Database` is the permanent VPS registry. It assigns stable IDs, deduplicates later imports and protects confirmed delivery history.
- Local ADB/OCR collection stays local at `http://127.0.0.1:8796`; the operator manually pastes reviewed names into Admin.
- Recipient states are `Ready`, `Reserved for Send NFT`, and `NFT Confirmed`.
- `Prepare next 50 in Send NFT` reserves at most 50 clean usernames. An unfinished reservation is restored instead of silently selecting a second lot.
- One wallet approval contains the signed transaction set for at most 50 NFT recipients; each Solana transaction contains at most three mints.
- The old typed `MINT N NFTs` browser prompt was removed on 2026-07-20. The Admin still shows the resolved list, requires the exact authority wallet and opens Solflare for explicit approval.
- Nothing is broadcast until the full approval response has been received and validated.
- On any partial or uncertain result, do not blindly retry. Run job reconciliation/chain audit first.
- Confirmed recipients cannot be deleted. Invalid OCR-only rows can be removed only when they have no confirmed asset and no persistent mint-job reference.

On 2026-07-20 the batch-50 deployment passed 207/207 repository tests. Live config reported `mintsPerTransaction: 3`, `mintsPerApproval: 50`, `maxRecipients: 1000`; the typed prompt was absent; the service was active; registry access was healthy. No signature, broadcast, mint or SOL spend was used for that deployment check.

## Website

- Source: `site/lucky-me.app`.
- Deployment target: `/var/www/luckyme/public`.
- The canonical landing and later Home navigation share the same `/play/` implementation.
- Desktop Home and Pools use a complete 2×2 viewport-native layout.
- Wallet disconnect is local and explicit.
- Pool purchase confirmation and post-purchase status use the current green theme.
- Activity contains `Active`, `My History`, and public `All Rounds`; settlement signatures link to Solscan where available.
- Do not reintroduce technical/backend debug text, selectable UI copy, green top/side slabs, hidden-screen overlap or mobile-only spacing into desktop.

## APK

- Source: `app-seeker`.
- Uses Expo React Native, one persistent WebView, Mobile Wallet Adapter and Seed Vault-compatible flows.
- The single-WebView architecture is intentional: older dual-surface builds produced black frames, flicker and lag.
- Android Back navigates inside the app; long-press text selection is disabled.
- Pool buttons open the real wallet flow; NFT and referral use message authentication, not paid transactions.
- APK activation analytics are privacy-preserving first-activation estimates, not certified Solana dApp Store download totals.

## Test and release checks

Routine repository check:

```bash
npm test
```

Production Android validation lives under `app-seeker` and includes TypeScript, production environment validation, Expo Doctor, APK package/version/signing inspection and checksum generation. Never promote an APK based only on a successful compile.

For production cNFT changes, prefer local/unit checks and read-only live inspection. Do not consume Helius/DAS quota with repeated polling or large audits unless the operator requests it.

## Backup and recovery

The NAS recovery tree is organized as:

```text
LuckyMe/
  apk/
    current/
    archive/
  web/
    current/
  admin/
    current/
    runtime-snapshot/
  brain/
    current/
  source/
    current/
    snapshots/
  handoff/
```

The source copy excludes rebuildable dependency/build folders and excludes secrets: `.env` files, private keys, keystores, SSH material and credentials. Runtime recovery snapshots include operational state needed to reconstruct history, but intentionally exclude secret environment files and push-token stores.

GitHub is the canonical versioned source. NAS is the disaster-recovery mirror. The live VPS is runtime state, not the only copy of source.

The `2026-07-20` NAS mirror was completed and verified under `/volumeUSB1/usbshare/CODEX/Proiecte/LuckyMe`. APK, runtime, source, web, admin and Brain hashes match their local snapshots. The filtered historical Desktop archive passed a complete `tar` listing and has SHA-256 `8a4133485b987163736d31e64be4f031130419ff325a4d293d9b2bfbb182ed7b`. An interrupted earlier archive is marked `INVALID-PARTIAL` and must not be used.

## Desktop cleanup boundary

Old files are never deleted automatically. Clearly historical APKs, superseded worktrees and earlier backup folders are moved into a dated `LuckyMe_OLD_FILES_TO_REVIEW_*` folder on Desktop. The current code-15 APK, current workspace, source assets and anything ambiguous remain in place until Victor reviews the holding folder.

The 2026-07-20 holding folder is `/Users/victor/Desktop/LuckyMe_OLD_FILES_TO_REVIEW_2026-07-20` and contains `README-FIRST.md`, historical APKs, superseded worktrees and old preview/verification files. It contains 21 GB at handoff time. Nothing was deleted.

## Non-negotiable safety rules

- Never store or expose seed phrases, private keys, keystores, passwords or `.env` secrets in Git, Brain, handoff or a general NAS source snapshot.
- Never assume a failed/timeout mint sent zero assets; reconcile by transaction/job/DAS evidence before retrying.
- Never change the collection, tree, authority, Android package ID or mainnet program without explicit authorization.
- Never call an APK published until the store confirms it.
- Keep production, release-candidate, test, historical and design-intent lanes separate.
- Keep website and APK-only feature boundaries separate.

## Next operator checks

1. Verify the next real Admin lot contains no more than 50 recipients and produces one Solflare approval screen.
2. After approval, confirm exact submitted signatures and reconciled assets before preparing another lot.
3. Verify the Solana Mobile Publisher status for code 15 independently.
4. Keep monitoring wallet/indexer display behavior for compressed NFT assets; marketplace support for new cNFT collections remains limited.
5. Review the Desktop holding folder before deleting anything.
