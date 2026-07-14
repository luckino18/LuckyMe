# Codex — remediere aliniere pooluri si WalletConnect web

Lucreaza in repository-ul LuckyMe curent. Citeste integral `README.md`,
`docs/handoff.md`, `docs/mainnet-minimum-tickets-upgrade-execution-2026-07-12.md`
si fisierele locale relevante inainte de modificari. Pastreaza toate
modificarile locale existente si nu rescrie functionalitati care nu tin de
acest incident.

## Limita stricta de siguranta

Aceasta sarcina este exclusiv pentru frontendul web si testele sale.

- Nu modifica programul Solana, IDL-ul, SDK-ul, backendul economic sau APK-ul.
- Nu trimite tranzactii, nu transfera SOL, nu deschide runde si nu cere ORAO.
- Nu porni keeperul, nu instala write override si nu modifica timerul keeperului.
- Nu modifica pragurile `25 / 13 / 3 / 3`, preturile, refundul sau economia.
- Nu solicita si nu expune chei private, seed-uri ori fisiere keypair.

## Probleme confirmate

### 1. Cele patru carduri de pool nu sunt aliniate

In `https://www.lucky-me.app/play/`, la layoutul desktop cu patru coloane,
continutul intern al cardurilor Mini, Normal, High si Premium incepe la
inaltimi diferite.

Masurare existenta la viewport `1440 x 1000`:

- Mini si High: `.pool-title` are 61 px, iar `.entry` incepe la y=686;
- Normal si Premium: `.pool-title` are 42 px, iar `.entry` incepe la y=667;
- diferenta este 19 px, provocata de etichetele de sus care se rup pe doua
  randuri numai in unele carduri;
- `.minimum-target` are 167 px la Mini/Normal/High, dar 185 px la Premium;
- din acest motiv `.facts-grid` incepe la y=888 pentru Normal, y=905 pentru
  Premium si y=907 pentru Mini/High.

La viewport `1920 x 1080`, titlurile si preturile sunt aliniate, dar Premium
ramane cu `.minimum-target` de 167 px fata de 149 px la celelalte carduri, deci
sectiunea de facts este decalata cu 18 px.

Corecteaza structura, nu doar un singur text. Cele patru carduri trebuie sa aiba
aceleasi randuri vizuale pentru:

1. label + nume + status;
2. pret;
3. chenarul `Minimum for a valid draw`;
4. facts grid;
5. nota si butonul final, cand sunt afisate.

Foloseste o solutie CSS/markup robusta, cu randuri sau inaltimi rezervate
coerent la breakpointul cu patru coloane. Nu ascunde si nu trunchia informatia
Premium despre cele trei walleturi. Continutul dinamic, statusurile lungi,
`My tickets`, refundul si rundele active trebuie sa ramana lizibile. La
desktop, pozitiile verticale ale sectiunilor echivalente din toate cele patru
carduri trebuie sa difere cu maximum 1 px. Pe mobil cardurile pot ramane cu
inaltime naturala si trebuie sa nu aiba overflow orizontal.

Verifica minimum urmatoarele viewporturi:

- `390 x 844`;
- `768 x 1024`;
- `1024 x 768`;
- `1366 x 768`;
- `1440 x 1000`;
- `1920 x 1080`.

Nu considera remedierea completa doar pentru ca marginile exterioare ale
cardurilor au aceeasi inaltime. Masoara `getBoundingClientRect()` pentru
`.pool-title`, `h3`, `.entry`, `.minimum-target`, `.facts-grid` si butonul final.

### 2. WalletConnect ramane blocat in `Opening WalletConnect...`

In browserul utilizatorului, extensiile Phantom, Talisman si Solflare sunt
detectate, dar apasarea `Reown / WalletConnect` poate lasa modalul blocat
nelimitat in `Opening WalletConnect...`, fara QR, URI, eroare sau posibilitate
reala de retry.

Implementarea actuala din `site/lucky-me.app/app.js` incarca la runtime:

- `@walletconnect/universal-provider` de pe unpkg;
- `@walletconnect/modal` prin import din CDN;
- `UniversalProvider.init()`;
- apoi asteapta `provider.connect()`.

Aceste faze nu au timeout. Daca un CDN, dynamic import, relay, ad blocker,
privacy shield sau provider init ramane pending, interfata ramane permanent in
starea `Opening WalletConnect...`. Intr-un browser de control fluxul a emis URI
in aproximativ 3 secunde, deci problema trebuie tratata ca defect
cross-browser/intermitent si diagnosticata in browserul unde se reproduce; nu
presupune ca este rezolvata doar fiindca functioneaza intr-un singur profil.

