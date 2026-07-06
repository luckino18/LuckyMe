# LuckyMe Backend

The backend is a Solana mainnet transaction builder and public state API. It
does not decide winners, does not sign player transactions, and does not custody
user funds.

## Mainnet Release Env

```bash
export LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export LUCKYME_SOLANA_CLUSTER=mainnet-beta
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export LUCKYME_RANDOMNESS_MODE=orao_vrf
export LUCKYME_PRODUCTION_RANDOMNESS=true
export HOST=0.0.0.0
export PORT=8788
export CORS_ORIGIN=https://lucky-me.app
export ENABLE_TRANSACTION_SUBMIT=false
node backend/src/server.mjs
```

`MAINNET_RELEASE` fails during startup when:

- `ANCHOR_PROVIDER_URL` is missing;
- the RPC URL is not HTTPS;
- `LUCKYME_SOLANA_CLUSTER` is not `mainnet-beta`;
- randomness is not `orao_vrf`;
- `LUCKYME_PRODUCTION_RANDOMNESS` is not `true`;
- host/port config is invalid or loopback is used outside local development;
- CORS is wildcard;
- the public submit relay is enabled.

## Endpoints

- `GET /health` - service mode and cluster
- `GET /config` - public release config, economics, Program ID, randomness mode
- `GET /program` - current on-chain program/config/pool state
- `GET /pools?player=<wallet>` - pools, active round, user entry, recent rounds
- `GET /refunds` - refundable entries discovered by the scanner
- `GET /rounds/:pool/:roundId/randomness` - ORAO provider sidecar status
- `POST /transactions/buy-tickets` - builds and simulates an unsigned buy tx
- `POST /transactions/refund-entry` - builds and simulates an unsigned refund tx
- `POST /transactions/request-randomness` - builds an unsigned keeper request tx
- `POST /transactions/settle-provider-round` - builds an unsigned provider settlement tx
- `POST /transactions/submit` - disabled by default and should stay disabled for production

## Production Safety

The API returns an unavailable state instead of fake pool data when mainnet
on-chain state cannot be read. Player transactions are always returned unsigned
for Mobile Wallet Adapter signing.

Use a production HTTPS reverse proxy or managed platform in front of this
process. Keep CORS restricted to the production app origin and apply upstream
rate limiting/WAF controls for public deployments.

## Local Development

```bash
LUCKYME_RELEASE_MODE=LOCAL_DEVELOPMENT \
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
LUCKYME_RANDOMNESS_MODE=commit_reveal_demo \
node backend/src/server.mjs
```
