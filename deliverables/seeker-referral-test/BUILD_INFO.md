# Build info

## APK referral test code4

- Nume vizibil: `LuckyMe Seeker Referral Test`
- Package ID: `app.luckyme.seekerreferraltest`
- Version name: `1.1.7-referral-test.4`
- Version code: `4`
- Min SDK: `24`
- Target SDK: `36`
- Arhitectură: `arm64-v8a` (Seeker)
- Tip: Android release, semnat local cu o identitate de test separată
- Mărime: `46009202` bytes (aproximativ 44 MiB)
- SHA-256 APK: `bec0851f80af885631f61370ba5d14a3a5de4e8129d148331534a37d0ed59184`
- Certificat SHA-256: `fe4e008aefc055db80aba9ec1694163819c0fecf26754471396b6e605dd8f7b7`
- Build nativ release final: `BUILD SUCCESSFUL in 4m 51s`

Comanda de build:

```text
npm --prefix app-seeker run build:seeker-referral-test
```

Buildul setează `NODE_ENV=production`, generează proiectul Android izolat, cere variabilele locale de signing și rulează `app:assembleRelease` ARM64 cu lint-ul release activ. Code4 afișează walletul verificat integral și permite golirea selecției MWA înainte de alegerea walletului Seed Vault primar care deține SGT-ul.

## Reperul oficial păstrat

- Fișier primit: `/Users/victor/Desktop/LuckyMe-Seeker-1.1.7-code10.apk`
- Package ID: `com.luckyme.seeker`
- Version name/code: `1.1.7` / `10`
- SHA-256: `5b41ced1dafe384eff1d7df790c1836b61efc9c6656a4ee05974e6b711028e54`
- Certificat SHA-256: `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`

APK-ul oficial nu a fost modificat sau înlocuit. Configurația normală a proiectului a fost reverificată ca `com.luckyme.seeker`, 1.1.7/code10.

## Stare locală

- Commit sursă de plecare: `5da583e51f22b2942ce09b76ab03b436999c2cde`
- Branch local: `feature/seeker-referral-test`
- Nu s-a făcut commit, push, release sau modificare pe GitHub.
- Keystore-ul de test este în afara repository-ului și nu este copiat în livrabile.
- APK-urile code1-code3 sunt istorice; pentru testul SGT se folosește numai code4 de pe Desktop.
- Serviciul referral este publicat separat de serviciul principal LuckyMe.
