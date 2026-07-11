# lucky-me.app Static Site

Static public pages for:

- `https://lucky-me.app`
- `https://lucky-me.app/play/`
- `https://lucky-me.app/how-to-play/`
- `https://lucky-me.app/terms/`
- `https://lucky-me.app/privacy/`
- `https://lucky-me.app/support/`

`/` is the landing page. `/play/` is the browser dapp shell with pool views,
browser wallet connection, transaction review, and safe unavailable states while
the mainnet program/backend state is not live.

Wallet UI rules:

- Public UI shows one `Connect wallet` action.
- After click, the chooser uses the Wallet Standard registration protocol and
  shows only detected wallets that support Solana mainnet plus legacy
  transaction signing. Known injected providers are a compatibility fallback,
  and are also hidden unless they expose both connection and signing methods.
- Connected public keys must be valid, on-curve Solana signer accounts. Account
  changes and disconnect events clear stale transaction state before reload.
- On mobile Chrome, where Solana providers are not injected, the chooser offers
  neutral app-browser actions for Phantom, Solflare, and Backpack.
- WalletConnect/Reown is configured through
  `window.LUCKYME_WALLETCONNECT_PROJECT_ID` in `/config.js`; keep the Reown
  project allowlist on `https://lucky-me.app` and `https://www.lucky-me.app`.
  The namespace is mainnet-only, and the custom chooser displays the session
  URI and connection errors even when the Reown QR overlay cannot load.
- Do not show wallet prompts that read as app installation, promoted wallet
  marketing, or disabled wallet providers.

Pool UX rules:

- Mini / Normal / High / Premium minimum ticket targets are `25 / 13 / 3 / 3`.
- The target is total tickets sold, not distinct players; Premium additionally
  requires three distinct wallets and keeps one ticket per wallet.
- Progress is rendered only from verified `/pools` round fields. Missing Round
  state or missing minimum-policy fields keeps buying disabled.
- Below-target expiry is shown as an automatic refund. Public copy promises the
  full ticket purchase amount, while clearly noting that Solana network fees
  are not refundable.

Deployment target on the VPS:

`/var/www/luckyme/public`

The API subdomain is handled separately by nginx and proxies to the LuckyMe
backend on `127.0.0.1:8788`.

For browser play on both apex and `www`, backend CORS must include both origins:

```bash
export CORS_ORIGIN=https://lucky-me.app,https://www.lucky-me.app
```
