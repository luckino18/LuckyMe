# Sarcina Codex: praguri, refund, site, APK semnat si GitHub complet

Lucreaza in acest repository peste modificarile locale existente. Nu sterge,
nu reseta si nu suprascrie fisierele necomise. Citeste integral mai intai:

- `CODEX-IMPLEMENTARE-KEEPER-SI-RECUPERARE-RENT.md`;
- `docs/handoff.md`;
- `docs/incident-2026-07-11-idle-pools-rent-wallet.md`;
- `docs/mainnet-stage1-execution-2026-07-11.md`;
- `docs/mainnet-stage2-rent-recovery-execution-2026-07-11.md`;
- `docs/production-keeper.md`.

Aceasta sarcina autorizeaza autonom, fara confirmari intermediare:

- implementarea completa locala;
- testele, build-ul programului si preview-ul site-ului;
- actualizarea completa a site-ului si a aplicatiei Seeker in surse;
- generarea unui APK Android complet semnat pentru test;
- copierea APK-ului final verificat pe Desktop;
- actualizarea documentatiei si a handoff-ului;
- commit si push normal pe repository-ul GitHub configurat al proiectului.

Continua pana cand toate aceste rezultate sunt terminate, chiar daca utilizatorul
nu este prezent. Nu opri pentru intrebari cosmetice sau alegeri minore; foloseste
designul LuckyMe existent si cea mai sigura presupunere compatibila. Repara
erorile de build/test, reincearca operatiile tranzitorii si lasa un raport final
complet.

Aceasta sarcina nu autorizeaza transfer SOL, semnare Ledger, upgrade mainnet,
deploy live al backendului/site-ului, deschiderea rundelor sau pornirea
keeperului. Pregateste aceste operatii si simularile, dar opreste-te inaintea lor.
Sursa GitHub si APK-ul de test pot fi mai noi decat programul mainnet; marcheaza
clar aceasta stare in documentatie si in raport.

## Mod autonom fara interventia utilizatorului

- Nu cere aprobari pentru editari locale, instalarea dependentelor proiectului,
  teste, build-uri, EAS build, download APK, verificari, commit sau push GitHub.
- Nu astepta utilizatorul pentru preview; verifica singur desktop si mobile.
- Nu folosi `git reset --hard`, force-push, rescriere de istoric sau stergerea
  modificarilor existente.
- Daca un serviciu extern cere autentificare/2FA expirata si nu exista o sesiune
  deja valida, continua toate celelalte etape, pastreaza artifactele si raporteaza
  exact acel unic blocaj la final.
- Nu genera o noua identitate de signing Android daca EAS credentials existente
  sunt disponibile. Continuitatea certificatului APK este obligatorie.
- Nu include niciodata in GitHub keystore, parole, tokenuri, `.env`, chei Solana,
  seed phrases, API keys, credentiale Expo/EAS sau fisiere temporare sensibile.

## Decizia economica aprobata

Pragul se refera la numarul total de bilete vandute intr-o runda, nu la numarul
de walleturi distincte:

| Pool | Bilete minime pentru o tragere valida | Walleturi distincte minime |
|---|---:|---:|
| Mini | 25 | 1 |
| Normal | 13 | 1 |
| High | 3 | 1 |
| Premium | 3 | 3 |

Un singur wallet poate cumpara toate cele 25 de bilete Mini sau toate cele 13
Normal, in limitele deja existente ale poolului. Nu afisa si nu sugera ca sunt
necesari 25 de jucatori pentru Mini. Premium pastreaza regula existenta de un
bilet per wallet si trei castigatori/walleturi distincte.

Nu modifica preturile, durata de o ora, procentele 95% / 2% / 3%, jackpotul,
numarul castigatorilor sau limitele de bilete per wallet.

## Regula completa a rundei

1. O runda noua asteapta primul bilet cu `start_ts = 0` si `end_ts = 0`.
2. Primul bilet confirmat porneste atomic timerul de o ora.
3. Jucatorii pot cumpara bilete pana la `end_ts`, conform limitelor poolului.
4. Daca la expirare `total_tickets >= minimum_tickets`, keeperul cere ORAO o
   singura data si runda urmeaza settlementul normal.
