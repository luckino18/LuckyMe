# LuckyMe Web App Handoff for Claude Fable 5

> Superseded design handoff. The current site adds minimum-ticket progress,
> automatic-refund states, `/how-to-play/`, and the Wallet Standard modal. The
> July 7 backend/active-round snapshot below is historical.

Date: 2026-07-07

## Goal

Turn the current LuckyMe mobile/Seeker experience into a browser web app for
`https://www.lucky-me.app` and `https://lucky-me.app`, so users without Seeker
can open the landing page, press Play, connect a Solana wallet, review a pool
entry transaction, and approve only in their wallet.

This handoff is for UI/UX rebuild work. Do not deploy Solana programs, fund
wallets, ask for seed phrases, or send mainnet transactions while doing UI work.

## Current Working Repo

Active repo:

`/Users/victor/Documents/Codex/2026-07-06/hai/work/LuckyMe-economic-upgrade-2026-07-06-235324`

Branch:

`economic-upgrade-premium-jackpot`

Do not modify the original GitHub 1:1 snapshot:

`/Users/victor/Documents/Codex/2026-07-05/refresh-and-audit-the-current-luckyme/work/LuckyMe-github-1to1`

## Web Files Added or Changed

- `site/lucky-me.app/index.html` - landing page with description and Play CTA.
- `site/lucky-me.app/play/index.html` - browser app shell.
- `site/lucky-me.app/app.js` - wallet/API/transaction review logic.
- `site/lucky-me.app/styles.css` - shared landing, legal, and app styling.
- `site/lucky-me.app/terms/index.html` - kept, nav now includes Play.
- `site/lucky-me.app/privacy/index.html` - kept, nav now includes Play.
- `site/lucky-me.app/support/index.html` - kept, nav now includes Play.
- `site/lucky-me.app/README.md` - deployment note.

Backend/doc support:

- `backend/src/server.mjs` - CORS now supports comma-separated HTTPS origins.
- `tests/backend-config.test.mjs` - test for `https://www.lucky-me.app` CORS.
- `backend/README.md`, `README.md`, `docs/deploy-checklist.md` - production
  CORS example updated.

## Claude Preview Applied

Victor provided a Claude-generated preview file:

`/Users/victor/Library/Application Support/Claude/local-agent-mode-sessions/037c3a23-a194-41e4-bc42-c70e92a4155f/9fdbad0c-d75c-40c6-9912-25c112520ef6/local_274b7ded-b4ad-4750-ac97-7e28fc6bca04/outputs/LUCKYME_WEB_PREVIEW.html`

That file is a large iframe/mock preview, not production app code. The useful
UI direction has been integrated into `site/lucky-me.app/styles.css`:

- Desktop `/play/` uses a fixed left sidebar and full-width content area.
- Mobile `/play/` keeps the bottom tab navigation.
- The static app still uses the real LuckyMe API, wallet detection, transaction
  review, and pending/on-chain unavailable states from `site/lucky-me.app/app.js`.

Do not replace `app.js` with the mock script from the Claude preview.

## Live URLs

- Landing: `https://lucky-me.app/` and `https://www.lucky-me.app/`
- Web app: `https://lucky-me.app/play/` and `https://www.lucky-me.app/play/`
- Terms: `https://lucky-me.app/terms/`
- Privacy: `https://lucky-me.app/privacy/`
- Support: `https://lucky-me.app/support/`
- API: `https://api.lucky-me.app`

The static site deployment target from existing repo docs is:

`/var/www/luckyme/public`

## Game / Program Data

Program ID:

`4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`

Cluster:

`mainnet-beta`

API host:

`https://api.lucky-me.app`

Pool model:

| Pool | Entry | Winners | Limit | Prize |
| --- | ---: | ---: | --- | --- |
| Mini | `0.005 SOL` | 1 | `1,000 tickets max` | `95% main prize` |
| Normal | `0.01 SOL` | 1 | `1,000 tickets max` | `95% main prize` |
| High | `0.05 SOL` | 1 | `1,000 tickets max` | `95% main prize` |
| Premium | `0.1 SOL` | 3 | `1 ticket per wallet` | `70 / 20 / 10 split` |

Economics:

- Main prize: `95%`
- Treasury / house: `2%`
- Jackpot reserve: `3%`
- Round duration: `1 hour`
- Randomness: `ORAO VRF`
- Jackpot odds remain internal and must not be displayed in UI.

Known PDAs from the latest wallet plan:

