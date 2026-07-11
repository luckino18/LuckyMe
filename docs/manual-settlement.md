# Manual Settlement

Operational settlement is restricted by the on-chain `KeeperConfig`. The
backend provides transaction builders that scan Entry accounts, compute winner
and jackpot entries, simulate the unsigned transaction, and return it only when
the proposed signer matches the configured keeper.

## Provider Settlement Flow

Provider settlement applies only after an expired round reaches its draw
minimum: Mini 25 tickets, Normal 13, High 3, or Premium 3 tickets from 3
distinct wallets. A below-target round must take the automatic refund path and
must never request ORAO.

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

The preferred production operation is the one-shot settlement keeper:

```bash
npm run settlement:keeper
```

It is dry-run by default. Mainnet writes require:

```bash
DRY_RUN=false \
CONFIRM_MAINNET_SETTLEMENT_KEEPER=true \
npm run settlement:keeper
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
the configured keeper wallet. The production keeper is
`6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`; the backend, signer file, and
on-chain `KeeperConfig` must agree before signing.

Commit-reveal settlement is restricted to local builds compiled with the test
timer feature. `scripts/settle-round.mjs` and the standalone manual round opener
refuse mainnet even if a generic confirmation variable is present. Production
uses ORAO and `settle_round_with_provider_randomness` only.

## Automatic Below-Minimum Refund Flow

There is no player claim transaction and no public refund builder. The backend
route `POST /transactions/refund-entry` returns HTTP `410` with
`automatic_refund_only`. Refund instructions require both the authorized keeper
signer and the on-chain `KeeperConfig` PDA.

After the one-hour round expires below its applicable target and the production
600-second refund delay elapses, `settlement:keeper`:

1. identifies every live Entry for the round;
2. records restart-safe progress in the refund journal;
3. simulates and submits at most the configured action limit;
4. returns the Entry's complete ticket principal to its stored player;
5. closes the Entry and returns its rent to that same player;
6. archives refund completion, closes the empty Round to treasury, and only
   then permits the next waiting round to open.

Network fees already paid to Solana are not refundable. The program prevents a
refund-mode Entry or Round from being closed early while refundable balances
remain. `npm run refund:crank` is retained only as read-only inspection and
refuses write mode; all production refunds go through the journaled settlement
keeper.

## Independent Checks

- Confirm `programId` in the response matches the published Program ID.
- Confirm `clusterUrl` points to the intended mainnet RPC.
- Confirm `KeeperConfig` is
  `8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y` and authorizes the production
  keeper public key.
- Confirm `simulation.ok` is true before signing.
- Confirm winner and jackpot entry accounts correspond to the ticket math shown
  in the response.