5. Daca la expirare `total_tickets < minimum_tickets`, runda este anulata:
   - nu se creeaza sidecar/request ORAO;
   - nu se plateste provider fee ORAO;
   - fiecare achizitie este rambursata automat de keeper;
   - valoarea integrala a biletelor revine in walletul care a cumparat;
   - rentul contului Entry revine jucatorului care l-a finantat;
   - dupa refund si arhivare se inchid conturile LuckyMe recuperabile;
   - se deschide o singura runda noua care asteapta primul bilet.
6. Operatia trebuie sa fie reluabila dupa restart si sa nu poata produce refund
   dublu, ORAO dublu, settlement dupa anulare sau doua runde curente.

Fee-ul Solana platit deja retelei pentru tranzactia de cumparare nu poate fi
rambursat. Nu folosi in UI formularea absoluta `no loss` sau `zero cost`.
Formularea corecta este: `100% of the ticket purchase amount is automatically
returned to your wallet. Solana network fees are not refundable.`

## Implementarea on-chain obligatorie

Foloseste praguri fixe derivate din `pool_id`, ca sa eviti schimbarea layoutului
conturilor Config/Pool existente si sa pastrezi compatibilitatea PDA mainnet.
Nu adauga un camp nou in `Pool` daca nu este absolut necesar. Preferinta este o
functie unica, de exemplu `minimum_tickets_for_pool(pool_id)`, cu mappingul
`25 / 13 / 3 / 3` si teste unitare.

Aplica aceeasi regula in toate caile relevante:

- `request_randomness` trebuie sa refuze sub prag inainte de crearea sidecarului;
- settlementul commit-reveal de test trebuie sa refuze sub prag;
- `settle_round_with_provider_randomness` trebuie sa refuze sub prag;
- orice instructiune/provider path directa trebuie sa refuze sub prag;
- refundul trebuie sa fie permis dupa expirare cand pragul nu este atins;
- pragul Premium de trei participanti distincti ramane suplimentar pragului de
  trei bilete;
- nu permite ca un keeper compromis sa ocoleasca pragul doar pentru ca backendul
  sau keeperul off-chain au facut o verificare.

Adauga erori si, daca ajuta istoricul, evenimente explicite, de exemplu
`MinimumTicketsNotReached` si `RoundCancelledBelowMinimum`. Numele finale pot
urma conventiile proiectului, dar IDL-ul si clientii trebuie regenerate si
sincronizate.

Nu cere ORAO pentru o runda sub prag. Verifica explicit ca nu exista sidecar
LuckyMe si nici request account ORAO nou in scenariile de refund.

## Keeper si refund automat

Extinde settlement keeperul existent, fara un al doilea keeper si fara un nou
wallet. Signerul operational ramane exact:

`6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`

La expirarea unei runde cu bilete:

- citeste pragul poolului dintr-un mapping testat care coincide cu programul;
- daca pragul este atins, continua fluxul ORAO normal;
- daca pragul nu este atins, intra direct in refund mode, fara ORAO;
- ramburseaza cate un Entry per actiune sau un batch sigur, respectand limita
  existenta `SETTLEMENT_KEEPER_MAX_ACTIONS`;
- confirma fiecare refund inainte de urmatorul;
- arhiveaza runda drept `cancelled_below_minimum`, nu drept castigatoare;
- expune `refundsPending`, `refundsCompleted` si semnaturile in arhiva;
- inchide Entry cu rent catre player, Round/sidecar catre destinatiile existente;
- dupa cleanup deschide exact o runda noua waiting-first-ticket;
- la restart reia de unde a ramas, fara plata dubla.

Reutilizeaza fluxul de refund existent si corecteaza-l daca este necesar. Nu
introduce o cale paralela nesigura. Documenteaza exact cand devine disponibil
refundul si daca este pastrat delayul actual de siguranta.

## Backend si API

Backendul trebuie sa fie fail-closed si sa expuna pentru fiecare pool/runda cel
putin:

- `minimumTickets`;
- `totalTickets`;
- `ticketsRemaining`;
- `minimumReached`;
- `minimumDistinctEntrants`;
- `refundStatus` (`none`, `pending`, `completed`);
- `roundOutcome` (`waiting`, `open`, `eligible_for_draw`,
  `cancelled_below_minimum`, `settling`, `settled`).

