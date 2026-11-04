# Zcore platforma: firme, paketi, plaćanja i zaključavanje — dizajn

Datum: 2026-11-04 · Vlasnik proizvoda: Zcore (platformski admin) · Status: čeka odobrenje

## Zašto

Zcore naplaćuje firme mjesečno po fakturi, uplatom na račun (većina firmi nema
karticu za online plaćanje). Danas platformski admin vidi samo jednu stranicu s
listom firmi i uključenim modulima. Treba mu jedno mjesto gdje prati svaku firmu:
koji paket ima, šta koristi, da li je platila, i mogućnost da firmu koja ne plaća
zaključa (ručno ili automatski nakon roka), a da njeni radnici ipak mogu završiti
započeti posao.

## Ciljevi

1. **Lista firmi** (`/platform`): paket, mjesečni iznos, stanje (aktivna / kasni /
   zaključana / proba), zadnja plaćena mjesec, broj korisnika; filteri "Sve",
   "Kasne s uplatom", "Zaključane", "Proba"; pretraga.
2. **Detalj firme** (`/platform/organizations/[id]`, klik na red): paket i moduli,
   plaćanja po mjesecima, zaključaj / otključaj, ulaz za podršku (postojeći tok),
   historija promjena.
3. **Postavke platforme** (`/platform/settings`): paketi (naziv, mjesečna cijena,
   moduli) koje admin sam pravi i mijenja; rok za uplatu nakon isteka mjeseca;
   broj dana upozorenja prije zaključavanja; probni period (postoji).
4. **Moduli podijeljeni na 10** (tabela ispod), paket = skup modula.
5. **Zaključavanje** koje se provodi na serveru i u bazi (ne samo skrivena dugmad).

Odobrena skica: `.superpowers/brainstorm/…/content/platform-v1.html` (ekrani A, B, C).

## Ne-ciljevi

- Online plaćanje, kartice, generisanje ili slanje faktura iz aplikacije.
- Plaćanje na rate / djelimična uplata (vlasnik: "to ne može tako"). Mjesec je
  **plaćen ili nije**.
- Obračun dijela mjeseca pri promjeni paketa.
- Moduli 11–15 (održavanje, ponude/narudžbe, nabavka, kalkulacija, kvalitet+):
  dolaze kasnije, kao posebni projekti; do tada se nigdje ne prikazuju.

## Anti-ciljevi (neuspjeh čak i ako "radi")

- Zaključana firma ne može završiti nalog koji je već u proizvodnji, ne može
  isporučiti robu iz njega, ili radnici ne mogu otkucati dolazak.
- Zaključavanje koje se zaobilazi direktnim pozivom API-ja (mora važiti u RLS-u i
  u RPC funkcijama).
- Firma koja je platila ostane zaključana (otključavanje mora biti odmah).
- Platformski admin vidi podatke firme (nalozi, radnici…) bez odobrenog ulaza za
  podršku (D-026 ostaje).
- Sporost: provjera zaključanosti u svakom redu (D-042: jednom po upitu).

## Moduli (odobreno)

| Ključ (prijedlog) | Naziv                           | Sadrži                                                                                    | Zavisi od  |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| `core`            | Osnova (uvijek)                 | korisnici/uloge, firma, kupci, mašine, zaposleni, dashboard, obavijesti, podrška          | —          |
| `production`      | Proizvodnja                     | proizvodi, revizije, radni nalozi, rad na mašini, kontrola, pregled proizvodnje           | —          |
| `planning`        | Planiranje                      | plan po danima/mašinama, zastoji mašina, vanjske operacije                                | production |
| `reports`         | Izvještaji                      | izvještaji proizvodnje, naloga, magacina, izvoz                                           | —          |
| `inventory`       | Magacin materijala              | prijemi, lotovi, certifikati, inventura, materijal po nalozima, etikete, skeniranje       | —          |
| `finished_goods`  | Gotova roba i otpremnice        | prijem gotove robe, otpremnice, PDF, mail                                                 | production |
| `tools`           | Alati                           | magacin alata, alati po mašinama                                                          | —          |
| `attendance`      | Radno vrijeme                   | dolazak/odlazak preko aplikacije, smjene, raspored, odsustva, korekcije, mjesečni pregled | —          |
| `kiosk`           | Kiosk (dodatak)                 | tablet, NFC kartica, ime + PIN                                                            | attendance |
| `payroll`         | Obračun sati za plate (dodatak) | satnice, dodaci, izvoz za knjigovođu                                                      | attendance |

