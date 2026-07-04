# Mainnet Readiness Gates

LuckyMe is not mainnet-ready. This document defines the gates that must be
complete before anyone can remove the devnet/localnet warning from the README.

## Non-Negotiable Launch Gates

| Gate | Required Evidence |
| --- | --- |
| Production randomness | ORAO provider path is implemented, but mainnet still needs funded devnet evidence, provider monitoring, operational signoff, and final audit proof that commit-reveal cannot be used for mainnet settlement. |
| Legal/compliance | Written legal opinion for target jurisdictions, age gate, geofencing policy, terms, privacy policy, responsible gaming controls, tax/payout policy, and free-entry/sweepstakes analysis if applicable. |
| Multisig authorities | Upgrade authority, treasury, pause/admin authority, and keeper roles separated and documented. Upgrade authority should not be a single hot wallet. |
| Economics signoff | Mainnet candidate uses 1 hour rounds, 1% house fee, and either the documented 1% jackpot or a reviewed no-jackpot configuration. |
| Independent audit | External audit against the final commit, generated IDL/SDK, deployed program id, and reproducible build artifact. |
| Production backend | Strict CORS, proxy/WAF, persistent IP/wallet rate limiting, monitoring, alerting, body-size controls, no private key on the server, and submit relay disabled unless explicitly operated. |
| Indexer and cranking | Public indexer/event parser or equivalent open tooling for settlement and refund discovery, plus runbooks for abandoned rounds. |
| Security program | Private vulnerability contact, formal disclosure process, response SLA, and funded bug bounty or equivalent commitment. |
| Responsible operations | Incident response runbook, public program id verification, reproducible build notes, release process, rollback/pause policy, and treasury/accounting process. |

## Runtime Guardrails Already In Repo

The backend refuses mainnet RPC unless all four environment variables are set:

```bash
LUCKYME_ENABLE_MAINNET=true
LUCKYME_LEGAL_SIGNOFF=true
LUCKYME_PRODUCTION_RANDOMNESS=true
LUCKYME_MULTISIG_SIGNOFF=true
```

`MAINNET_BETA_CANDIDATE` also refuses `commit_reveal_demo`; it requires:

```bash
LUCKYME_RANDOMNESS_MODE=orao_vrf
LUCKYME_PRODUCTION_RANDOMNESS=true
```

`NODE_ENV=production` also refuses:

- `CORS_ORIGIN=*`
- `ENABLE_TRANSACTION_SUBMIT=true`
- `HOST=0.0.0.0`

These checks are not a substitute for the gates above. They are there to prevent
accidental production exposure while the project is still an MVP.

## Randomness Status

Selected first provider: ORAO Classic VRF.

Implemented in this repo:

- `request_randomness` records an ORAO seed and request PDA in a
  `RoundRandomness` sidecar after a round closes. The seed includes final round
  ticket state and the request instruction slot, so the exact seed is not fully
  knowable before ticket sales end.
- `settle_round_with_provider_randomness` verifies the ORAO request owner, PDA,
  seed, and fulfilled `RandomnessV2` account before deriving the winner.
- Backend exposes `/transactions/request-randomness`,
  `/rounds/:round/randomness`, and `/transactions/settle-provider-round`.
- Keeper scripts expose `npm run randomness:request`,
  `npm run randomness:status`, and `npm run randomness:settle`.
- Commit-reveal settlement remains only for `DEVNET_STORE_DEMO`.

Still required before mainnet:

- run and archive a funded devnet ORAO request, fulfillment, and settlement
  transcript;
- monitor pending ORAO requests and abandoned rounds;
- document keeper wallet funding and fee policy;
- get the final deployed commit externally audited;
- keep no-reveal refund as a backup recovery path, not as the fairness source.

## Current Demo Economics

- winner: 98%
- house: 1%
- jackpot contribution: 1%
- round duration: 3600 seconds

Changing these requires updating simulator tests, init scripts, backend static
config, app fallback config, docs, and store copy in the same commit.
