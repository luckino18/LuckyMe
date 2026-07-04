# LuckyMe Backend

The backend should not decide winners or custody funds.

MVP responsibilities:

- index pools, rounds, entries, winners, and payouts from Solana
- expose a fast read API for the mobile app
- find the entry account that contains the winning ticket so anyone can call settlement
- find refundable entries after a no-reveal timeout so a keeper can crank refunds
- send push notifications after joins, wins, and jackpot hits

Do not put game-critical randomness here.

## Local API

Start with:

```bash
npm run backend:start
```

Default bind address is `127.0.0.1`. For physical-device devnet tests on a
trusted LAN, start with `HOST=0.0.0.0`. Production mode refuses that direct bind;
put the API behind a proxy/WAF instead.

Useful endpoints:

- `GET /health` - process health
- `GET /program` - current program/config/pool state from the configured Anchor provider
- `GET /pools` - pool list, config, vault addresses, and recent rounds, using on-chain data when available and static metadata as fallback
- `GET /pools?player=<wallet-public-key>` - also includes that wallet's per-round entry and chance when an entry exists
- `GET /refunds` - scans recent initialized rounds and returns refundable entries after the no-reveal timeout
- `GET /refunds?pool=mini&roundId=9` - narrows refund discovery to a specific pool/round
- `GET /simulate?pool=normal&seed=demo` - deterministic economics simulation
- `POST /transactions/buy-tickets` - builds an unsigned `buy_tickets` transaction for a player wallet and simulates it with `sigVerify=false`; returns `409 already_entered_round` if that wallet already has tickets in the current round
- `POST /transactions/settle-round` - verifies a reveal, scans round entries, computes the winner/jackpot accounts, and builds an unsigned simulated `settle_round` transaction for the fee-paying settler wallet
- `POST /transactions/refund-entry` - builds an unsigned `refund_entry_after_timeout` transaction for a wallet entry after the no-reveal timeout; optional `feePayer` lets a cranker pay fees while the refund still goes to `entry.player`
- `POST /transactions/submit` - disabled by default; submits a wallet-signed transaction only when `ENABLE_TRANSACTION_SUBMIT=true`

The backend reads:

- `ANCHOR_PROVIDER_URL=http://127.0.0.1:8899`
- `HOST=127.0.0.1`
- `CORS_ORIGIN=*`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=120`
- `MAX_JSON_BYTES=100000`
- `REFUND_SCAN_ROUNDS=20`
- `ENABLE_TRANSACTION_SUBMIT=false`

The backend uses a read-only Anchor wallet for read/build/submit-relay paths and
does not read `ANCHOR_WALLET`. Scripts that send authority/keeper transactions
still use `ANCHOR_WALLET` explicitly.

Production/mainnet guardrails:

- Mainnet RPC is refused unless all four gates are explicitly set:
  `LUCKYME_ENABLE_MAINNET=true`, `LUCKYME_LEGAL_SIGNOFF=true`,
  `LUCKYME_PRODUCTION_RANDOMNESS=true`, and
  `LUCKYME_MULTISIG_SIGNOFF=true`.
- `NODE_ENV=production` refuses `CORS_ORIGIN=*`.
- `NODE_ENV=production` refuses `ENABLE_TRANSACTION_SUBMIT=true`.
- `NODE_ENV=production` refuses `HOST=0.0.0.0`.

For a public deployment, keep the API behind a real proxy/WAF, use strict CORS,
rate-limit by IP and wallet at the edge, and keep `/transactions/submit`
disabled unless the relay is intentionally operated and monitored.

Example transaction build request:

```bash
curl -s -X POST http://localhost:8788/transactions/buy-tickets \
  -H 'content-type: application/json' \
  -d '{"player":"<wallet-public-key>","pool":"normal","ticketCount":1}'
```

Example refund transaction build request:

```bash
curl -s -X POST http://localhost:8788/transactions/refund-entry \
  -H 'content-type: application/json' \
  -d '{"player":"<entrant-wallet>","feePayer":"<optional-fee-payer>","pool":"normal","roundId":1}'
```

Example settlement transaction build request:

```bash
curl -s -X POST http://localhost:8788/transactions/settle-round \
  -H 'content-type: application/json' \
  -d '{"settler":"<wallet-paying-fees>","pool":"normal","roundId":1,"randomnessReveal":"<32-byte-hex-reveal>"}'
```

The backend must not sign player transactions. The mobile wallet signs the
returned base64 transaction only after user approval. If a submit relay is
enabled for devnet, the app can post the signed transaction to
`/transactions/submit`.

## Refund Cranking

Refunds are permissionless: the `player` account is not a signer, and the
program transfers lamports only to `entry.player`. A keeper can therefore pay
the transaction fee and clear abandoned rounds without redirecting funds.

Discover refundable entries:

```bash
curl -s http://localhost:8788/refunds
```

Run the cranker with a local keeper wallet:

```bash
DRY_RUN=true npm run refund:crank
POOL=mini ROUND_ID=9 npm run refund:crank
```
