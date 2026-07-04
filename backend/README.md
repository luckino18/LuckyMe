# LuckyMe Backend

The backend is a devnet/store-demo API. It must not decide winners, custody
funds, generate production randomness, or hold private keys.

## Responsibilities

- expose safe public config for the app
- index pools, rounds, entries, winners, refunds, and payouts from Solana
- build unsigned transactions for wallet review/signing
- find winner/jackpot entry accounts for permissionless settlement
- find refundable entries after no-reveal timeout
- support keeper/refund cranking without running keepers inside the public API

## Safe Defaults

```text
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
LUCKYME_RELEASE_MODE=DEVNET_STORE_DEMO
LUCKYME_RANDOMNESS_MODE=commit_reveal_demo
HOST=127.0.0.1
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
MAX_JSON_BYTES=100000
REFUND_SCAN_ROUNDS=20
ENABLE_TRANSACTION_SUBMIT=false
```

Read/build/submit-relay paths use a read-only Anchor wallet and do not read
`ANCHOR_WALLET`. Signer-only authority actions live in scripts.

## Production/Mainnet Guards

- `DEVNET_STORE_DEMO` refuses mainnet RPC.
- `MAINNET_BETA_CANDIDATE` refuses to start unless production randomness is
  enabled.
- Mainnet RPC requires all gates:
  `LUCKYME_ENABLE_MAINNET=true`, `LUCKYME_LEGAL_SIGNOFF=true`,
  `LUCKYME_PRODUCTION_RANDOMNESS=true`, and
  `LUCKYME_MULTISIG_SIGNOFF=true`.
- `NODE_ENV=production` refuses `CORS_ORIGIN=*`.
- `NODE_ENV=production` refuses `ENABLE_TRANSACTION_SUBMIT=true`.
- `NODE_ENV=production` refuses `HOST=0.0.0.0`.

These guards do not make mainnet safe. They prevent accidental exposure while
the project is still devnet-only.

## Local API

Start:

```bash
npm run backend:start
```

For trusted LAN testing with a physical Seeker device:

```bash
HOST=0.0.0.0 ENABLE_TRANSACTION_SUBMIT=true npm run backend:start
```

Useful endpoints:

- `GET /health` - process health plus mode/cluster
- `GET /config` - safe public mode, cluster, program, economics, treasury,
  randomness, and limitation data
- `GET /program` - current program/config/pool state
- `GET /pools` - pool list and recent rounds
- `GET /pools?player=<wallet-public-key>` - includes wallet entry/chance
- `GET /refunds` - recent refundable abandoned entries
- `GET /refunds?pool=mini&roundId=9` - specific refund scan
- `GET /simulate?pool=normal&seed=demo` - deterministic economics simulation
- `POST /transactions/buy-tickets` - unsigned simulated `buy_tickets`
- `POST /transactions/settle-round` - reveal verification and unsigned
  simulated `settle_round`
- `POST /transactions/refund-entry` - unsigned simulated
  `refund_entry_after_timeout`; optional `feePayer` can pay cranking fees
- `POST /transactions/submit` - disabled by default, devnet relay only

## Examples

Build buy transaction:

```bash
curl -s -X POST http://localhost:8788/transactions/buy-tickets \
  -H 'content-type: application/json' \
  -d '{"player":"<wallet-public-key>","pool":"normal","ticketCount":1}'
```

Build refund transaction with a separate fee payer:

```bash
curl -s -X POST http://localhost:8788/transactions/refund-entry \
  -H 'content-type: application/json' \
  -d '{"player":"<entrant-wallet>","feePayer":"<optional-fee-payer>","pool":"normal","roundId":1}'
```

Build settlement transaction:

```bash
curl -s -X POST http://localhost:8788/transactions/settle-round \
  -H 'content-type: application/json' \
  -d '{"settler":"<wallet-paying-fees>","pool":"normal","roundId":1,"randomnessReveal":"<32-byte-hex-reveal>"}'
```

## Refund Cranking

Refunds are permissionless: `player` is not a signer and the program transfers
only to `entry.player`. A keeper can pay fees and clear abandoned rounds without
redirecting funds.

```bash
curl -s http://localhost:8788/refunds
DRY_RUN=true npm run refund:crank
POOL=mini ROUND_ID=9 npm run refund:crank
```