Prelaz postojećih firmi (bez gubitka): firma s `production` dobija i `planning`,
`reports`; s `inventory` dobija `finished_goods`, `tools`; s `attendance` dobija
`kiosk`, `payroll` — s istim `active_until` (proba ostaje proba). Postojeće
provjere `modules.has("production" | "inventory" | "attendance")` u stranicama i
`private.module_enabled` u bazi prelaze na odgovarajući uži ključ.

Zavisnosti: modul se ne može uključiti bez modula od kojeg zavisi; isključivanje
roditelja isključuje i zavisne (u paketu i pri ručnoj promjeni).

## Paketi

- Platformski admin pravi pakete: naziv, mjesečna cijena (numeric, KM), skup modula
  (`core` uvijek). Paket se arhivira, ne briše (pravilo 8); arhiviran paket ostaje
  firmama koje ga imaju, ali se ne nudi novim.
- Firma ima najviše jedan paket. Moduli firme = moduli paketa + pojedinačne probe
  (postojeći `org_modules.active_until`). Promjena paketa odmah mijenja module.
- Firma bez paketa = proba (kao danas) ili ništa.
- Iznos mjeseca se pamti u trenutku kad mjesec počne (promjena cijene paketa ne
  mijenja prošle mjesece).

## Plaćanja i rokovi

- Obračunski period = kalendarski mjesec u vremenskoj zoni firme. Prvi obračunski
  mjesec = mjesec u kojem je paket dodijeljen (od tada firma plaća).
- Rok za mjesec M = posljednji dan mjeseca M + **rok iz postavki** (default 15 dana;
  firmi se može postaviti drugačiji rok).
- Admin za mjesec klikne **"Označi plaćeno"**: datum uplate (default danas) i
  napomena (npr. broj fakture). **"Poništi"** vraća na neplaćeno. Svaka promjena
  → audit log (ko, kada, prije/poslije).
- Stanje mjeseca: _čeka uplatu_ (rok nije prošao), _nije plaćeno_ (rok prošao),
  _plaćeno <datum>_.

## Zaključavanje

**Kada je firma zaključana:**

- ručno: admin klikne "Zaključaj" (s razlogom); ostaje zaključana dok je ne otključa; ili
- automatski: uključeno za firmu (default da) **i** postoji obračunski mjesec čiji je
  rok prošao, a nije plaćen.

