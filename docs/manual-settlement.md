# Manual Settlement

Settlement is permissionless at the program level when the caller supplies the
correct accounts. The backend provides transaction builders that scan Entry
accounts, compute winner and jackpot entries, simulate the unsigned transaction,
and return it for wallet signing.

## Provider Settlement Flow

Use provider settlement for `MAINNET_RELEASE`:

```bash
LUCKYME_RELEASE_MODE=MAINNET_RELEASE \
LUCKYME_SOLANA_CLUSTER=mainnet-beta \
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
LUCKYME_RANDOMNESS_MODE=orao_vrf \
LUCKYME_PRODUCTION_RANDOMNESS=true \
CORS_ORIGIN=https://lucky-me.app \
ENABLE_TRANSACTION_SUBMIT=false \
node backend/src/server.mjs
```

Build the unsigned settlement transaction:

```bash
curl -sS https://api.lucky-me.app/transactions/settle-provider-round \
  -H 'content-type: application/json' \
  -d '{
    "pool": "normal",
    "roundId": 1,
    "settler": "<settler-wallet>"
  }'
```

The response includes Program ID, cluster URL, winner accounts, payout math,
entries scanned, and simulation result. The transaction must still be signed by
the keeper/settler wallet.

## User Refund Flow

When refund state is available:

```bash
curl -sS https://api.lucky-me.app/transactions/refund-entry \
  -H 'content-type: application/json' \
  -d '{
    "pool": "normal",
    "roundId": 1,
    "player": "<player-wallet>"
  }'
```

The returned transaction refunds only the entry owner. The backend does not
redirect refunds to itself.

## Independent Checks

- Confirm `programId` in the response matches the published Program ID.
- Confirm `clusterUrl` points to the intended mainnet RPC.
- Confirm `simulation.ok` is true before signing.
- Confirm winner and jackpot entry accounts correspond to the ticket math shown
  in the response.
