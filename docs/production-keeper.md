# Production Keeper

The keeper submits operational transactions after rounds close. It does not hold
player funds and does not sign player ticket purchases.

## Environment

```bash
export LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export LUCKYME_SOLANA_CLUSTER=mainnet-beta
export ANCHOR_PROVIDER_URL=https://rpc.your-domain.com
export LUCKYME_RANDOMNESS_MODE=orao_vrf
export LUCKYME_PRODUCTION_RANDOMNESS=true
export ANCHOR_WALLET=/secure/path/keeper.json
```

Use a dedicated keeper wallet funded only for transaction fees and provider
operations.

## Commands

Request provider randomness:

```bash
npm run randomness:request -- --pool normal --round 1
```

Check provider status:

```bash
npm run randomness:status -- --pool normal --round 1
```

Settle with fulfilled provider randomness:

```bash
npm run randomness:settle -- --pool normal --round 1
```

Crank refundable entries:

```bash
npm run refund:crank
```

## Operating Checks

- Confirm the wallet is the intended keeper before signing.
- Confirm RPC endpoint and cluster are mainnet-beta.
- Confirm Program ID in command output.
- Confirm settlement simulation succeeds before submitting.
- Store transaction signatures and round IDs for release operations records.
