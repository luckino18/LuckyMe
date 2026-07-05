# Security Policy

## Scope

Security reports may cover:

- Anchor program logic in `programs/luckyme/`
- Generated IDL and SDK type helpers
- Backend transaction builders in `backend/`
- Mobile Wallet Adapter flow in `app-seeker/`
- Operator scripts in `scripts/`
- CI and release configuration

## Reporting

Use the repository maintainer contact listed in the Publisher Portal metadata or
the support contact in `docs/store-listing/support-contact.md`. Include:

- affected commit and file path;
- reproduction steps;
- expected and observed behavior;
- impact on funds, transaction signing, randomness, settlement, or refunds;
- logs, screenshots, or transaction signatures when available.

Never send seed phrases, private keys, or keystore passwords.

## Severity Guide

- Critical: unauthorized fund movement, transaction signing deception, arbitrary
  winner selection in production mode, or bypass of program account constraints.
- High: backend transaction builders create materially different transactions
  than the UI review shows, production fallback returns fake pool data, or
  refund/settlement state can be corrupted.
- Medium: stale round UX, missing error handling, inaccurate public config, or
  rate-limit/CORS misconfiguration.
- Low: documentation, metadata, or non-sensitive operational issues.

## Mainnet Release Controls

- `MAINNET_RELEASE` requires `orao_vrf` randomness and
  `LUCKYME_PRODUCTION_RANDOMNESS=true`.
- `MAINNET_RELEASE` requires `LUCKYME_SOLANA_CLUSTER=mainnet-beta`.
- `MAINNET_RELEASE` requires an HTTPS Solana RPC URL.
- The production app requires an HTTPS backend URL and `solana:mainnet` wallet
  authorization.
- The backend submit relay is disabled by default and must stay disabled for
  production.
- The backend never signs player transactions.
- Production on-chain state failures produce unavailable/error responses, not
  fake pool data.

## User Data

The backend may receive wallet addresses, IP-derived rate-limit metadata,
transaction build payloads, and request logs. Store listing privacy text is kept
in `docs/store-listing/privacy-policy.md` so Publisher Policy user-data
disclosure can be completed consistently with the deployed infrastructure.

## Solana Mobile Requirements Note

The Solana Mobile docs specify APK signing, metadata, Publisher Portal account
and KYC/KYB, wallet funding for submission/storage, Publisher Policy, Developer
Agreement, and optional publishing CLI prerequisites.
