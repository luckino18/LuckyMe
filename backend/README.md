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

The backend reads `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET`. Defaults:

- `ANCHOR_PROVIDER_URL=http://127.0.0.1:8899`
- `ANCHOR_WALLET=~/.config/solana/id.json`
