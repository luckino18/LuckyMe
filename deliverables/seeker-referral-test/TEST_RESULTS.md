# Rezultate teste

## Rezumat

- Suită completă proiect: `138/138` teste trecute, 0 eșecuri.
- Suită referral: `24/24` teste trecute, 0 eșecuri.
- TypeScript: `tsc --noEmit` trecut.
- Expo Doctor: `20/20` verificări trecute.
- Android release lint: `lintVitalRelease` trecut.
- Android release build: trecut.
- Integritate ZIP/APK: trecută, 1256 fișiere, fără erori de compresie.
- Verificare `apksigner`: trecută; v2 și v3 validate.
- Manifest verificat: package/version corecte, `POST_NOTIFICATIONS` prezentă, `allowBackup=false`, `usesCleartextTraffic=false`, fără `debuggable` și fără overlay.
- Bundle verificat: conține cardul `SEEKER EXCLUSIVE` / `Seeker Referral` și blocarea cumpărărilor. Nu conține vechea bară `SEPARATE LOCAL TEST APK`.

Output-ul complet al suitei este în `FULL_TEST_OUTPUT.txt`, iar output-ul complet al semnăturii în `APK_VERIFICATION.txt`.

## Scenarii referral executate

Au fost executate explicit scenariile cerute: SIWS valid și invalid, nonce expirat și reutilizat, domain greșit, wallet fără SGT, token fals, câmpuri SGT autentice, mutarea aceluiași SGT pe alt wallet, unicitatea profilului, self-referral, circular referral, două coduri, concurență, retry idempotent, simulare oprită în afara test mode, leaderboard fără duplicate, logout, deep link valid și invalid.

Testul de integrare verifică separat că buildul code3 selectează UI-ul standalone, păstrează pluginul de notificări și permisiunea Android, integrează referral-ul în tabul `Wallet` fără bara de sus și blochează cumpărările reale. Un test explicit dovedește că semnătura invalidă nu consumă nonce-ul și că retry-ul corect pe același nonce reușește.

## Verificare live

- Health referral public: serviciul separat răspunde `ok`, cu test mode activ.
- Health-ul serviciului principal răspunde în continuare `MAINNET_RELEASE` / `mainnet-beta`.
- Smoke test public cu wallet efemer fără SGT: nonce `200`, SIWS valid acceptat, apoi `403 no_sgt` după verificarea read-only pe mainnet.
- Serviciul principal, serviciul referral și nginx sunt active; jurnalul recent referral nu conține warnings.

## Limită de test fizic

În această sesiune nu a existat niciun telefon sau emulator conectat prin ADB. APK-ul și backend-ul au fost verificate independent, dar SGT-ul real și promptul Android trebuie confirmate pe Seeker.