Calculeaza valorile numai din stare on-chain verificata si din arhiva semnata de
keeper. Nu inventa progres static atunci cand RPC-ul lipseste. Endpointurile de
pregatire ORAO/settlement trebuie sa refuze sub prag, chiar daca sunt apelate
direct. Endpointul de cumparare ramane disponibil pana la expirare; pragul nu
este o limita maxima.

## Reproiectarea vizuala a site-ului

Actualizeaza toate suprafetele web relevante, nu doar un text izolat:

- homepage;
- lista/cardurile poolurilor;
- ecranul de review/cumparare;
- Activity/history;
- starea de refund;
- varianta desktop si mobile;
- modalul wallet existent nu trebuie regresat.

Fiecare card de pool trebuie sa aiba un chenar vizibil nou dedicat pragului,
alimentat in timp real din API. Exemplu Mini:

```text
Minimum for a valid draw
1 / 25 tickets sold
[progress bar]
24 tickets still needed
```

Stari obligatorii:

- `0 / 25 tickets sold` cand runda asteapta;
- `1 / 25`, `2 / 25` etc. dupa confirmari;
- `Minimum reached — this round will draw a winner` dupa atingerea pragului;
- `Round cancelled — automatic refunds in progress` daca expira sub prag;
- `Refund complete — ticket purchase amount returned` dupa finalizare;
- `Maintenance required` si butoane dezactivate daca Round PDA lipseste.

Counterul trebuie sa se actualizeze dupa confirmarea on-chain si la refreshul
periodic, fara optimism fals. Foloseste `total tickets sold`, nu `players`.
Afiseaza separat numarul de players, ca acum.

In review-ul de cumparare afiseaza inainte de semnare:

- pragul poolului;
- cate bilete sunt deja vandute;
- cate vor fi dupa aceasta achizitie;
- cate mai lipsesc;
- faptul ca un singur wallet poate cumpara mai multe bilete la Mini/Normal/High;
- regula de refund automat daca pragul nu este atins intr-o ora;
- nota discreta despre fee-ul Solana nerecuperabil.

Texte publice recomandate, in engleza, adaptate designului existent:

- `The target is based on total tickets sold, not the number of players.`
- `If the minimum is not reached before the round ends, no winner is drawn.`
- `100% of the ticket purchase amount is automatically returned to the wallet
  that bought the tickets.`
- `Solana network fees are not refundable.`
- `No claim button is required. Refunds are processed automatically.`

Nu folosi jargon precum PDA, keeper, rent, CPI, sidecar, IDL sau provider fee in
explicatiile pentru jucatori.

## Pagina How to Play

Adauga o pagina/sectiune `How to Play`, accesibila clar din homepage, aplicatie
si navigatia principala. Trebuie sa fie scurta, prietenoasa si non-tehnica.

Continut obligatoriu:

1. **Choose a pool** — Mini, Normal, High sau Premium si pretul biletului.
2. **Connect your wallet** — conectarea este self-custody; site-ul nu cere seed.
3. **Buy tickets** — fiecare bilet are o sansa egala, iar mai multe bilete
   inseamna o sansa mai mare.
4. **The first ticket starts the clock** — runda dureaza o ora de la primul
   bilet confirmat.
5. **Reach the ticket target** — Mini 25, Normal 13, High 3, Premium 3.
6. **Valid draw** — daca pragul este atins, castigatorul/castigatorii sunt
   selectati dupa expirarea orei.
7. **Automatic refund** — daca pragul nu este atins, nu exista tragere; valoarea
   biletelor revine automat in wallet, fara claim manual. Fee-ul Solana nu este
   rambursabil.
8. **Important clarification** — Mini are nevoie de 25 bilete vandute total,
   nu de 25 jucatori. Aceeasi regula de total tickets se aplica Normal si High.
9. **Premium** — un bilet per wallet, trei walleturi distincte, trei castigatori
   si splitul existent 70/20/10 al premiului principal.

Include un tabel simplu cu pool, pret bilet, target total tickets, numar de
castigatori si limita per wallet. Valorile trebuie sa provina din aceeasi sursa
de configurare folosita de carduri sau sa fie protejate prin teste de consistenta.

