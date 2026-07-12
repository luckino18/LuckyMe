# LuckyMe — status și pașii reali rămași

Data verificării: **12 iulie 2026**

Rețea: **Solana mainnet-beta**

## Rezumat executiv

LuckyMe este construit și instalat în producție: programul Solana, API-ul,
site-ul, integrarea WalletConnect/Reown și APK-ul Seeker `1.1.0` sunt gata.
Upgrade-ul cu praguri minime și refund automat este deja pe mainnet.

Jocul nu acceptă momentan intrări deoarece toate cele patru pool-uri sunt fără
rundă activă, iar keeperul este oprit intenționat. Publicarea în Solana dApp
Store și pornirea rundelor sunt două operațiuni separate.

## Ce avem acum

| Componentă | Stare reală |
| --- | --- |
| Program Solana | Deployat pe mainnet: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3` |
| Reguli joc | Mini 25, Normal 13, High 3, Premium 3 bilete minime; Premium cere 3 walleturi distincte |
| Refund | Automat pentru rundele expirate sub prag; fără extragere ORAO și fără câștigător |
| API | Live la `https://api.lucky-me.app` |
| Site | Live; WalletConnect funcțional prin proiectul Reown controlat de proprietar |
| APK Seeker | `1.1.0`, code 3, semnat EAS și verificat; SHA-256 `b0da48983e84fd361fe27e06a6ac3d5193b7fb9d0f04621ca963dbc6321af42d` |
| Pool-uri | Mini 5, Normal 6, High 6 și Premium 6 sunt deschise și așteaptă primul bilet |
| Keeper | Serviciul este oprit intenționat; nu există permisiune de scriere activă |
| dApp Store | Contul și trimiterea din Publisher Portal nu sunt încă finalizate |

## Cele două walleturi Ledger

### 1. Walletul numit `keeper`

Adresă: `8TN3gVGp86EUnmpa3ncMpPHoWDAV7t997RuXaLesRWqV`

Sold verificat: **0.72827356 SOL**

Acesta a fost walletul operator prevăzut în planul inițial. On-chain se vede o
singură operațiune LuckyMe în care a plătit și a semnat deschiderea rundelor
pentru cele patru pool-uri. Configurația finală a fost însă schimbată: acest
wallet **nu este keeperul actual al serverului**.

Keeperul real de producție este:
`6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.

Rolul keeperului real este să execute automat operațiunile de ciclul vieții:
deschiderea rundelor următoare, cererea și decontarea randomizării ORAO și
refundurile automate. Soldul său actual este numai **0.001437625 SOL**, sub
rezerva de siguranță configurată de **0.05 SOL**, deci nu trebuie pornit încă.

Concluzie: cei aproximativ 0.728 SOL din `8TN3...` nu sunt necesari în walletul
vechi pentru funcționarea configurației actuale. Îi lăsăm nemișcați până la o
decizie explicită: păstrare ca rezervă sau transfer controlat către keeperul
real și/sau către un wallet ales de proprietar.

### 2. Walletul numit `publisher`

Adresă: `6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H`

Sold verificat: **0.74 SOL**

Acesta este walletul pentru publicarea aplicației în Solana dApp Store. Nu
rulează jocul și nu este keeper. El identifică publisherul în Publisher Portal
și semnează mesajele/tranzacțiile necesare pentru încărcarea activelor și APK-ului
în storage, respectiv pentru NFT-urile de App/Release.

Walletul are doar tranzacția inițială de alimentare și nu a fost folosit după
aceea. Documentația oficială estimează aproximativ **0.2 SOL** pentru taxele de
tranzacție și costurile ArDrive, deci 0.74 SOL este suficient pentru început.
Trebuie păstrat accesul la el și pentru actualizările viitoare ale aplicației.

Pentru fluxul normal folosim Publisher Portal cu un wallet din extensia de
browser, conectat la Ledger. API key și keypair local sunt necesare numai dacă
alegem ulterior fluxul opțional prin CLI.

## Ce a mai rămas real de făcut

### A. Pentru a porni jocul live

1. Se aprobă explicit alimentarea keeperului real `6BUw...` peste rezerva de
   `0.05 SOL`. Suma și walletul sursă se confirmă înainte de orice tranzacție.
2. Se activează permisiunea de scriere și timerul keeperului pe VPS.
3. Rundele sunt deja deschise. Se păstrează timerul oprit până la aprobarea
   separată a automatizării complete.
4. Se verifică API-ul, site-ul și o intrare reală controlată de pe Seeker.

Fără pașii 1–3 aplicația poate fi publicată și deschisă, dar utilizatorii nu pot
cumpăra bilete deoarece nu există runde active.

### B. Pentru publicarea în Solana dApp Store / Seeker

1. Se finalizează Publisher Account și KYC/KYB în Publisher Portal.
2. Se conectează walletul publisher `6p8d...` prin extensia de browser/Ledger.
3. Se face smoke test fizic pe Seeker pentru APK-ul `1.1.0`: instalare,
   lansare, navigare și conectare wallet. Testul de review/cumpărare se face
   după ce există o rundă activă.
4. Se confirmă materialele finale: nume, descriere, icon și screenshots.
5. Se alege storage-ul, de preferat ArDrive, se încarcă APK-ul semnat și se
   semnează tranzacțiile cerute de portal.
6. Se apasă Submit și se așteaptă review-ul, indicat oficial ca aproximativ
   3–5 zile lucrătoare.

## Ce NU mai este un blocaj real

- Reown/WalletConnect este configurat și funcțional pe ambele domenii.
- Nu este necesar un alt keeper Ledger; configurația finală folosește `6BUw...`.
- Nu este obligatoriu fluxul Publisher CLI sau un API key dacă publicăm direct
  din Publisher Portal.
- Pagini publice separate de Terms, Privacy și Support **nu sunt enumerate ca
  cerințe de trimitere** în ghidul oficial curent „Submit a New App”. Portalul
  cere acceptarea politicii publisherului și a acordului dezvoltatorului, dar
  asta nu înseamnă că trebuie să construim alte pagini juridice. Paginile deja
  existente pot rămâne, însă nu le tratăm ca taskuri sau blocaje de lansare.

## Ordinea recomandată

1. Smoke test de bază pentru APK-ul `1.1.0` pe Seeker.
2. Publisher Portal + KYC/KYB + conectarea walletului `6p8d...`.
3. Aprobarea finanțării și pornirii keeperului real, apoi deschiderea celor
   patru runde.
4. Test controlat pe Seeker cu o rundă activă.
5. Încărcarea și trimiterea APK-ului la review.

Pornirea jocului și publicarea sunt separate tehnic, dar este recomandat ca
rundele să fie active când aplicația este trimisă la review, astfel încât
funcționalitatea principală să poată fi verificată.

## Surse oficiale

- [Submit a New App](https://docs.solanamobile.com/dapp-store/submit-new-app)
- [Build and Sign an APK](https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk)
- [Publishing CLI — flux opțional](https://docs.solanamobile.com/dapp-store/publishing-cli)
- [Submit an Update](https://docs.solanamobile.com/dapp-store/submit-an-update)

Nicio tranzacție, mutare de SOL sau activare de keeper nu a fost efectuată la
realizarea acestui document.
