# LuckyMe Seeker cNFT Campaign — Phase 1

Status: local read-only tooling. No mint, signing, deployment, or mainnet write is authorized by this phase.

## First objective

Create a reproducible snapshot of wallets currently associated with the official Seeker Genesis Token group, then rank verified candidates before any cNFT is created.

## Safety boundary

- The Helius endpoint is read only and is supplied through `SEEKER_SGT_RPC_URL` or the existing `ANCHOR_PROVIDER_URL`.
- The endpoint and API key are never written to snapshot output.
- Discovery records the DAS `last_indexed_slot` and a deterministic snapshot hash.
- One candidate wallet may hold more than one SGT; the snapshot preserves every SGT mint but creates only one wallet candidate.
- The mint queue generator is deliberately marked `dry-run-only` and contains no transaction builder or signer.

## Discovery

```bash
SEEKER_SGT_RPC_URL='https://mainnet.helius-rpc.com/?api-key=...' \
  npm run campaign:sgt:snapshot
```

Default output:

`artifacts/seeker-cnft-campaign/sgt-holders.json`

SGT is a Token-2022 group, not a classic DAS collection. Discovery therefore paginates `getProgramAccountsV2` and applies four binary filters: the exact mint-account size, official mint authority, official group-member pointer and official token-group-member address. Current holders are resolved from finalized Token-2022 accounts. Before minting, every selected SGT mint and current owner must still be revalidated against finalized account data.

## Ranking contract

Ranking is lexicographic and intentionally easy to audit:

1. distinct active days in the measurement window, descending;
2. successful transactions where the wallet is an actual signer, descending;
3. last active Solana slot, descending;
4. wallet address, ascending, as the deterministic final tie-breaker.

Incoming spam transfers must not count as wallet activity. The activity collector therefore needs parsed transactions and must confirm the candidate wallet appears in the signer set.

## Gate before Phase 2

Phase 2 may begin only after a report contains:

- snapshot slot and hash;
- total authentic SGT assets and unique current wallets;
- measurement window and complete ranking formula;
- Top 10,000 candidate list;
- RPC credit estimate;
- zero duplicate wallet recipients;
- manual approval of the final recipient snapshot.
