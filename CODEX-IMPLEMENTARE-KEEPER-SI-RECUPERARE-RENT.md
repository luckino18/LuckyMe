# Sarcina Codex: ciclul poolurilor, keeper unic si recuperarea rentului

Acest fisier este promptul de executie pentru urmatorul Codex. Lucreaza in
acest repository si continua peste modificarile locale existente. Nu sterge,
nu reseta si nu suprascrie modificarile necomise inainte sa le inspectezi.

## Obiectiv

Finalizeaza, testeaza si pregateste pentru lansare urmatorul comportament:

1. Fiecare pool are o singura runda curenta care asteapta primul bilet.
2. O runda noua are `start_ts = 0` si `end_ts = 0`.
3. Prima cumparare reusita de bilet seteaza atomic `start_ts` si
   `end_ts = start_ts + 3600`.
4. Keeperul nu inchide si nu redeschide periodic o runda fara bilete.
5. ORAO este cerut o singura data, numai dupa expirarea unei runde care are
   bilete. Repornirile sau poolurile goale nu trebuie sa produca cereri ORAO.
6. Dupa finalizarea si arhivarea unei runde, conturile LuckyMe care nu mai sunt
   necesare se inchid, iar rentul este recuperat.
7. Selectorul de wallet al site-ului este un modal asemanator capturii furnizate:
   detecteaza extensiile Wallet Standard instalate in browser si ofera separat
   Reown / WalletConnect. Nu afisa walleturi injectate ca fiind instalate daca
   nu au fost detectate.

Nu modifica preturile, procentele sau introduce praguri minime de bilete fara
o decizie separata a proprietarului. Aceasta sarcina repara ciclul si rentul,
dar nu schimba economia poolurilor.

## Identitatea operationala obligatorie

- Cluster: `mainnet-beta`
- Program LuckyMe: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Keeper activ observat pe VPS:
  `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- Keeperul din planul initial, care nu este signerul automatizarii curente:
  `8TN3gVGp86EUnmpa3ncMpPHoWDAV7t997RuXaLesRWqV`

Trebuie sa existe un singur keeper operational documentat. Nu genera un al
treilea wallet. Pe VPS, citeste doar cheia publica a signerului configurat si
verifica faptul ca este exact `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.
Nu afisa, nu copia si nu solicita cheia privata sau seed phrase. Daca signerul
de pe VPS nu corespunde, opreste operatia si cere decizia proprietarului.

## Ce trebuie verificat in modificarile locale

Inspecteaza mai intai modificarile deja existente. Implementarea locala include
deja parti pentru:

- timer pornit de `buy_tickets` la primul bilet;
- inchiderea reala a conturilor Round goale;
- inchiderea Entry, RoundRandomness si Round dupa arhivare;
- arhiva append-only pentru istoricul rundelor;
- settlement keeper cu dry-run si protectie mainnet;
- modalul de conectare si detectarea walleturilor.

Nu dubla aceste schimbari. Corecteaza doar ce lipseste sau este gresit si
pastreaza compatibilitatea cu PDA-urile si conturile deja existente pe mainnet.

## Destinatia corecta a rentului

- `Round` inchis: rentul revine adresei `config.treasury` citite on-chain.
- `Entry` inchis: rentul revine jucatorului care a finantat contul.
- `RoundRandomness` LuckyMe inchis dupa settlement: rentul revine destinatiei
  definite si documentate de program; nu lasa contul blocat.
- Contul de request detinut de programul ORAO nu poate fi inchis de LuckyMe si
  nu trebuie inclus in suma recuperabila.

Nu trimite rentul catre o adresa introdusa manual. Pentru Round foloseste
intotdeauna `config.treasury` verificat on-chain.

## Recuperarea rentului rundelor goale istorice

Adauga sau finalizeaza un utilitar dedicat, de exemplu
`scripts/recover-legacy-empty-round-rent.mjs`, si un script npm
`rent:recover:legacy-empty`. Utilitarul trebuie sa fie separat de settlementul
normal, ca sa nu porneasca accidental cereri ORAO sau runde noi.

Comportament obligatoriu:

1. Ruleaza implicit numai in mod inventar/dry-run.
2. Scaneaza toate cele patru pooluri si toate Round PDA istorice, nu numai
   ultimele 20 de runde.
3. Pentru fiecare cont valideaza program owner, discriminatorul, PDA-ul derivat,
   poolul si round id-ul. Datele RPC sunt considerate nevalidate pana trec
   aceste controale.
4. Include pentru recuperare numai rundele cu:
   `total_tickets == 0`, `total_lamports == 0` si `entrant_count == 0`.
