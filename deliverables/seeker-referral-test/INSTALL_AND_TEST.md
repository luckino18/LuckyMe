# Instalare și testare pe Seeker

## 1. Folosește numai code4

```text
LuckyMe-Seeker-Referral-Test-1.1.7-referral-test.4-arm64.apk
```

SHA-256 corect:

```text
bec0851f80af885631f61370ba5d14a3a5de4e8129d148331534a37d0ed59184
```

Nu instala APK-urile din `superseded/`.

## 2. Instalează sau actualizează

```text
adb devices -l
adb install -r LuckyMe-Seeker-Referral-Test-1.1.7-referral-test.4-arm64.apk
adb shell monkey -p app.luckyme.seekerreferraltest -c android.intent.category.LAUNCHER 1
```

`versionCode 4` actualizează direct code3. Aplicația oficială `com.luckyme.seeker` rămâne instalată în paralel.

## 3. Verifică referral-ul

1. Deschide tabul `Wallet`.
2. În cardul `SEEKER EXCLUSIVE — Seeker Referral`, apasă `Open`.
3. Apasă `Verify my Seeker` și aprobă SIWS în wallet. Nu trebuie să apară nicio tranzacție sau taxă SOL.
4. Wallet-ul Seed Vault cu SGT trebuie să ajungă la `Verified Seeker Owner` și să primească profilul/codul referral.
5. Un wallet fără SGT trebuie să primească `NO_SGT`, nu `INVALID_SIWS`.
6. La `NO_SGT`, compară adresa completă din `WALLET CHECKED ON MAINNET` cu walletul primar din Seed Vault. Dacă diferă, apasă `Clear and choose another wallet`, apoi repetă verificarea și alege walletul primar.

Referral-ul nu mai apare într-o bară în partea de sus a aplicației.

## 4. Verifică notificările

La dialogul `Round notifications`, apasă `Enable alerts`. Code4 declară permisiunea Android și poate lansa promptul de sistem.

Dacă Android a păstrat refuzul dintr-o instalare anterioară, update-ul nu resetează alegerea. Activează `App info → Notifications → Allow notifications` sau dezinstalează numai aplicația de test `LuckyMe Seeker Referral Test` și reinstalează code4.

Diagnostic opțional:

```text
adb shell pm grant app.luckyme.seekerreferraltest android.permission.POST_NOTIFICATIONS
```

## 5. Backend

Backend-ul referral este activ la `https://api.lucky-me.app`, separat de serviciul principal. Nonce, SIWS și verificarea SGT mainnet au fost testate live.

## 6. Limită de verificare

Nu a existat dispozitiv ADB conectat în sesiunea de build. Confirmarea finală a SGT-ului real și a promptului vizual Android trebuie făcută pe telefon.
