# Fișiere modificate

## Aplicație Android

- `app-seeker/App.tsx` — selectează wrapper-ul referral numai pentru buildul separat.
- `app-seeker/app.config.js` — code4, package ID separat, deep link și permisiuni.
- `app-seeker/src/LuckyMeReferralTestApp.tsx` — elimină bara referral și păstrează navigarea/deep link-ul.
- `app-seeker/src/LuckyMeScreen.tsx` — integrează cardul referral în `Wallet` și păstrează blocarea plăților.
- `app-seeker/src/SeekerReferralScreen.tsx` — afișează walletul verificat integral la `NO_SGT` și permite resetarea selecției MWA pentru alegerea walletului Seed Vault primar.
- `app-seeker/src/secureWalletCache.ts` — SecureStore pentru autorizarea MWA.
- pluginurile și scripturile din `app-seeker/` — manifest hardened, signing local și build reproducibil.

## Backend, deploy și teste

- `backend/src/seeker-referral-service.mjs` — verifică SIWS înainte de consumarea nonce-ului și adaugă diagnostic sigur.
- `backend/src/seeker-referral-server.mjs` — health referral și rutele API.
- `deploy/systemd/luckyme-seeker-referral-test.service` — serviciul live izolat.
- `deploy/nginx/luckyme-seeker-referral-locations.conf` — rutele referral izolate.
- `deploy/referral-test-package.json` — pachetul minim de runtime.
- `scripts/seeker-referral-siws-smoke.mjs` — smoke SIWS live fără tranzacție.
- `tests/seeker-referral.test.mjs` — regresii SIWS, UI Wallet, diagnostic SGT și code4 ARM64.

## Nemodificate intenționat

- APK-ul oficial `/Users/victor/Desktop/LuckyMe-Seeker-1.1.7-code10.apk`.
- Configurația normală `com.luckyme.seeker`, versionCode 10.
- Programul Solana on-chain și IDL-ul.
- Codul și procesul serviciului principal `luckyme-api.service`.
- Orice repository sau release GitHub.

APK-ul code4 este livrat pe Desktop împreună cu checksum-ul; versiunile anterioare rămân doar istoric.
