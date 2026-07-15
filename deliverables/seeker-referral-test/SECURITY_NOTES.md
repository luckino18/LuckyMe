# Note de securitate

## SIWS și sesiuni

- Nonce criptografic, stocat doar ca SHA-256, expirare la 5 minute și consum one-time.
- Mesajul SIWS include domain, URI, version, mainnet chain ID, nonce, issued-at, expiration și request ID.
- Backend-ul compară payload-ul cu nonce-ul emis și verifică semnătura prin `@solana/wallet-standard-util` înainte să consume nonce-ul.
- Sesiunile backend sunt aleatorii, stocate numai ca hash, expiră la 15 minute și sunt revocate la logout.
- Dacă același SGT este mutat pe alt wallet, sesiunile wallet-ului vechi sunt revocate.
- Auth token-ul MWA, sesiunea și referral-ul temporar sunt păstrate în Android SecureStore, nu în plaintext AsyncStorage.

## SGT și anti-Sybil

- Verificarea este exclusiv server-side și read-only pe Solana mainnet.
- Sunt acceptate numai conturi Token-2022 cu amount 1, decimals 0, supply 1 și câmpurile oficiale de mint authority, metadata pointer și Token Group Member.
- Mint-ul SGT este identificatorul unic. Wallet-ul se poate actualiza, dar același mint nu poate crea alt profil sau alt punct.
- Constrângerile SQLite `UNIQUE`, `CHECK`, foreign keys și tranzacțiile `BEGIN IMMEDIATE` protejează binding-ul și qualification de duplicate.
- SGT dovedește eligibilitatea Seeker, nu identitatea civilă/KYC.

## API și Android

- Validare strictă JSON, corp maxim 64 KiB, timeout, răspunsuri fără stack traces și `Cache-Control: no-store`.
- Rate limiting global per IP și suplimentar per wallet/SGT. `X-Forwarded-For` este acceptat numai cu `REFERRAL_TRUST_PROXY=true`.
- HTTPS este obligatoriu în production; APK-ul are `usesCleartextTraffic=false`.
- Release manifest: `allowBackup=false`, `fullBackupContent=false`; atributul `debuggable` lipsește, deci release-ul nu este debug.
- `POST_NOTIFICATIONS` și pluginul nativ `expo-notifications` sunt păstrate în code3. Overlay și permisiunile de storage extern sunt absente.
- Nu există trust-all TLS, seed phrase, private key, RPC key sau parolă hardcodată.
- APK-ul de test are certificat separat; certificatul dApp Store nu a fost folosit.

## Simulare și plăți

- APK-ul păstrează aplicația LuckyMe completă vizibilă, dar `LuckyMeScreen` primește un blocaj explicit al cumpărărilor în buildul referral test.
- Încercarea de cumpărare nu conectează wallet-ul și nu construiește sau trimite o tranzacție.
- Endpoint-ul `simulate-qualification` răspunde 404 dacă `REFERRAL_TEST_MODE` nu este exact `true`.
- Simularea scrie doar evenimentul SQLite de test. Nu cheltuie SOL și nu distribuie SKR.

## Izolare live

- Serviciul referral rulează separat pe `127.0.0.1:8790` ca `luckyme-seeker-referral-test.service`.
- Numai rutele referral sunt trimise către el; serviciul principal LuckyMe rămâne separat.
- Datele referral au director propriu cu permisiuni restrictive.
- Programul Solana on-chain nu a fost modificat și nu a fost construită sau trimisă nicio tranzacție.

## Notificări

Permisiunea Android a fost restaurată și promptul de sistem poate fi cerut. Configurația locală nu conține `google-services.json`; de aceea livrarea push prin FCM/Expo nu este declarată verificată până când configurația FCM a aplicației este furnizată și testată pe telefon.

## Secrete locale

Keystore-ul și fișierul de credentials sunt în director local cu permisiuni restrictive, în afara Git. Livrabilele nu conțin keystore, parole sau fișier `.env`.