- Config PDA: `Cvx2ffKnwanpUZGsDBKyo2uwoo6gjucQmrRZpiYVyKh`
- Mini pool/vault/jackpot:
  `AgZCfxkrsUb5iYaR1DhANVdM133hBgGzB2TPZaExiGRv` /
  `CugjKD6CBkhFqScHwe2t4xyLQZwz1pz3v1AsVe5yWmjK` /
  `AoDXqydMdZdjD87Fw9g9ERSaMUHwFpgSXohWu2omfj6g`
- Normal pool/vault/jackpot:
  `14mtJnGcu3ASaM5ZvzsUcn2ZGjPR73tv5Fug9UWjSj9s` /
  `75zZjXYUpApEfq4yLvjR7paAg23PR4nYZffcmy6phGMH` /
  `GFj8kNYHWg6htTX5mwP1C7DgiRimnN1mSgU7AQQZiATG`
- High pool/vault/jackpot:
  `PL7Yn89kfs9FjVWcuHXcN6vcHkiN8wPABvE9L1bUH61` /
  `G5DdWyrfkCbguzHEtoVDJHmCnVRrbGaGQSccgF4UuhEA` /
  `7gYeodh72t3Jz36SD8Z9tQfJXuYvP4XL2ZA9y7fqyfrC`
- Premium pool/vault/jackpot:
  `9jBXss91gNEDLpjbRymWpn561GoDFdaxHd6iyXHKGTtp` /
  `4WHXvrUqr5d9DZzJ4Q4U8WVC3HZsWxBeZRWd85G3tgJT` /
  `BR7mE1Kd28A4zGMLJeo1gGkZ7rfDwsLZyogDbcHNpRs6`

## Wallet Integration State

Implemented in the static web shell:

- One visible `Connect wallet` control.
- The wallet menu opens only after the user clicks `Connect wallet`.
- The menu lists only Solana wallets already detected in that browser.
- `window.LUCKYME_WALLETCONNECT_PROJECT_ID` is set in `/config.js`, so the same
  menu also shows one neutral `Mobile wallet` WalletConnect/Reown fallback.
- The live Reown/WalletConnect Project ID was tested on 2026-07-07 and produced
  a valid `wc:` pairing URI. Keep the Reown allowlist on `https://lucky-me.app`
  and `https://www.lucky-me.app`.
- On mobile Chrome, where Solana wallet providers are not injected, the same
  wallet menu shows neutral app-browser actions: `Open in Phantom`,
  `Open in Solflare`, and `Open in Backpack`. These open LuckyMe inside the
  chosen wallet app browser and do not show install prompts or wallet marketing.
- No install links, no promoted wallet links, and no disabled wallet cards.
- Connect/disconnect flow.
- Pool review flow.
- Build and simulate unsigned transaction through
  `POST https://api.lucky-me.app/transactions/buy-tickets`.
- If simulation returns ok and the connected injected wallet supports it,
  `signAndSendTransaction` or `signTransaction` plus RPC submit is wired.

For a proper production React rebuild, prefer:

- `@solana/client` + `@solana/react-hooks` / Framework Kit.
- Wallet Standard discovery first.
- Keep the public wallet UX as one `Connect wallet` button plus a detected
  wallet chooser. Do not show install CTAs or disabled wallet providers.
- Keep WalletConnect/Reown behind the neutral `Mobile wallet` fallback, only
  after the user clicks `Connect wallet`.
- Keep mobile browser deep links as a fallback for phone browsers that cannot
  expose Solana providers directly; they must be inside the same wallet menu and
  must not read as install or promotion CTAs.
- Keep `@solana/web3.js` only at the legacy transaction boundary if the
  backend continues returning legacy base64 transactions.

## API Contract Used by Web

Read:

- `GET /config`
- `GET /pools?player=<wallet>`

Transaction build:

- `POST /transactions/buy-tickets`

Request body:

```json
{
  "pool": "mini|normal|high|premium",
  "ticketCount": 1,
  "player": "<connected-wallet-public-key>"
}
```

Expected response includes:

- `transactionBase64`
- `summary`
- `simulation`
- `clusterUrl`
- `programId`
- `blockhash`
- `lastValidBlockHeight`

Production relay:

- `POST /transactions/submit` is intentionally disabled by default. The web
  shell submits through the connected browser wallet/RPC path when available.

## Current Live Backend Status

As of 2026-07-07, live API checks showed:

- `GET https://api.lucky-me.app/health` is live.
- `GET https://api.lucky-me.app/config` reports `onchainAvailable=false` and
  `reason=program_not_deployed`, with current economics `95/2/3`.