5. Nu inchide runda curenta noua care asteapta primul bilet
   (`start_ts == 0`, `end_ts == 0`, `settled == false`).
6. Nu inchide nicio runda cu bilete, fonduri, entries active sau settlement
   nefinalizat.
7. Pentru o runda legacy expirata, goala si inca nesettled, foloseste
   `close_empty_round_after_timeout` dupa upgrade.
8. Pentru o runda legacy goala deja marcata `settled` de vechiul program,
   arhiveaza mai intai starea si foloseste fluxul `close_settled_round`.
9. Simuleaza fiecare tranzactie sau batch inainte de trimitere. Batchurile
   trebuie sa fie mici si limitate configurabil.
10. Produce inainte de executie un tabel cu pool, round id, Round PDA, lamports,
    clasificare si destinatia rentului, plus totalul estimat recuperabil.
11. Dupa executie produce acelasi tabel cu semnatura fiecarei tranzactii,
    soldul treasury inainte/dupa si totalul efectiv recuperat.
12. Operatia trebuie sa fie reluabila: conturile deja inchise sunt raportate si
    sarite, fara eroare si fara plata inutila.

Protectia mainnet trebuie sa ceara simultan un flag explicit, de exemplu
`DRY_RUN=false` si `CONFIRM_MAINNET_RENT_RECOVERY=true`. Fara ambele, utilitarul
nu semneaza si nu trimite nimic.

## Ordinea obligatorie de lucru si lansare

1. Opreste timerul vechi al keeperului inainte de upgrade, fara a sterge
   serviciul sau datele lui.
2. Salveaza un inventar read-only al poolurilor, rundelor, soldului keeperului
   si treasury. Nu muta fonduri in aceasta etapa.
3. Confirma Program ID, clusterul, upgrade authority si cheia publica a
   keeperului. Nu expune material secret.
4. Ruleaza toate verificarile locale relevante: testele Node, testele Anchor pe
   localnet, build-ul programului, typecheck-ul aplicatiei si auditul de release.
5. Verifica explicit scenariile:
   - pool gol ramane neschimbat mai mult de o ora;
   - primul bilet porneste exact un timer de o ora;
   - doua cumparari concurente nu reseteaza timerul;
   - un pool gol nu genereaza ORAO;
   - o runda platita genereaza cel mult un request ORAO;
   - rentul fiecarui tip de cont ajunge la destinatia documentata;
   - utilitarul de recuperare nu poate inchide o runda cu fonduri sau bilete.
6. Pregateste sumarul upgrade-ului si al tuturor tranzactiilor mainnet:
   program, instructiune, conturi, fee payer, destinatie rent, estimare fee si
   simulare. Cere aprobarea explicita a proprietarului inainte de orice semnare
   sau trimitere mainnet.
7. Dupa aprobare: upgrade program, actualizeaza IDL/client, backend, keeper si
   site in mod coordonat. Nu porni keeperul vechi peste programul nou.
8. Ruleaza utilitarul de recuperare intai in dry-run si arata inventarul si
   totalul. Cere o a doua aprobare explicita pentru recuperarea mainnet.
9. Dupa a doua aprobare, recupereaza rentul in batchuri mici, cu simulare si
   confirmare intre batchuri.
10. Ruleaza keeperul nou in dry-run. Dupa verificare, porneste serviciul si
    monitorizeaza cel putin un ciclu complet de runda platita si o perioada cu
    pool gol.

## Criterii de acceptare

- Niciun pool gol nu isi schimba round id-ul si nu produce ORAO sau rent nou.
- Timerul vizibil si on-chain incepe la prima cumparare confirmata.
- O runda platita foloseste cel mult un request ORAO.
- Toate Round PDA goale istorice eligibile sunt inventariate, iar dupa
  aprobarea mainnet sunt inchise catre `config.treasury`.
- Raportul final contine suma estimata, suma recuperata si toate semnaturile.
- Keeperul activ raportat de serviciu este exact
  `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.
- Site-ul detecteaza walleturile instalate si pastreaza separat optiunea
  WalletConnect.

## Limita de siguranta

Acest fisier autorizeaza implementare, teste, inventar read-only si pregatirea
tranzactiilor. Nu autorizeaza singur upgrade-ul programului, semnarea sau
trimiterea tranzactiilor mainnet si nici mutarea SOL. Pentru fiecare etapa
mainnet trebuie obtinuta confirmarea explicita a proprietarului dupa prezentarea
simularii si a sumarului tranzactiilor.
