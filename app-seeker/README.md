# LuckyMe Seeker App

Mobile-first Android client for Solana Seeker and Solana dApp Store review.

The current app target is `DEVNET_STORE_DEMO`: devnet only, no real SOL, no real
prizes, and visible safety/transparency copy.

## API Configuration

Set `EXPO_PUBLIC_LUCKYME_API_URL` before running the app:

- desktop preview: `http://localhost:8788`
- Android emulator: `http://10.0.2.2:8788`
- physical Seeker device: `http://<mac-lan-ip>:8788`

For store/demo builds, `EXPO_PUBLIC_LUCKYME_API_URL` is required. The app shows a
blocking configuration error instead of silently falling back to localhost.

Optional public env vars:

```text
EXPO_PUBLIC_LUCKYME_RELEASE_MODE=DEVNET_STORE_DEMO
EXPO_PUBLIC_LUCKYME_STORE_BUILD=true
EXPO_PUBLIC_LUCKYME_TERMS_URL=https://example.com/terms
EXPO_PUBLIC_LUCKYME_PRIVACY_URL=https://example.com/privacy
EXPO_PUBLIC_LUCKYME_SUPPORT_URL=https://example.com/support
```

## Local Android Flow

The backend binds to `127.0.0.1` by default. For a trusted LAN dev session:

```bash
HOST=0.0.0.0 ENABLE_TRANSACTION_SUBMIT=true npm run backend:start
```

Run the app:

```bash
npm ci
EXPO_PUBLIC_LUCKYME_API_URL=http://<mac-lan-ip>:8788 npm run android
EXPO_PUBLIC_LUCKYME_API_URL=http://<mac-lan-ip>:8788 npm run start -- --host lan
```

Mobile Wallet Adapter support requires a custom Expo development build. Expo Go
is not enough because wallet adapter and crypto polyfills use native modules.

## Store-Visible Safety

The screen displays:

- `DEVNET MODE - no real funds` banner
- current release mode, cluster, and randomness mode
- ticket price, total pool, countdown, user tickets, and user chance
- 98% main prize, 1% house fee, 1% jackpot contribution
- treasury address, vault addresses, and program id
- round history, winner, refund state, and randomness proof status
- transaction review before wallet signing
- safety, how-it-works, terms, privacy, and support placeholders

The wallet authorization chain defaults to `solana:devnet`. The backend submit
relay is disabled by default; local mobile tests that rely on the relay must
start the backend with `ENABLE_TRANSACTION_SUBMIT=true`.

The app should sign only user-approved transactions. Winner selection and
payouts must be verified by the Solana program.
