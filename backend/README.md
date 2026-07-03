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
- `GET /pools` - pool list, using on-chain data when available and static metadata as fallback
- `GET /simulate?pool=normal&seed=demo` - deterministic economics simulation
- `POST /transactions/buy-tickets` - builds an unsigned `buy_tickets` transaction for a player wallet and simulates it with `sigVerify=false`
- `POST /transactions/submit` - submits a wallet-signed transaction to the configured Anchor provider

The backend reads `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET`. Defaults:

- `ANCHOR_PROVIDER_URL=http://127.0.0.1:8899`
- `ANCHOR_WALLET=~/.config/solana/id.json`

Example transaction build request:

```bash
curl -s -X POST http://localhost:8788/transactions/buy-tickets \
  -H 'content-type: application/json' \
  -d '{"player":"<wallet-public-key>","pool":"normal","ticketCount":1}'
```

The backend must not sign player transactions. The mobile wallet signs the
returned base64 transaction only after user approval, then the app posts the
signed transaction to `/transactions/submit`.
