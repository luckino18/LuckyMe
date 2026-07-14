# LuckyMe RPC Optimization Deployment - 2026-07-14

## Scope

This release changes only the Node backend's read path:

- shared cache for public program state;
- bounded per-wallet cache keyed by public-state version;
- in-flight request deduplication;
- batched Pool, Round, and Entry account reads;
- removal of duplicate active-round reads.

It does not change the Solana program, IDL, instructions, transaction signing,
economics, web assets, Seeker APK, keeper transaction logic, or API response
shape. No blockchain transaction was created or sent.

## Source

- Base store-review commit: `3fa39509c3796418d50c0a7bda3e078bfe74b31e`
- RPC optimization commit: `6a67841`
- Integrated branch during validation: `deploy/rpc-optimization-2026-07-14`
- Deployed `backend/src/server.mjs` SHA-256:
  `7a849b36a39ffe80abe20772c5ce71c0bbd7ebf462e3d286bce3b32d8bbf27a7`

## Validation before production

- Node syntax check: passed
- Combined project tests: `114/114` passed
- Mainnet release audit: passed
- Seeker typecheck: passed
- Admin typecheck: passed
- Staged API used the real production environment on temporary port `8792`
- Staged `/health`, `/config`, and `/pools`: passed
- Staged and live pool summaries matched exactly before deployment

The first isolated staging attempts demonstrated existing safety boundaries:
one lacked the staged relative support modules, and one was rejected because
`MAINNET_RELEASE` correctly forbids a loopback bind. Production was not touched
by either attempt. After staging the complete read dependencies and using the
production bind rule, the isolated test passed.

## Atomic production deployment

- UTC timestamp: `2026-07-14T13:04:44Z`
- VPS pre-deploy backup:
  `/opt/backups/luckyme-rpc-20260714T130010Z`
- Release staging:
  `/opt/luckyme/.release-staging/rpc-20260714T130010Z`
- Changed runtime service: `luckyme-api.service` only
- Rollback was armed during install and disabled only after all health/state
  assertions passed.

## Live result

- API service: enabled/active
- API mode: `MAINNET_RELEASE`
- Cluster: `mainnet-beta`
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- On-chain state: available
- Transaction submit relay: disabled
- API errors after restart: `0`
- Public web `/play/`: HTTP `200`
- 30 concurrent public pool reads: all HTTP `200`, approximately `1045 ms`
- 20 concurrent reads for the same wallet: all HTTP `200`, approximately
  `102 ms`

Pool state remained unchanged:

| Pool | Round | Tickets | Status | startTs | endTs |
| --- | ---: | ---: | --- | ---: | ---: |
| Mini | 7 | 0 | waiting | 0 | 0 |
| Normal | 6 | 0 | waiting | 0 | 0 |
| High | 6 | 0 | waiting | 0 | 0 |
| Premium | 7 | 0 | waiting | 0 | 0 |

Settlement keeper, push alerts, operations monitor, and admin control remained
active. The mainnet write override remained absent. Rollback was not required;
the backup remains available.