Pastreaza designul LuckyMe existent si fa pagina complet responsive si
accesibila: headings corecte, contrast, focus keyboard, aria labels si reduced
motion. Verifica vizual in browser la desktop si mobile.

## Seeker / aplicatia mobila

Oglindeste aceleasi reguli si stari in `app-seeker`, inclusiv:

- cardul cu `sold / minimum`;
- progresul in timp real;
- mesajele de refund;
- How to Play;
- clarificarea total tickets versus players;
- nota despre network fee.

Nu lasa site-ul si aplicatia sa prezinte reguli diferite.

## APK Android complet, semnat si copiat pe Desktop

Dupa ce programul, backendul, site-ul si Seeker sunt sincronizate in surse si
toate testele trec, produce un APK nou, instalabil pe Solana Seeker, folosind
profilul `dapp-store` existent si credentialele EAS-managed deja asociate
proiectului.

Ordinea obligatorie pentru APK:

1. Actualizeaza versiunea aplicatiei si `android.versionCode` in mod monoton,
   fara a reutiliza versionCode-ul APK-ului anterior.
2. Verifica `app-seeker/app.json`, `app.config.js`, `eas.json` si variabilele
   `MAINNET_RELEASE`; nu permite localhost, LAN, placeholder sau Program ID gresit.
3. Ruleaza production validation, typecheck, doctor si prebuild/build checks.
4. Foloseste prioritar EAS cloud build cu profilul `dapp-store`, deoarece acesta
   pastreaza signing credentials existente. Asteapta build-ul pana la final,
   descarca artifactul si nu considera doar URL-ul EAS drept livrabil.
5. Daca EAS cloud este indisponibil, foloseste build local numai daca signing
   credentials existente pot fi folosite fara a crea alt certificat.
6. Nu livra APK debug, unsigned, universal preview nesemnat sau `.aab` in locul
   APK-ului cerut.

### Icon LuckyMe obligatoriu

APK-ul trebuie sa afiseze iconul real LuckyMe in launcher. Nu accepta iconul
Expo implicit, iconul portocaliu generic sau o imagine statica placeholder.

- Verifica si corecteaza `app-seeker/assets/icon.png`.
- Verifica si corecteaza `app-seeker/assets/adaptive-icon.png`.
- Pastreaza fundalul dark LuckyMe, safe-zone corect si transparenta potrivita.
- Verifica splash-ul LuckyMe separat; splash-ul nu inlocuieste launcher icon.
- Dupa build, inspecteaza APK-ul cu `aapt`/`apkanalyzer` si extrage/rescrie
  launcher resources pentru verificare vizuala.
- Compara vizual iconul extras din APK cu logo-ul LuckyMe din sursa.
- Daca apare iconul portocaliu/default, APK-ul este respins: corecteaza assetele,
  curata prebuild/cache-ul relevant si reconstruieste pana cand iconul este bun.

### Verificarea APK

Verifica obligatoriu:

- package: `com.luckyme.seeker`;
- versionName si versionCode noi;
- APK Signature Scheme valida;
- certificatul signer trebuie sa ramana acelasi ca release-ul anterior, SHA-256
  `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`;
- hash SHA-256 al APK-ului;
- dimensiune;
- manifestul si permisiunile;
- absenta endpointurilor localhost/LAN si a secretelor;
- Program ID mainnet corect;
- pornire fara crash si navigare prin Home, Pools, How to Play, Wallet, Activity;
- cardurile `sold / minimum`, refund si textele total tickets versus players;
- iconul LuckyMe in launcher.

Ruleaza `apksigner verify --verbose --print-certs`, scriptul `apk:verify` si,
daca un Seeker/Android conectat este disponibil prin ADB, instaleaza APK-ul ca
upgrade, porneste aplicatia, inspecteaza logcat si fa un smoke test fara a semna
tranzactii mainnet. Nu dezinstala versiunea utilizatorului si nu sterge datele
aplicatiei.

### Copia Desktop

Copiaza APK-ul verificat la o cale clara de pe Desktop, de exemplu:

`/Users/victor/Desktop/LuckyMe-Seeker-MINIMUM-TICKETS-TEST-<version>-<date>.apk`

Nu suprascrie APK-ul final anterior. Langa el creeaza un fisier text/Markdown
cu acelasi nume de baza care contine:

