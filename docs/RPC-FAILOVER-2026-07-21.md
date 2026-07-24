# LuckyMe Solana RPC failover — 2026-07-21

## Live provider order

1. Alchemy Solana Mainnet (free tier) — primary
2. Chainstack Solana Mainnet (free tier) — fallback
3. Solana public Mainnet RPC — emergency fallback only

Shyft is intentionally excluded from the live chain because the supplied credential returned HTTP 401 during verification.

Chainstack remains a fallback because its free plan returned `Method requires plan upgrade` for `getProgramAccounts`, while basic RPC methods remained healthy. If Alchemy becomes unavailable, requests unsupported by Chainstack continue automatically to the public emergency endpoint.

## Implementation

- `scripts/rpc-failover.mjs` classifies only infrastructure failures as retryable: authentication, quota/rate limit, timeout, transport failure, and HTTP 5xx.
- Deterministic Solana simulation and program errors are returned unchanged and are never hidden by provider switching.
- Provider cooldown and the last healthy provider are shared across backend clients so a failed endpoint is not hammered on every API request.
- `scripts/anchor-client.mjs` applies the failover transport to every backend client created through the canonical Anchor client.
- Production `/config` exposes only `LUCKYME_PUBLIC_WALLET_RPC_URL`. Private provider paths and API keys never appear in the public response.
- The separate Referral/NFT service uses the same standard-RPC failover for SGT checks.
- Seeker Pass ownership uses a separate DAS-specific provider pool because compressed-NFT lookups are not standard Solana RPC methods. Only configured providers that implement DAS `searchAssets` are queried, and an asset is accepted only after collection, tree, owner and verified-creator checks pass.
- Alchemy and Chainstack remain standard-RPC providers only. They are deliberately excluded from cNFT ownership checks because they do not provide DAS.

## Environment variables

- `ANCHOR_PROVIDER_URL` — primary private backend RPC
- `LUCKYME_RPC_CHAINSTACK_URL` — Chainstack fallback
- `LUCKYME_RPC_ALCHEMY_URL` — Alchemy endpoint; currently deduplicated against the primary
- `LUCKYME_RPC_PUBLIC_FALLBACK=true` — enables the public emergency endpoint
- `LUCKYME_PUBLIC_WALLET_RPC_URL=https://api.mainnet-beta.solana.com`
- `LUCKYME_RPC_TIMEOUT_MS`
- `LUCKYME_RPC_COOLDOWN_MS`
- `SEEKER_PASS_DAS_RPC_URL` — preferred DAS endpoint for compressed-NFT ownership checks
- `SEEKER_PASS_DAS_RPC_URLS` — optional comma/newline-separated DAS failover endpoints
- `LUCKYME_RPC_QUICKNODE_DAS_URL` — optional QuickNode endpoint with the DAS add-on enabled
- `LUCKYME_RPC_SHYFT_URL` — optional valid Shyft DAS endpoint

Never commit endpoint credentials to Git. They live only in `/etc/luckyme/luckyme-api.env` on the VPS.

## Verification evidence

- Full repository test suite: 218 passed, 0 failed.
- Chainstack and Alchemy both returned the Solana Mainnet genesis hash.
- Live API: service active, `onchainAvailable=true`, cluster `mainnet-beta`, four pools returned.
- Live public configuration contains the public Solana endpoint and no Chainstack or Alchemy credential.
- Current `luckyme-api` invocation recorded zero provider failovers after Alchemy became primary.
- DAS tests cover Helius and QuickNode providers, rejection of standard-only Alchemy RPC, duplicate removal, and a provider-outage fallback case.

## Current DAS limitation

The general LuckyMe pools/API can remain available through standard RPC failover. Compressed-NFT ownership still requires at least one healthy DAS endpoint. The retained Helius endpoint is currently quota-exhausted, the supplied Shyft credential returns HTTP 401, and Alchemy/Chainstack cannot act as DAS replacements. Until a valid Shyft endpoint or a QuickNode endpoint with its free DAS add-on is configured, only NFT ownership verification returns a temporary-unavailable response; normal pools remain online.
