# lucky-me.app Static Site

Static public pages for:

- `https://lucky-me.app`
- `https://lucky-me.app/play/`
- `https://lucky-me.app/terms/`
- `https://lucky-me.app/privacy/`
- `https://lucky-me.app/support/`

`/` is the landing page. `/play/` is the browser dapp shell with pool views,
browser wallet connection, transaction review, and safe unavailable states while
the mainnet program/backend state is not live.

Wallet UI rules:

- Public UI shows one `Connect wallet` action.
- After click, the chooser shows detected Solana browser wallets.
- On mobile Chrome, where Solana providers are not injected, the chooser offers
  neutral app-browser actions for Phantom, Solflare, and Backpack.
- WalletConnect/Reown is configured through
  `window.LUCKYME_WALLETCONNECT_PROJECT_ID` in `/config.js`; keep the Reown
  project allowlist on `https://lucky-me.app` and `https://www.lucky-me.app`.
- Do not show wallet prompts that read as app installation, promoted wallet
  marketing, or disabled wallet providers.

Deployment target on the VPS:

`/var/www/luckyme/public`

The API subdomain is handled separately by nginx and proxies to the LuckyMe
backend on `127.0.0.1:8788`.

For browser play on both apex and `www`, backend CORS must include both origins:

```bash
export CORS_ORIGIN=https://lucky-me.app,https://www.lucky-me.app
```