- `GET https://api.lucky-me.app/pools` returns `503 onchain_state_unavailable`.

Because of this, the web app must show Pending/Syncing and must not show fake
live pool balances or fake live rounds.

## Required CORS

To support both apex and `www`, backend env should be:

```bash
export CORS_ORIGIN=https://lucky-me.app,https://www.lucky-me.app
```

The backend now reflects only an allowed request origin. Do not use wildcard
CORS for production.

## UI Direction for Claude

Use the current static `/play/` as the functional map, not as final visual
quality. Redesign freely, but preserve these product constraints:

- First page is landing, with Play as the primary CTA.
- Play opens the dapp experience immediately; do not build a marketing-only
  site.
- Keep screens: Home, Pools, Activity, Wallet, Links, Review.
- Wallet controls must be obvious and compact.
- Wallet UI must be a single `Connect wallet` action. After click, show only
  wallets detected in the user's browser, a neutral WalletConnect/Reown
  fallback when configured, and neutral mobile wallet-app browser open actions
  on phone browsers. Do not show install links, external wallet marketing,
  MetaMask/WalletConnect placeholders, or disabled providers.
- Show Pending/Syncing when chain/backend state is not verified.
- Do not show jackpot odds.
- Do not show fake balances, fake winners, fake live pool totals, or fake
  transaction signatures.
- Every transaction path must show summary and simulation result before wallet
  approval.
- Wallet copy must say self-custody and no seed phrase/private key.
- Terms, Privacy, Support must remain linked from both landing and app.
- Hover states should follow the Slimecoin-style interaction Victor requested:
  buttons, cards, rows, chips, nav items, and app panels should lift slightly,
  brighten their border, and show a subtle Solana purple/cyan/green glow on
  desktop mouse hover. Keep this disabled as motion on reduced-motion users.

Suggested UI rebuild:

1. Create a Vite or Next.js React app under `site/lucky-me.app` or a new
   `web/` directory, depending on deployment preference.
2. Preserve static export compatibility for `/var/www/luckyme/public`.
3. Build wallet provider layer:
   - Wallet Standard discovery.
   - Detected injected wallet support only in the visible chooser.
   - One public `Connect wallet` entry point.
   - WalletConnect/Reown only as a neutral `Mobile wallet` fallback, configured
     through `/config.js`.
4. Build API client module:
   - `getConfig()`
   - `getPools(player?)`
   - `buildBuyTicketsTransaction(pool, player, ticketCount)`
5. Build transaction flow:
   - Select pool.
   - Require wallet.
   - Build transaction.
   - Display summary and simulation.
   - Ask wallet to sign/send only after explicit user click.
   - Display signature or wallet rejection error.
6. Add browser tests for:
   - Landing loads.
   - Play route loads.
   - Wallet missing state.
   - API unavailable state.
   - Pool cards render Mini/Normal/High/Premium.
   - Premium shows `0.1 SOL`, `3 winners`, `1 ticket per wallet`,
     `70 / 20 / 10 split`.

## Verification Commands

From repo root:

```bash
node --check site/lucky-me.app/app.js
node --test tests/backend-config.test.mjs
npm test
```

Static preview:

```bash
cd site/lucky-me.app
python3 -m http.server 8787
```

Open:

`http://127.0.0.1:8787/`

`http://127.0.0.1:8787/play/`

Local preview may show API unavailable because production CORS only allows the
production origins. That is expected.

Browser verification completed on 2026-07-07:

- Desktop `1280x720`: sidebar is fixed at `250px`, app content starts after the
  sidebar, `8` rendered pool cards exist on Home, and no horizontal overflow.
- Mobile `390x844`: bottom navigation has `5` tabs, no horizontal overflow.
- Navigation: Pools shows `4` pool cards; Wallet shows one `Connect wallet`
- Wide `2048x860`: Pools shows `4` pool cards in one row with aligned
  `Review setup` button bottoms.
- Mobile `390x844` with wallet menu open: Wallet shows `Open in Phantom`,
  `Open in Solflare`, and `Open in Backpack`, and no `install` text.
- Navigation: Wallet shows one `Connect wallet` action before the chooser.
- Browser console: no JavaScript errors during the checked flows.

## Safety Rules

- Do not read or expose `MASTER-SECRETS.txt`.
- Do not request or store seed phrases, private keys, or keypair JSON.
- Do not sign or send transactions during UI work.
- Do not fund wallets.
- Do not deploy the mainnet program without Victor explicitly confirming a
  transaction summary and simulation.
- Do not replace Pending states with demo numbers in production.