Admin može i ručno otključati firmu koja bi automatski bila zaključana ("otključaj
do <datum>"), npr. kad firma javi da je uplata na putu. _(Moja odluka; vidi dolje.)_

**Stanje se računa iz podataka** (ručno zaključavanje, plaćeni mjeseci, rok, paket)
u trenutku upita — bez noćnog posla. Zato se firma otključa istog trenutka kad se
uplata označi, i zaključa se tačno kad rok prođe.

**Šta zaključana firma i dalje može (odobreno):**

- sve gledati i štampati / izvesti PDF;
- kiosk i otkucavanje dolaska / odlaska preko aplikacije;
- radnici na postojećim nalozima: start, pauza, prijava komada, završetak, zastoji,
  izmjena alata, kontrola;
- da bi postojeći nalozi išli do kraja: promjene statusa postojećih naloga,
  izdavanje materijala za postojeće naloge, prijem gotove robe iz njih, otpremnica
  za tu robu;
- zahtjev / odobrenje ulaza za podršku; vlastiti profil, lozinka, obavijesti.

**Šta ne može:** novi nalozi, proizvodi, kupci, korisnici, prijemi materijala,
planiranje, postavke i sve ostalo što dodaje ili mijenja podatke.

**Provedba:**

- Jedna funkcija u bazi, npr. `private.org_locked(org)` (i set-varijanta po uzoru na
  `permitted_org_ids`, da se u RLS-u računa jednom po upitu).
- RLS politike za upis (insert/update/delete) na tabelama koje nisu na listi
  dozvoljenog dobijaju uslov "firma nije zaključana".
- SECURITY DEFINER RPC-ovi koji kreiraju nove stvari provjeravaju zaključanost i
  bacaju `organization_locked`; RPC-ovi s liste dozvoljenog je ne provjeravaju.
- Server akcije vraćaju grešku `locked` s porukom za korisnika; UI sakriva / gasi
  dugmad za zabranjene radnje (samo radi preglednosti).

**Upozorenja u firmi:**

- X dana prije automatskog zaključavanja (postavka, default 5): admin i direktor
  vide traku "Uplata za <mjesec> nije evidentirana — zaključavanje <datum>".
- Kad je zaključana: svi korisnici vide traku zašto je zaključana i kome da se jave
  (tekst kontakta u postavkama platforme).

## Ekrani (prema skici)

- **A · Lista firmi** — kolone i filteri iz skice; red vodi na detalj.
- **B · Detalj firme** — traka stanja; zaglavlje (naziv, adresa, ID, korisnici, od
  kada); "Zaključaj / Otključaj", "Uđi u firmu (podrška)"; kartica Paket (paket ▾,
  iznos, rok firme, automatsko zaključavanje ▾); kartica Moduli (iz paketa / proba
  / nije u paketu, "Dodaj kao probu…"); Plaćanja po mjesecima (od prvog obračunskog
  mjeseca do tekućeg); Historija (iz audit loga).
- **C · Postavke** — Paketi (lista + novi / izmijeni / arhiviraj), Plaćanje i
  zaključavanje (rok, dani upozorenja, kontakt tekst), Probni period (postoji).

Desktop-first, gusti tabele (pravila iz CLAUDE.md). Svi tekstovi preko `bs.json`.

## Sigurnost i podaci

- Sve platformske radnje: permisija `platform.manage` (postoji), provjera na serveru.
- Nove tabele (prijedlog): `billing_packages`, `billing_package_modules`,
  `organization_billing` (paket, rok firme, auto-lock, ručno zaključano + razlog +
  otključano do), `billing_payments` (mjesec, iznos, plaćeno kada / ko, napomena).
  Platformske tabele (ne pripadaju tenantu); firme ih ne čitaju direktno — stanje
  vide kroz RPC (npr. `my_billing_notice`) bez iznosa drugih firmi.
- Novac `numeric`, mjesec kao `date` (prvi dan), vremena `timestamptz`.
- Audit za: dodjela/promjena paketa, plaćeno/poništeno, zaključaj/otključaj,
  promjena paketa u postavkama.

## Testovi

- DB (`tests/db`): zaključana firma ne može kreirati nalog / proizvod / kupca, a može
  prijaviti komade, otkucati se, izdati materijal za postojeći nalog; uplata odmah
  otključava; rok + 1 dan zaključava; firma ne vidi plaćanja drugih; ne-platformski
  korisnik ne može mijenjati pakete i plaćanja; podjela modula ne gubi ništa.
- Unit: izračun roka i stanja mjeseca (kraj mjeseca, vremenska zona, rok firme).
- E2E: admin označi plaćeno → firma otključana; zaključana firma vidi traku i nema
  dugme "Novi nalog".

## Odluke koje sam donio ja (provjeri)

1. Stanje "zaključano" računam iz podataka u trenutku upita, bez noćnog posla.
2. Prvi obračunski mjesec = mjesec dodjele paketa.
3. Firmi se može postaviti vlastiti rok i isključiti automatsko zaključavanje.
4. "Otključaj do <datum>" za firmu koja bi inače automatski bila zaključana.
5. Iznos mjeseca se pamti na početku mjeseca (kasnija promjena cijene ne mijenja ga).
6. Arhiviran paket ostaje firmama koje ga imaju.
7. Tekst "kome da se jave" (kontakt Zcore-a) je postavka platforme.
8. Stanja u listi: **Aktivna**; **Upozorenje** (neplaćen mjesec, rok za ≤ X dana);
   **Kasni** (rok prošao, ali nije zaključana jer je automatsko zaključavanje
   isključeno ili je otključana do datuma); **Zaključana**; **Proba**.
9. Tekući mjesec nikad ne zaključava (njegov rok je tek nakon kraja mjeseca).
10. Ako se firmi ukloni paket, više se ne obračunava, ali već dospjeli neplaćeni
    mjeseci i dalje zaključavaju dok se ne označe kao plaćeni.
11. Upozorenje prije zaključavanja vide korisnici s `org.settings.manage` (admin,
    direktor), a ne fiksne uloge.
12. Firma Zcore (platforma) se nikad ne zaključava.
13. Zaključavanje važi i za nalog podrške; kad podrška treba nešto mijenjati,
    platformski admin firmu privremeno otključa ("otključaj do").
14. Zahtjevi radnika za odsustvo i korekcije se blokiraju kao i ostalo (nisu na
    listi dozvoljenog), po riječima vlasnika "ne može se dodavati … išta više".

## Prepušteno graditelju

Tačni nazivi tabela/funkcija, raspored koda po `src/modules/platform`, kako se
lista dozvoljenih tabela/RPC-ova tehnički označi, izgled komponenti unutar skice.
