# LuckyMe promotional pools — Mainnet production rollout

Date: 2026-07-23

## Solana program

- Cluster: `mainnet-beta`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Approved artifact length: `480176` bytes
- Approved artifact SHA-256:
  `3b40c2bf421773abac1ff774f1ec56dba166c77144b9d48ffa1876bc7ff44bbf`
- Existing ProgramData capacity: `480352` bytes; no extension was required.
- Upload buffer: `24Fh5kGaTzy4QoAWyVkvdFfxzhTATKRsKTpYfpQ5CX2P`
- Buffer rent: `3.34322904 SOL`, recovered after the upgrade.
- Temporary funding signature:
  `5gH4zwSG8bkdRfGEJLC9Pxm4xfhsHFFdXcv5usgRqDbPAuWx9HehgoGv7V5gHNLibzXNBAZcae7MG6uxrJJ8GqAJ`
- Upgrade signature:
  `61rQK47E52hJXLPR31zxW6ZHyyD8caCUGJv2biMGEiBivTRtGy1v3q3BZWeMd1ygKkXMnpHXZBDJLcLRZsiAPEvB`
- Upgrade slot: `434705773`
- Recovered-funds return signature:
  `DqBGA4a9RN5oHGrt9NjH8WkVc29TfwqBfhJWHLnKskVgGEqMc4pusvygf1RVKakUTnVw3XwCnAAZAwbRmtC3XDs`
- Final Ledger balance: `4.27252672 SOL`
- Temporary uploader final balance: `0 SOL`
- Net upgrade cost: `0.002388 SOL`

The deployed ProgramData dump contains the approved `480176` bytes followed by
exactly `176` zero-padding bytes. The deployed prefix is byte-identical to the
approved artifact. The buffer is closed, the program remains upgradeable and
the authority remains the Ledger address above.

## Production services

- Production VPS: `167.233.117.25`
- Backup:
  `/var/backups/luckyme/promotions-mainnet-20260723T112624Z.tar.gz`
- Backup SHA-256:
  `1585529d6b5130f73f4ee76df26604b536fddfb58d43fcddbb3ea2f321fd69a2`
- Staging:
  `/opt/luckyme/.release-staging/promotions-20260723T112624Z`
- Admin promotion service: enabled and active.
- Public Seeker promotion API: enabled.
- Promotional-pools keeper timer: enabled and active.
- Keeper write flag: enabled.
- Launch preparation and wallet-approved execution: enabled.
- Promotion authorizer: existing funded production keeper
  `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.
- Sponsor/config-authority wallet:
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Official SKR mint:
  `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`.

Live verification returned `enabled: true` with no active promotions. The
keeper smoke run returned `actions: []`. The public API and existing referral
health endpoints remained healthy, while unauthenticated Admin requests
returned HTTP `401`.

## Android build

- Package: `com.luckyme.seeker`
- Version: `1.2.3`
- Version code: `16`
- Tests: `233/233`
- TypeScript: passed
- Production environment validation: passed
- Expo Doctor: `20/20`
- EAS build:
  `b55a3c16-654f-4947-aa6d-10d08c8cb0c9`
- EAS status at handoff: `IN_QUEUE`

The build is an APK artifact request only. No Publisher Portal or store
submission was performed. APK signature, manifest, checksum and physical ADB
installation remain pending until EAS produces the artifact.