- SHA-256;
- certificat signer SHA-256;
- package/version/versionCode;
- data buildului si EAS build ID;
- lista scurta a functiilor noi;
- instructiuni de instalare pe Seeker;
- mentiunea clara ca noua logica on-chain nu este activa pe mainnet pana la
  aprobarea si executarea upgrade-ului programului.

Nu copia pe Desktop keystore, parole, credentiale sau alte fisiere sensibile.

## Teste de acceptare obligatorii

Adauga teste unitare, Anchor/localnet si client/UI pentru cel putin:

1. Mini 24 bilete expira: zero ORAO, zero castigator, refund integral.
2. Mini 25 bilete, chiar dintr-un singur wallet: eligibila pentru ORAO/draw.
3. Normal 12 bilete: refund; Normal 13: draw.
4. High 2 bilete: refund; High 3: draw.
5. Premium 2 walleturi: refund; Premium 3 walleturi/bilete: draw cu trei
   castigatori distincti.
6. Pragul este total tickets, nu entrant count, pentru Mini/Normal/High.
7. Doua cumparari concurente in jurul pragului nu pierd bilete si nu reseteaza
   timerul.
8. Nu exista refund inainte de expirare.
9. Sub prag nu poate fi creat sidecarul si nu poate fi cerut ORAO nici prin
   apel direct.
10. Peste prag exista cel mult un request ORAO.
11. Refundul returneaza principalul exact si Entry rent playerului.
12. Restartul keeperului nu produce refund sau ORAO dublu.
13. Dupa ultimul refund conturile se inchid si se deschide o singura runda noua.
14. API-ul si UI-ul afiseaza exact `1 / 25`, `12 / 13`, `2 / 3` etc.
15. UI-ul nu spune niciodata `25 players` pentru pragul Mini.
16. Wallet modal/Wallet Standard/WalletConnect nu regreseaza.
17. Pool lipsa ramane fail-closed, cu Join/Buy dezactivate.

Ruleaza cel putin:

```bash
npm test
npm run app:typecheck
npm run app:validate:production
npm run audit:mainnet-release
NO_DNA=1 cargo test --workspace
NO_DNA=1 anchor test --provider.cluster localnet --validator legacy -- --features test-short-timers
```

Ruleaza build-ul programului cu toolchainul aprobat si verifica IDL/clientele.
Nu accepta doar teste regex; scenariile de prag si refund trebuie executate
comportamental.

## Verificare economica si de securitate

Pentru fiecare pool produce un tabel cu:

- ticket price;
- minimum tickets;
- valoare minima vanduta;
- 2% treasury la prag;
- cost ORAO observat `0.0023494 SOL`;
- estimare fee keeper, inclusiv numarul de Entry accounts;
- marja minima si worst-case cu cate un wallet per bilet.

Verifica explicit daca Mini 25 ramane break-even in worst-case. Nu schimba
pragurile aprobate fara sa raportezi mai intai rezultatul si sa ceri decizie.

Auditul trebuie sa includa:

- overflow/underflow;
- bypass direct al pragului;
- refund dublu;
- replay/restart;
- conturi Entry false sau cu owner/discriminator gresit;
- destination pentru principal si rent;
- blocarea ORAO sub prag;
- tranzitii valide de stare;
- compatibilitatea conturilor mainnet existente;
- protectiile mainnet si signerul keeper corect.

## Actualizare completa GitHub

Dupa ce sursele, testele, site-ul, Seeker, APK-ul si documentatia sunt gata,
actualizeaza complet repository-ul GitHub configurat al proiectului. Aceasta
operatie este autorizata de proprietar si trebuie efectuata fara o alta intrebare.

1. Confirma repository-ul, remote-ul, branch-ul curent si upstream-ul. Nu impinge
   accidental intr-un alt proiect LuckyMe.
2. Ruleaza `git status`, inspecteaza toate modificarile existente si include
   toate schimbarile intentionate ale proiectului, inclusiv lifecycle/rent,
   praguri, refund, site, Seeker, teste si documentatie.
3. Nu include build caches, `node_modules`, `target`, validator ledgers, loguri,
   dumpuri RPC cu date sensibile, APK-ul binar, keystore sau credentiale.
