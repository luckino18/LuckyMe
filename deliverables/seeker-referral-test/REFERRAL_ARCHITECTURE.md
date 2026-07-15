# Arhitectura Seeker Referral Test
## Integrare în aplicație

Buildul separat pornește `LuckyMeReferralTestApp` și păstrează aplicația LuckyMe completă. Referral-ul este un card integrat în tabul `Wallet`; nu există banner sau bară referral pe Home. Butonul `Open` și deep link-ul deschid `SeekerReferralScreen`.

Cumpărările sunt dezactivate numai în wrapper-ul APK-ului referral. Buildul oficial păstrează comportamentul normal. Pluginul `expo-notifications` și `POST_NOTIFICATIONS` sunt incluse în code3.

## Flux referral

1. APK-ul cere backend-ului un nonce SIWS.
2. Mobile Wallet Adapter cere wallet-ului o semnătură off-chain.
3. Backend-ul verifică payload-ul, wallet-ul și semnătura înainte să consume nonce-ul.
4. Backend-ul interoghează read-only mainnet Token-2022 și validează SGT-ul oficial.
5. Mint-ul SGT devine cheia unică, iar wallet-ul rămâne adresa curentă verificată.
6. Backend-ul creează sau reutilizează profilul și returnează o sesiune scurtă.
7. Binding-ul unui referral are loc numai după verificarea ambelor SGT-uri și confirmarea explicită.
8. Qualification de test acordă maximum un punct per referred SGT.

## Serviciu live izolat

- `luckyme-seeker-referral-test.service` ascultă doar local pe portul 8790.
- Nginx trimite numai rutele referral către serviciul separat.
- Restul API-ului continuă către serviciul principal LuckyMe.

## Componente

- `LuckyMeReferralTestApp.tsx`: wrapper, navigare și deep links.
- `LuckyMeScreen.tsx`: aplicația normală, cardul Wallet și poarta `disablePayments`.
- `SeekerReferralScreen.tsx`: SIWS/SGT, profil, referral, share și leaderboard.
- `secureWalletCache.ts`: cache MWA în SecureStore Android.
- `seeker-referral-server.mjs`: API HTTP izolat, validare și rate limiting.
- `seeker-referral-service.mjs`: SIWS, sesiuni, SGT, binding și qualification.

## Limită de încredere

Telefonul nu decide eligibilitatea. Modelul dispozitivului, un flag local sau un domeniu `.skr` nu acordă acces. Verificarea este server-side, iar mainnet este folosit numai pentru citire.