## Cerinte pentru remedierea WalletConnect

1. Reproduce si inspecteaza Console + Network in Chrome/Brave desktop, inclusiv
   cu extensii Solana instalate. Identifica faza exacta care ramane pending.
2. Elimina dependenta fragila de incarcare runtime de pe unpkg daca este cauza.
   Prefera dependinte versionate si bundle-uri statice servite de acelasi site.
   Daca pastrezi un CDN, implementeaza fallback local verificabil.
3. Pune timeout explicit si mesaj actionabil separat pentru:
   - incarcare provider/modal;
   - initializare provider;
   - obtinerea URI-ului de pairing.
   Timeoutul pentru aparitia URI-ului nu trebuie confundat cu timpul in care
   utilizatorul scaneaza si aproba sesiunea in wallet.
4. La `display_uri`, afiseaza sigur QR-ul Reown/WalletConnect. Daca modalul QR
   nu poate fi incarcat, afiseaza fallback local cu QR si buton de copiere URI;
   nu lasa doar `Opening...`.
5. Adauga `Cancel` si `Try again`. La cancel, timeout sau eroare, curata
   listenerii, providerul partial, URI-ul vechi, starea busy si modalul extern.
6. Butonul trebuie sa fie disabled numai cat timp exista o operatie activa si
   sa revina utilizabil dupa eroare/cancel. Previne dublu-click si sesiuni
   paralele.
7. Afiseaza o eroare umana clara, fara stack trace si fara a loga URI-ul,
   adresa ori alte date sensibile.
8. Verifica allowlist/origin-ul proiectului Reown pentru:
   `https://lucky-me.app` si `https://www.lucky-me.app`. Project ID-ul public
   poate ramane in `config.js`; nu introduce secrete in repository.
9. Pastreaza lantul exclusiv Solana mainnet si metodele de semnare existente.
   Nu relaxa validarea contului, chain ID-ului sau a semnaturii.
10. Testeaza separat conectarea directa pentru fiecare wallet Wallet Standard
    detectat. Cardurile Phantom/Solflare/Talisman nu trebuie directionate prin
    WalletConnect daca extensia lor compatibila este deja instalata.

## Teste obligatorii

Adauga teste care esueaza pe implementarea veche si trec dupa remediere:

- geometria celor patru carduri la breakpointurile desktop, cu toleranta 1 px;
- text Premium mai lung fara overflow sau trunchiere;
- wallet provider script/import respins;
- provider init care ramane pending;
- `display_uri` care nu apare la timp;
- aparitia URI/QR in fluxul reusit;
- cancel si retry dupa timeout;
- click dublu fara doua sesiuni;
- conectare Wallet Standard directa cu wallet mock;
- niciun unhandled rejection si nicio stare infinita `Opening WalletConnect...`.

Ruleaza cel putin:

```bash
npm test
npm run audit:mainnet-release
git diff --check
```

Fa si verificare vizuala reala in browser la toate viewporturile cerute. Salveaza
capturi noi in `docs/screenshots/` pentru desktop patru-coloane, mobil si modalul
WalletConnect cu QR/fallback vizibil. Nu salva un URI WalletConnect real in
capturile sau documentele comise.

## Deploy si verificare finala

Dupa ce toate testele locale trec:

1. actualizeaza cache-buster-ul pentru CSS/JS/config, ca browserul sa nu ramana
   pe resursele defecte;
2. creeaza backup atomic al site-ului live;
3. publica numai fisierele statice necesare pentru aceasta remediere;
4. verifica hashurile locale/live;
5. ruleaza smoke test pe `https://www.lucky-me.app/play/`;
6. verifica in Chrome/Brave si pe mobil ca WalletConnect afiseaza QR/deep link
   sau o eroare cu retry intr-un timp limitat;
7. confirma din nou ca keeperul este disabled/inactive, write override absent si
   toate `activeRound` raman neschimbate;
8. documenteaza cauza, fisierele schimbate, testele, backupul si rezultatul live;
9. commit si push pe branchul curent. Nu face merge in `main` fara instructiune
   explicita.

La final raporteaza concis:

- cauza exacta a fiecarui defect;
- masuratorile de aliniere inainte/dupa;
- comportamentul WalletConnect in succes, timeout si retry;
- fisierele si commitul;
- URL-ul live verificat;
- confirmarea explicita ca nu s-a facut nicio tranzactie si keeperul nu a fost
  pornit.
