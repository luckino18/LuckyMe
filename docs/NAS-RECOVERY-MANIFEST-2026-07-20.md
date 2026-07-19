# LuckyMe NAS Recovery Manifest — 2026-07-20

Target: `/volumeUSB1/usbshare/CODEX/Proiecte/LuckyMe` on `nasvictor.local`.

## Versioned source

- GitHub: `https://github.com/luckino18/LuckyMe`
- Branch: `main`
- Commit: `62d1e6a1de3f8434e4f41512dc7cfe78fae5cd87`
- Repository status after push: clean and synchronized with `origin/main`.

## Android release candidate

- File: `LuckyMe-Seeker-Update-1.2.2-code15-READY-TO-PUBLISH.apk`
- SHA-256: `a4ffe50842ebd93383aedc5d2add6764abfd4bba549276b1bdae725673fe6267`

## VPS runtime snapshot

- File: `luckyme-runtime-snapshot-2026-07-20.tar`
- SHA-256: `12aafa9a6b16b2cd4120c3261b8f4926082fc32dda6ee5182faa9bbe8dfa8ca3`
- Contains the Admin SKR registry, persistent cNFT jobs, settlement/refund history and rent-recovery evidence.
- Explicitly excludes `.env` files, credentials, `push-tokens.json`, `push-round-alerts.json`, private keys and keystores.

## Logical folders

- `apk/current/` — current verified release candidate.
- `apk/archive/` — historical APKs retained for operator review.
- `web/current/` — current public static web tree.
- `admin/current/` — current Admin UI plus server/service source.
- `admin/runtime-snapshot/2026-07-20/` — safe runtime recovery archive.
- `brain/current/` — LuckyMe Obsidian Brain; 1,087 files at snapshot time.
- `source/current/` — repository source without dependency/build caches or secrets.
- `source/snapshots/` — dated source snapshots.
- `handoff/` — mega handoff and this manifest.
- `desktop-old-files-archive/` — the conservative Desktop holding area, excluding known secret material and rebuildable caches.

## Restore order

1. Read `handoff/LUCKYME-MEGA-HANDOFF-2026-07-20.md`.
2. Restore source from GitHub commit above or `source/current/`.
3. Restore `brain/current/` before making product/release decisions.
4. Restore runtime data only to `/var/lib/luckyme`, with the service-specific ownership and permissions documented in the handoff.
5. Never overwrite a newer live registry blindly; compare the snapshot timestamp and on-chain evidence first.
