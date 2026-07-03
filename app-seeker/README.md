# LuckyMe Seeker App

Mobile-first Android client for Solana Seeker.

The current screen reads pool state from the backend `GET /pools` endpoint and
falls back to local static values when the backend or RPC is unavailable.

Set `EXPO_PUBLIC_LUCKYME_API_URL` before running the app:

- iOS simulator / desktop preview: `http://localhost:8788`
- Android emulator: `http://10.0.2.2:8788`
- physical Seeker device: `http://<mac-lan-ip>:8788`

The backend binds to `0.0.0.0`, so a physical device can reach it on the Mac LAN
IP when both devices are on the same network.

The join button is intentionally disabled until the Mobile Wallet Adapter
transaction builder is implemented.

MVP screens:

- pool list: Mini, Normal, High
- active round: countdown, total tickets, jackpot, user tickets, user chance
- join flow through Solana Mobile Wallet Adapter
- round result and recent history
- treasury/fee transparency screen

The APK should sign only user-approved transactions. Winner selection and payouts must be verified by the Solana program.
