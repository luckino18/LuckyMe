# Keeper Architecture

Keepers must run separately from the public backend. The public backend should
only expose read APIs and unsigned transaction builders.

## Scripts

- `npm run round:open`
- `npm run round:settle`
- `npm run round:close-empty`
- `npm run refund:crank`
- `npm run randomness:request`
- `npm run randomness:status`
- `npm run randomness:settle`

All signing scripts print cluster and fee payer. `round:open`, `round:settle`,
`round:close-empty`, `refund:crank`, `randomness:request`, and
`randomness:settle` refuse mainnet unless `CONFIRM_MAINNET=true`.
`randomness:status` is read-only.

## Dry Runs

```bash
DRY_RUN=true npm run round:open
DRY_RUN=true POOL=normal ROUND_ID=1 RANDOMNESS_REVEAL=<32-byte-hex> npm run round:settle
DRY_RUN=true POOL=normal ROUND_ID=1 npm run round:close-empty
DRY_RUN=true npm run refund:crank
LUCKYME_RANDOMNESS_MODE=orao_vrf DRY_RUN=true POOL=normal ROUND_ID=1 npm run randomness:request
LUCKYME_RANDOMNESS_MODE=orao_vrf POOL=normal ROUND_ID=1 npm run randomness:status
LUCKYME_RANDOMNESS_MODE=orao_vrf DRY_RUN=true POOL=normal ROUND_ID=1 npm run randomness:settle
```

## DEVNET_STORE_DEMO

- Open rounds hourly or manually for review.
- Store reveal files securely outside the repo.
- Settle only after the round ends.
- If a round expires with zero entrants, use `npm run round:close-empty`.
- If reveal is missing, use `GET /refunds` and `npm run refund:crank`.

## ORAO VRF Operations

For `LUCKYME_RANDOMNESS_MODE=orao_vrf`:

1. After the round closes, run `npm run randomness:request`.
2. Confirm the LuckyMe sidecar and ORAO request PDA in
   `npm run randomness:status`.
3. Wait for ORAO fulfillment.
4. Run `npm run randomness:settle`.
5. If fulfillment never arrives and the refund timeout passes, use `GET /refunds`
   and `npm run refund:crank`.

The public backend can build unsigned provider transactions, but it must not
hold the keeper wallet. ORAO request fees are paid by the keeper wallet.

## MAINNET_BETA_CANDIDATE

Not ready. Before mainnet keepers:

- archive a funded devnet ORAO request/fulfillment/settlement transcript
- move authorities to multisig
- use monitored dedicated RPC
- add alerting for stuck rounds, failed settlements, and refund backlog
- define incident response and pause policy
- document keeper wallet funding and rotation
