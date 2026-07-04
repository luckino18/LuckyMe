# LuckyMe Seeker App

Mobile-first Android client for Solana Seeker.

The current screen reads pool state, recent rounds, vault addresses, and
treasury metadata from the backend `GET /pools` endpoint. It falls back to local
static pool values when the backend or RPC is unavailable.

Set `EXPO_PUBLIC_LUCKYME_API_URL` before running the app:

- iOS simulator / desktop preview: `http://localhost:8788`
- Android emulator: `http://10.0.2.2:8788`
- physical Seeker device: `http://<mac-lan-ip>:8788`

The backend binds to `0.0.0.0`, so a physical device can reach it on the Mac LAN
IP when both devices are on the same network.

Mobile Wallet Adapter support requires a custom Expo development build. Expo Go
is not enough because the wallet adapter and crypto polyfills use native modules.

Local Android flow:

```bash
npm ci
EXPO_PUBLIC_LUCKYME_API_URL=http://<mac-lan-ip>:8788 npm run android
EXPO_PUBLIC_LUCKYME_API_URL=http://<mac-lan-ip>:8788 npm run start -- --host lan
```

The wallet authorization chain defaults to `solana:devnet` for mobile wallet
compatibility. For localnet testing, the app asks the wallet only to sign the
transaction; the backend submits the signed transaction to the configured local
RPC.

The join flow asks the backend to build and simulate an unsigned transaction,
then shows an in-app review with amount, cluster, program, wallet, and
simulation status before asking the wallet to sign it. The backend never signs
player transactions.

MVP screens:

- pool list: Mini, Normal, High
- active round: countdown, total tickets, jackpot, user tickets, user chance
- join flow through Solana Mobile Wallet Adapter
- round result and recent history
- treasury/fee transparency screen

The APK should sign only user-approved transactions. Winner selection and payouts must be verified by the Solana program.
