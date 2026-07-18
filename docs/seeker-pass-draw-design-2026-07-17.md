# LuckyMe Seeker Pass — 3 SOL promotion

Status: release implementation. Registration is free; prize funding and payout remain disabled until a later explicit funding operation.

## Campaign contract

- Campaign: `luckyme-seeker-pass-3-sol-1000-2026`.
- Eligibility: signing wallet owns an active cNFT in the official LuckyMe Seeker Pass collection.
- Entry: one SIWS authentication signature, no transaction and no fee.
- Deduplication: one entry per wallet and one entry per cNFT asset.
- Threshold: exactly 1,000 verified unique entries.
- Draw: automatic, 20 unique winners, 3 SOL total.
- Prizes in SOL by rank: `.58, .35, .27, .22, .19, .17, .15, .14, .13, .12, .11, .10, .09, .08, .05, .05, .05, .05, .05, .05`.
- Funding state: not loaded. The implementation contains no automatic transfer path and payout stays locked until funding is separately confirmed.

## Verification and draw evidence

1. Backend issues a short-lived, single-use, campaign-bound SIWS nonce.
2. Signature is verified server-side and DAS confirms wallet ownership, collection, compression state, tree and creator.
3. A database transaction inserts an idempotent entry keyed by campaign, wallet and asset.
4. The 1,000th entry freezes a SHA-256 commitment over the ordered entry list.
5. A future Solana slot is committed before its blockhash exists.
6. Once that slot is finalized, its blockhash plus the frozen commitment deterministically select 20 distinct entry indexes using rejection sampling.
7. The admin promotion record publishes the commitment, target/resolved slots, blockhash digest, full prize schedule and winners.

## Acquisition analytics

The Solana dApp Store does not provide a certified download total. The store APK therefore reports privacy-preserving first activations and launches. The backend stores only an HMAC of the random installation ID and aggregates unique activations, active installations, launches, versions and channels. Admin labels these figures as activation estimates, not certified store downloads.
