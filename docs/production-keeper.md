# Keeper Architecture

Keepers must run separately from the public backend. The public backend should
only expose read APIs and unsigned transaction builders.

## Scripts

- `npm run round:open`
- `npm run round:settle`
- `npm run round:close-empty`
- `npm run refund:crank`

All scripts print cluster and fee payer. `round:open`, `round:settle`,
`round:close-empty`, and `refund:crank` refuse mainnet unless
`CONFIRM_MAINNET=true`.

## Dry Runs

```bash
DRY_RUN=true npm run round:open
DRY_RUN=true POOL=normal ROUND_ID=1 RANDOMNESS_REVEAL=<32-byte-hex> npm run round:settle
DRY_RUN=true POOL=normal ROUND_ID=1 npm run round:close-empty
DRY_RUN=true npm run refund:crank
```

## DEVNET_STORE_DEMO

- Open rounds hourly or manually for review.
- Store reveal files securely outside the repo.
- Settle only after the round ends.
- If a round expires with zero entrants, use `npm run round:close-empty`.
- If reveal is missing, use `GET /refunds` and `npm run refund:crank`.

## MAINNET_BETA_CANDIDATE

Not ready. Before mainnet keepers:

- replace commit-reveal with production randomness
- move authorities to multisig
- use monitored dedicated RPC
- add alerting for stuck rounds, failed settlements, and refund backlog
- define incident response and pause policy
- document keeper wallet funding and rotation