4. Actualizeaza `.gitignore` daca este necesar.
5. Ruleaza `git diff --check`, secret scan si toate testele finale inainte de
   commit.
6. Actualizeaza `README.md`, `docs/handoff.md`, checklisturile de deploy si un
   raport nou care descrie exact ce este implementat local/GitHub si ce ramane
   neactivat pe mainnet.
7. Foloseste un commit clar, de exemplu:
   `Implement funded-round minimums, automatic refunds, player UX, and Seeker APK`
8. Ruleaza `git fetch` si integreaza non-distructiv eventualele schimbari remote.
   Rezolva conflictele fara sa pierzi modificarile utilizatorului.
9. Fa push normal pe upstream. Nu folosi `--force` sau `--force-with-lease`.
10. Verifica prin `git status`, `git log` si remote ca commitul publicat este
    exact commitul local. Raporteaza branch, commit SHA si URL-ul repository-ului.

APK-ul ramane pe Desktop si nu se comite in repository, exceptand cazul in care
repository-ul are deja explicit o politica Git LFS/release artifacts aprobata.
Comite numai raportul APK cu hashul si certificatul, nu credentialele.

## Ordinea de lucru

1. Inspecteaza complet modificarile locale si starea live read-only.
2. Scrie un plan scurt si identifica toate fisierele afectate.
3. Implementeaza programul, keeperul, backendul si clientii.
4. Implementeaza redesignul complet al site-ului si How to Play.
5. Implementeaza aceleasi reguli si suprafete in Seeker.
6. Ruleaza toate testele, build-urile, auditul si preview-ul vizual.
7. Verifica dry-run keeper pentru scenarii sub si peste prag.
8. Construieste si verifica APK-ul semnat; corecteaza iconul pana cand APK-ul
   contine launcher icon LuckyMe, apoi copiaza APK-ul si raportul pe Desktop.
9. Construieste artifactul Solana final si raporteaza:
   - SHA-256 si dimensiune;
   - diferenta fata de programul live;
   - daca incape in ProgramData existent;
   - buffer rent temporar exact;
   - fee nerecuperabil estimat;
   - toate tranzactiile mainnet necesare;
   - planul de rollback.
10. Actualizeaza complet README, handoff si documentatia operationala.
11. Ruleaza ultima verificare de secrete si fisiere generate.
12. Commit si push normal pe GitHub, apoi verifica remote commitul.
13. Opreste-te inainte de orice transfer SOL, semnare Ledger, upgrade program
    sau deploy live si lasa raportul de aprobare mainnet pregatit.

## Identitati si limite mainnet

- Cluster: `mainnet-beta`.
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Keeper unic: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.
- KeeperConfig: `8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y`.
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`.
- Fee payer temporar existent, daca se aproba reutilizarea:
  `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`.

Nu genera un nou keeper sau un al treilea wallet operational. Nu afisa si nu
copia chei private. Nu presupune ca acest fisier autorizeaza refolosirea sau
finantarea fee-payerului temporar; prezinta intai suma exacta dupa build.

Starea de pornire asteptata este: etapele 1 si 2 finalizate, API activ, toate
poolurile cu `activeRound: null`, site fail-closed, keeper timer disabled si
service inactive. Daca starea live difera, opreste planul de lansare si explica.

## Livrabile finale inainte de aprobarea mainnet

- cod si IDL sincronizate;
- toate testele si auditul trecute;
- preview desktop/mobile verificat in browser;
- capturi pentru cardurile cu target, refund si How to Play;
- APK Android complet semnat si verificat;
- launcher icon LuckyMe verificat din interiorul APK-ului;
- copie APK pe Desktop, fara suprascrierea release-ului anterior;
- raport APK cu hash, signer certificate, package/version/versionCode si EAS ID;
- smoke test Seeker/ADB daca dispozitivul este disponibil;
- tabel economic real, inclusiv worst-case Mini 25;
- artifact `.so`, hash, dimensiune si buffer rent exact;
- plan de tranzactii si simulare mainnet fara semnare;
- lista clara a textelor publice despre refund si network fee;
- lista riscurilor ramase;
- README/handoff/checklisturi complet actualizate;
- commit GitHub publicat, branch, commit SHA si verificare remote;
- promptul exact de aprobare pentru etapa de upgrade mainnet.
