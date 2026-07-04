# Audit Closure Matrix

Last updated: 2026-07-04

This file maps the external audit findings to current repository controls. It
does not claim mainnet readiness. LuckyMe remains devnet/localnet only until the
external launch gates in `docs/mainnet-readiness.md` are complete.

## Status Legend

- Fixed in repo: implemented and covered by local checks/tests.
- Mitigated for devnet: safer for MVP/devnet, but not a production guarantee.
- External blocker: cannot be honestly closed by code changes alone.

## Critical Findings

| Finding | Status | Closure |
| --- | --- | --- |
| Multi-buy/ticket accounting allowed a wallet to extend an entry across multiple purchases | Fixed in repo | `buy_tickets` rejects any initialized entry with `AlreadyEnteredRound`. Backend preflight also returns `409 already_entered_round`. Anchor localnet tests cover duplicate buy rejection. |
| No-reveal could permanently lock pool-vault funds | Fixed in repo | `refund_entry_after_timeout` opens refund mode after `round.end_ts + 600`. Anchor localnet tests cover first refund, second refund, blocked settlement after refund mode, duplicate refund rejection, and final vault balance returning to the pre-round value. |
| Commit-reveal randomness can be selectively withheld | External blocker | The refund path prevents permanent lockup but does not make the game fair for real-money mainnet. Mainnet requires a production randomness integration, such as VRF/Entropy with verifiable fulfillment, or bonded multi-party commit-reveal with slashing and fallback. Backend now refuses mainnet RPC unless `LUCKYME_PRODUCTION_RANDOMNESS=true` is explicitly set with the other launch signoffs. |
| Refund can turn reveal withholding into selective round cancellation | Mitigated for devnet, external blocker for mainnet | Refund mode is intentionally documented as recovery, not fairness. `GET /refunds` and `npm run refund:crank` make abandoned-round refunds discoverable and crankable, but production fairness still requires the randomness launch gate. |

## High Findings

| Finding | Status | Closure |
| --- | --- | --- |
| Settlement depends on correct `winner_entry`/`jackpot_entry` | Mitigated for devnet | `POST /transactions/settle-round` verifies the reveal, scans on-chain `Entry` accounts, computes winner/jackpot entry accounts, and simulates the unsigned transaction. `docs/manual-settlement.md` documents the independent flow. Program events now expose round, buy, settle, refund, pool, config, and pause state for indexers. |
| Backend exposed as production API can be abused | Mitigated for devnet | Backend defaults to `HOST=127.0.0.1`, `ENABLE_TRANSACTION_SUBMIT=false`, JSON body limit, IP-level and wallet-level in-memory rate limits, and strict production runtime checks. Production mode refuses wildcard CORS, submit relay, and direct `0.0.0.0` bind. Edge WAF/proxy remains required for any public deployment. |
| Backend/local scripts can read a private wallet | Fixed for backend read/build paths | `createClient({ requireSigner: false })` uses a read-only wallet. Backend read/build/submit-relay code no longer reads `ANCHOR_WALLET` or `~/.config/solana/id.json`. Authority scripts still require an explicit local signer because they send keeper/admin transactions. |
| Legal/compliance unresolved | External blocker | `README.md`, `SECURITY.md`, and `docs/mainnet-readiness.md` keep legal review as a hard launch gate. Backend refuses mainnet RPC unless `LUCKYME_LEGAL_SIGNOFF=true` is explicitly set. Code cannot substitute for a written legal opinion, age/geofence policy, terms, privacy, tax/payout policy, and responsible gaming controls. |

## Medium Findings

| Finding | Status | Closure |
| --- | --- | --- |
| CI lacked Anchor localnet coverage | Fixed in repo | GitHub Actions installs Solana CLI and Anchor CLI, runs `NO_DNA=1 anchor build --provider.cluster localnet`, and runs `npm run test:anchor`. |
| Refund state machine needs aggressive tests | Fixed in repo | `tests/anchor-localnet.test.mjs` covers the money-moving refund and settlement state machine, zero-entry round close, and zero-space vault balance consistency. |
| Refund UX can leave users unaware | Mitigated for devnet | Mobile app exposes `Refund entry` for connected refundable entries. Backend exposes `GET /refunds`. `scripts/refund-cranker.mjs` lets a keeper crank refunds permissionlessly while funds still go to `entry.player`. |
| PDA vaults with manual lamport transfers need balance tests | Fixed in repo for current flows | Anchor localnet tests assert pool vault balance after buy, after settlement rejection path, after partial refund, and after all refunds. |
| Security policy incomplete for production | Mitigated for devnet, external blocker for mainnet | `SECURITY.md` now defines scope, reporting, severity, response targets, and incident response. Mainnet still requires a dedicated private contact, formal disclosure process, and funded bug bounty. |

## Low / Trust Findings

| Finding | Status | Closure |
| --- | --- | --- |
| Repo is young with little public history | External/non-code | Cannot be fixed instantly. Documentation now avoids overclaiming and keeps devnet-only status explicit. |
| Dev/prod documentation needed clearer separation | Fixed in repo | `README.md`, `backend/README.md`, `docs/devnet-checklist.md`, `docs/mainnet-readiness.md`, and `SECURITY.md` separate devnet operation from mainnet launch gates. |
| Store-readiness documentation missing | Fixed in repo | `docs/store-readiness.md`, `docs/legal-risk.md`, `docs/randomness.md`, `docs/production-keeper.md`, and `docs/final-readiness-audit.md` document the devnet store-demo path and external blockers. |

## Current Hard Blockers For Mainnet

These are intentionally not marked fixed:

1. Production randomness integration selected, implemented, tested, and deployed.
2. Written legal/compliance signoff for target jurisdictions.
3. Upgrade authority, treasury, and pause/admin authority moved to multisig.
4. Production backend deployment behind proxy/WAF with persistent rate limiting,
   monitoring, alerting, and no public submit relay unless intentionally run.
5. Private security contact, formal disclosure process, and real bounty policy.
6. Independent audit against the final mainnet candidate commit and deployed
   program binary.

Until those are done, the correct verdict remains: devnet/demo yes, mainnet with
real funds no.

For Solana dApp Store / Seeker Store submission, the current target is
`DEVNET_STORE_DEMO`; `MAINNET_BETA_CANDIDATE` remains disabled.
