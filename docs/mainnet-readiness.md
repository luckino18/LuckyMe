# Mainnet Readiness Gates

LuckyMe is not mainnet-ready. This document defines the gates that must be
complete before anyone can remove the devnet/localnet warning from the README.

## Non-Negotiable Launch Gates

| Gate | Required Evidence |
| --- | --- |
| Production randomness | Chosen provider/design, on-chain integration, async fulfillment/fallback tests, public provider account documentation, and proof that the operator cannot selectively finalize only favorable rounds. |
| Legal/compliance | Written legal opinion for target jurisdictions, age gate, geofencing policy, terms, privacy policy, responsible gaming controls, tax/payout policy, and free-entry/sweepstakes analysis if applicable. |
| Multisig authorities | Upgrade authority, treasury, pause/admin authority, and keeper roles separated and documented. Upgrade authority should not be a single hot wallet. |
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

`NODE_ENV=production` also refuses:

- `CORS_ORIGIN=*`
- `ENABLE_TRANSACTION_SUBMIT=true`
- `HOST=0.0.0.0`

These checks are not a substitute for the gates above. They are there to prevent
accidental production exposure while the project is still an MVP.

## Randomness Options To Evaluate

The current commit-reveal path remains only a devnet MVP. Before mainnet, select
and implement one of:

- Switchboard randomness with the documented commit/generate/reveal flow and
  payment taken before user outcomes can be evaluated.
- ORAO VRF with CPI request/fulfillment and provider-account documentation.
- Another verifiable randomness provider with equivalent censorship/fallback
  guarantees.
- Bonded multi-party commit-reveal where withholding has a clear economic
  penalty and fallback path.

Any solution must preserve the no-reveal refund path as a recovery backup, not
as the primary fairness mechanism.
