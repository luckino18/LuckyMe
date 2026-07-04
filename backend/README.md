# LuckyMe Backend

The backend should not decide winners or custody funds.

MVP responsibilities:

- index pools, rounds, entries, winners, and payouts from Solana
- expose a fast read API for the mobile app
- find the entry account that contains the winning ticket so anyone can call settlement
- send push notifications after joins, wins, and jackpot hits

Do not put game-critical randomness here.

## Local API

Start with:

```bash
npm run backend:start
```

Useful endpoints:

- `GET /health` - process health
- `GET /program` - current program/config/pool state from the configured Anchor provider
- `GET /pools` - pool list, config, vault addresses, and recent rounds, using on-chain data when available and static metadata as fallback
- `GET /pools?player=<wallet-public-key>` - also includes that wallet's per-round entry and chance when an entry exists
- `GET /simulate?pool=normal&seed=demo` - deterministic economics simulation
- `POST /transactions/buy-tickets` - builds an unsigned `buy_tickets` transaction for a player wallet and simulates it with `sigVerify=false`; returns `409 already_entered_round` if that wallet already has tickets in the current round
- `POST /transactions/refund-entry` - builds an unsigned `refund_entry_after_timeout` transaction for a wallet entry after the no-reveal timeout
- `POST /transactions/submit` - submits a wallet-signed transaction to the configured Anchor provider

The backend reads:

- `ANCHOR_PROVIDER_URL=http://127.0.0.1:8899`
- `ANCHOR_WALLET=~/.config/solana/id.json`
- `CORS_ORIGIN=*`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=120`
- `MAX_JSON_BYTES=100000`
- `ENABLE_TRANSACTION_SUBMIT=true`

For a public production deployment, set a strict `CORS_ORIGIN`, keep the rate
limit behind a real proxy/WAF, and set `ENABLE_TRANSACTION_SUBMIT=false` unless
the relay is intentionally operated and monitored.

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
  -d '{"player":"<wallet-public-key>","pool":"normal","roundId":1}'
```

The backend must not sign player transactions. The mobile wallet signs the
returned base64 transaction only after user approval, then the app posts the
signed transaction to `/transactions/submit`.
