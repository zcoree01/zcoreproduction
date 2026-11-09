# Zcore firma kao upravljačka firma: meni, uloge, početna, prijave problema, brisanje firmi — dizajn

Datum: 2026-11-09 · Vlasnik proizvoda: Zcore (platformski admin) · Status: čeka odobrenje

## Zašto

Firma `zcore` (`organizations.is_platform`) je matična firma preko koje Zcore upravlja svim
ostalim firmama. Danas izgleda kao svaka druga firma: dobija iste sistemske uloge
(admin, direktor, šef proizvodnje…), isti dashboard s widgetima proizvodnje, i u meniju
može vidjeti stvari koje joj ne trebaju (mašine, proizvodnja). Zcore nema proizvodnju —
njeni "klijenti" su firme u Zcore platformi. Vlasnik proizvoda želi da Zcore firma bude
čisto upravljački alat: jedna početna strana s onim što je bitno za posao (prihod, firme,
korisnici, ko kasni s uplatom, šta čeka rješavanje, prijave problema, brzina, korištenje),
dvije svoje uloge (Administrator i Tehničar), i mogućnost da firmu koja više nije u
programu arhivira i, uz rezervu od 30 dana, trajno obriše da ne zauzima memoriju.

Uz to firme trebaju jednostavan način da Zcore-u prijave problem (i "sporo radi"), a Zcore
da im odgovori ili zakaže ulazak u firmu preko postojećeg zahtjeva za pristup.

## Dijelovi i redoslijed gradnje

Tri dijela, grade se ovim redom, svaki se može pustiti zasebno:

1. **Zcore firma: meni, uloge, arhiviranje i brisanje firme**, trajni zapis uplata i
   prelazak na pretplatu unaprijed (dio 1b).
2. **Početna strana platforme** s podacima koji već postoje (kartice označene ✱ prikazuju
   se tek kad dio 3 postoji — ne smiju se prikazati s lažnim brojevima).
3. **Prijave problema, mjerenje brzine stranica i korištenja**, i njihove kartice na
   početnoj.

## Ciljevi

### Dio 1 — meni, uloge, arhiva i brisanje

**Meni Zcore firme** (samo ovo, ništa od proizvodnje, mašina, magacina, prisustva):
Početna · Korisnici · Uloge i dozvole · Firme (`/platform`) · Zahtjevi za imenik
(`/platform/requests`) · Prijave (dio 3) · Postavke platforme (`/platform/settings`).
Profil i odjava ostaju kao i svugdje. Zcore firma i dalje nema "Podaci o firmi" ni
"Zcore podrška" (postojeće, D-026).

**Uloge Zcore firme** — Zcore firma više nema 7 standardnih sistemskih uloga, nego dvije
svoje sistemske uloge, uz mogućnost dodavanja vlastitih uloga u "Uloge i dozvole"
(postojeći uređivač, D-046), sastavljenih samo od platformskih dozvola:

| Može                                                      | Administrator | Tehničar |
| --------------------------------------------------------- | :-----------: | :------: |
| Vidi početnu, firme, zahtjeve, prijave                    |       ✓       |    ✓     |
| Vidi prihod (kartica, grafikon, zbir dugovanja)           |       ✓       |          |
| Dodaje / uklanja module firmi (probe, uključi / isključi) |       ✓       |    ✓     |
| Mijenja paket firmi                                       |       ✓       |    ✓     |
| Daje podršku (traži pristup, ulazi u firmu)               |       ✓       |    ✓     |
| Odobrava zahtjeve za izmjenu podataka / imenik            |       ✓       |    ✓     |
| Označava da je mjesec plaćen                              |       ✓       |    ✓     |
| Poništava uplatu                                          |       ✓       |          |
| Zaključava / otključava firmu, "otvoreno do"              |       ✓       |    ✓     |
| Odgovara na prijave problema, zakazuje sesiju (dio 3)     |       ✓       |    ✓     |
| Pravi pakete i mijenja cijene                             |       ✓       |          |
| Mijenja postavke platforme (rokovi, kontakt, proba)       |       ✓       |          |
| Upravlja Zcore korisnicima i ulogama                      |       ✓       |          |
| Arhivira firmu, vraća iz arhive                           |       ✓       |          |
| Briše firmu, opoziva brisanje                             |       ✓       |          |

Današnja jedna dozvola `platform.manage` dijeli se na granularne platformske dozvole
(tačne ključeve bira graditelj) tako da gornja tabela važi i na serveru i u bazi, ne samo
u skrivanju dugmadi (CLAUDE.md pravilo 2). Postojeći članovi Zcore firme dobijaju ulogu
Administrator.

**Arhiviranje firme** — na stranici firme (`/platform/organizations/[id]`) pored
"Zaključaj" dugme **"Arhiviraj firmu"** (Administrator, s potvrdom i razlogom). Arhivirana
firma:

- ne može se prijaviti nijedan njen korisnik, kiosk ne radi, nema upisa (jače od
  zaključavanja — ni započeti posao se ne završava);
- nestaje iz glavne liste firmi i prikazuje se u filteru/listi **"Arhiva"**;
- Administrator je može **"Vratiti iz arhive"** (sve radi kao prije).

**Brisanje firme** — samo iz arhive, samo Administrator, dugme **"Obriši firmu"**:

1. Prvi ekran: "Da li ste sigurni da želite obrisati firmu <ime>?" (Odustani / Da).
2. Drugi ekran: gore puno ime firme kao tekst; ispod polje s natpisom "Potvrdite brisanje
   ponovnim upisom punog imena firme". Dugme "Obriši" je aktivno tek kad je upisano ime
   tačno jednako (provjera i na serveru).
3. Firma postaje **"Zakazana za brisanje"** s datumom: 30 dana od potvrde. U tom periodu
   Administrator može **"Opozvati brisanje"** (firma ostaje arhivirana).
4. Nakon 30 dana sve se trajno briše: svi redovi te firme u svim tabelama, njeni korisnici
   (Auth), fajlovi u Storage-u (crteži, certifikati, logo, dokumenti odsustva…).

Ostaje:

- **Uplate ostaju trajno** (vlasnik proizvoda): za svaku uplatu ostaje zapis u Zcore firmi
  — ime firme, mjesec, iznos, datum uplate, napomena — bez obzira da li je firma obrisana.
  Prihod na početnoj i knjigovodstveni trag ostaju tačni i poslije brisanja. Zapis nastaje
  pri uplati (ne tek pri brisanju), tako da su prihodi uvijek iz istog izvora.
- Zapis u dijeljenom imeniku firmi (`companies` — javni podatak koji koriste druge firme;
  vlasništvo nad zapisom se oslobađa).
- Zapis u audit logu Zcore firme ko je, kada i koju firmu arhivirao, zakazao za brisanje,
  opozvao i kada je trajno obrisana (ime, slug, broj korisnika — bez poslovnih podataka).

**Naplata i arhiva:** arhivirani mjeseci se ne naplaćuju; firma vraćena iz arhive plaća od
mjeseca vraćanja (zadržava paket) i ne zaključava se odmah zbog mjeseci u arhivi.
Arhivirane firme se ne broje u "Kasne s uplatom" ni u "Očekivano".

**Subdomena:** ostaje zauzeta dok je firma arhivirana ili zakazana za brisanje (da se može
vratiti); oslobađa se tek poslije trajnog brisanja. Postojeće arhivirane firme (npr.
neuspjele registracije, D-026) pojavljuju se u Arhivi i mogu se obrisati istim tokom.

### Dio 1b — pretplata se plaća unaprijed (promjena D-049)

Vlasnik proizvoda (2026-11-09): pretplata se plaća **unaprijed**, kao Spotify — platiš pa
koristiš taj mjesec. D-049 danas računa obrnuto (rok = zadnji dan mjeseca + dani za
uplatu, tekući mjesec nikad ne zaključava). Novo:

- Rok za mjesec = **prvi dan tog mjeseca + dani za uplatu** iz postavki platforme (zadano
  15, po firmi drugačije — postojeće postavke ostaju, samo im se mijenja početna tačka).
- Tekući mjesec **može** zaključati firmu kad mu prođe rok.
- Upozorenje (zadano 5 dana prije roka) i automatsko zaključavanje rade kao i danas, samo
  po novom roku. Prvi naplaćeni mjesec je i dalje mjesec dodjele paketa.
- Ekrani firme i lista firmi pokazuju "Plaćeno do <mjesec>" / "Dospijeva <datum>" po
  novom pravilu; tekst upozorenja firmi se prilagođava ("pretplata za novembar").
- Migracija ne smije odjednom zaključati postojeće firme: firme kojima bi novi rok već
  prošao dobijaju prelazni rok (graditelj bira, npr. dani za uplatu od dana puštanja).

**Prihod na početnoj:** "Prihod ovaj mjesec" = uplaćeno **za** tekući mjesec; "Očekivano" =
zbir mjesečnih iznosa svih aktivnih firmi s paketom za tekući mjesec (bez proba i
arhiviranih). "Prihod po mjesecima" = uplaćeno za svaki od zadnjih 12 mjeseci (iz trajnog
zapisa uplata, dakle i obrisane firme).

Ovo je svjesni izuzetak od pravila "arhiviraj, ne briši" (CLAUDE.md pravilo 8), odobren od
vlasnika proizvoda 2026-11-09; upisuje se kao nova odluka u `docs/DECISIONS.md`.

### Dio 2 — početna strana Zcore firme

Zcore firma ne koristi dashboard s widgetima firmi (D-037) ni njegov uređivač; ima jednu
fiksnu početnu stranu. Odobrena skica: raspored A, kartice različitih veličina
(`.superpowers/brainstorm/1404-1794236632/content/platform-home-v2.html`), s ikonama kao
u ostatku aplikacije (lucide, mirne boje kao u meniju — bez emojija i šarenih kvadrata).

Redovi, odozgo:

1. **Četiri broja:** Prihod ovaj mjesec (plaćeno od očekivanog, traka; samo Administrator) ·
   Firme koje koriste (promjena od prošlog mjeseca, koliko u probi) · Korisnici (ukupno u
   svim firmama; "aktivni 7 dana" kad postoji dio 3) · Kasne s uplatom (broj firmi; zbir
   samo Administratoru; koliko zaključanih).
2. **Za riješiti** (pločice s brojem i "Otvori →"): zahtjevi za imenik, podrška na čekanju,
   probe koje ističu u 7 dana, firme zakazane za brisanje, prijave problema (dio 3),
   "sporo radi" prijave (dio 3). Pored: **Stanje firmi** (krug: aktivne, u probi,
   upozorenje, zaključane).
3. **Prihod po mjesecima** (12 mjeseci; samo Administrator) i **Brzina stranica** (dio 3).
4. **Korištenje — aktivni korisnici po danu** (dio 3) i **Prijave problema** (otvorene,
   riješene ovaj mjesec, prosječno vrijeme rješavanja; dio 3).
5. **Firme koje kasne s uplatom** (firma, paket, mjesec, iznos, koliko
   kasni, stanje, "Otvori →").

Tehničar **vidi cijene paketa** (biće javno objavljene na web stranici), pa i mjesečni
iznos paketa pojedine firme. **Ne vidi prihod**, tj. zbirne iznose: kartica "Prihod ovaj
mjesec" / "Očekivano", grafikon prihoda po mjesecima i ukupni iznos dugovanja ("Kasne s
uplatom" mu pokazuje broj firmi, ne zbir). Isto važi na serveru (upiti za prihod mu ne
vraćaju podatke). Kartice dijela 3 ne prikazuju se dok dio 3 ne postoji.

### Dio 3 — prijave problema, brzina, korištenje

**Dugme u vrhu:** ikona upitnika ("Pomoć i prijava problema") u gornjoj traci pored
zvona, u aplikaciji za upravu i na pogonu (mobilno). Svaki korisnik bilo koje firme (ne
Zcore) može prijaviti problem — bez posebne dozvole.

**Prijava** (bočni panel / na mobilnom cijeli ekran, velika dugmad): vrsta — Nešto ne
radi · Sporo radi · Ne znam kako da… · Prijedlog · Paket i plaćanje · Ostalo; opis
(obavezan za "Ostalo"); opcionalno slika ekrana. Automatski se dodaju: stranica na kojoj
je bio, firma, korisnik, vrijeme, uređaj/preglednik, a za "Sporo radi" izmjereno vrijeme
učitavanja te stranice.

**"Moje prijave"** iza istog dugmeta: korisnik vidi svoje prijave, stanje i razgovor, može
odgovoriti.

**Kod Zcore-a — meni "Prijave":** lista svih prijava (filteri: stanje, vrsta, firma),
detalj s razgovorom. Stanja: Nova → U obradi → Čeka korisnika → Riješena. Administrator i
Tehničar odgovaraju porukama ili klikom **"Zakaži sesiju"** (datum, vrijeme, trajanje).

**Zakazana sesija = zakazani ulazak u firmu** preko postojećeg zahtjeva za pristup
(`support_access_requests`, D-028), s terminom. Odobrava ga, kao i danas, admin / direktor
te firme (`support.approve`); radnik koji je prijavio problem dobija obavještenje s
terminom. U zakazano vrijeme Zcore ulazi preko postojećeg "Uđi u firmu".

- Pristup važi od zakazanog početka do početka + trajanje, bez obzira kada je odobren.
- Admin firme može odobriti bilo kada prije kraja termina; prozor za odobrenje (postojeći
  dijalog) iskače čim je sesija predložena. Neodobren termin istekne sam.
- Radnik koji je prijavio dobija obavještenje kad je termin predložen i kad je odobren /
  odbijen; on sam ne odobrava.

**Zaključana firma** (D-049) može slati prijave, odgovarati u "Moje prijave", dodavati
slike i odobravati zakazanu sesiju — tabele prijava su na listi dozvoljenih u `lock_guard`.
Arhivirana firma ne može ništa.

**Obavještenja:** kad stigne odgovor ili prijedlog sesije, korisnik ga vidi na zvonu
(postojeće zvono, D-038); Zcore na svom zvonu vidi nove prijave i odgovore korisnika.

**Brzina stranica:** program sam mjeri vrijeme učitavanja stranica kod stvarnih korisnika
(po stranici i firmi) i čuva to; početna pokazuje prosjek zadnjih 7 dana i najsporije
stranice.

**Korištenje:** program pamti koji je korisnik bio aktivan kojeg dana; početna pokazuje
aktivne korisnike po danu (30 dana) i "aktivni 7 dana".

## Ne-ciljevi

- Ostale firme ne mijenjaju uloge, meni ni dashboard.
- Nema e-mail / SMS / push obavještenja — samo zvono u aplikaciji (kao danas).
- Nema video poziva ni dijeljenja ekrana; sesija je samo zakazani ulazak u firmu.
- Nema brisanja Zcore firme same, ni brisanja firme koja nije arhivirana.
- Nema online plaćanja ni faktura (D-049 ostaje).

## Anti-ciljevi (neuspjeh i ako tehnički radi)

- Trajno brisanje koje se može okinuti slučajno, bez dva ekrana i tačnog imena, prije 30
  dana, od Tehničara, ili koje obriše podatke druge firme ili dijeljeni imenik.
- Brisanje koje ostavi "siročad": korisnike u Auth-u, fajlove u Storage-u ili redove s
  `organization_id` obrisane firme.
- Tehničar koji preko API-ja može ono što mu meni ne pokazuje (prihod, poništavanje
  uplate, brisanje, paketi, postavke, Zcore korisnici).
- Kartice na početnoj s izmišljenim ili statičnim brojevima.
- Ikone i izgled koji djeluju "kao AI-pravljeno" umjesto kao ostatak aplikacije.
- Prijava problema koja traži od radnika da kuca tehničke detalje koje program zna sam.

## Ograničenja

- CLAUDE.md pravila važe: RLS na svakoj tabeli, provjera dozvole na serveru, Zod na svakom
  ulazu, višekoračni upisi kroz RPC/transakciju, audit log, `timestamptz`, i18n ključevi u
  `messages/bs.json`, nove tabele firmi dobijaju `lock_guard` (D-049).
- Nove migracije moraju imati timestamp veći od zadnje primijenjene (`20261110160000`).
- Service role samo na serveru.

## Odluke koje sam donio (Claude), vlasnik ih nije posebno tražio

- Arhivirana firma je jača od zaključane: niko se ne prijavljuje, ništa se ne upisuje.
- Imenik firmi (`companies`) ostaje nakon brisanja; vlasništvo nad zapisom se oslobađa.
- Audit log Zcore firme čuva trag o arhiviranju i brisanju (bez poslovnih podataka).
- Tehničar vidi cijene paketa (vlasnik: javne su), ali ne vidi zbirni prihod ni zbir dugovanja.
- Prijavu može poslati svaki korisnik firme, i radnik na pogonu; zaključana firma također.
- Zakazanu sesiju i dalje odobrava admin / direktor firme, ne radnik koji je prijavio;
  pristup važi od zakazanog početka.
- Brzina i korištenje se mjere automatski, bez ikakve radnje korisnika.
- Arhivirani mjeseci se ne naplaćuju; subdomena se oslobađa tek nakon trajnog brisanja.
- Pretplata unaprijed: rok = 1. u mjesecu + postojeći "dani za uplatu" (zadano 15);
  postojeće firme dobijaju prelazni rok da se ne zaključaju odjednom.
- Zapis uplate u Zcore firmi nastaje odmah pri uplati, ne tek pri brisanju firme.

## Prepušteno graditelju

- Tačni ključevi novih platformskih dozvola i kako se `platform.manage` zamjenjuje.
- Kako trajno brisanje nakon 30 dana stvarno pokreće (zakazani posao na Vercelu ili u
  bazi); mora obrisati i Auth korisnike i Storage fajlove, i biti sigurno ako se pokrene
  dvaput.
- Tehnika mjerenja brzine (npr. web-vitals iz preglednika) i bilježenja aktivnosti po danu,
  i koliko dugo se ti podaci čuvaju.
- Gdje se čuvaju slike ekrana iz prijava (privatni bucket po firmi).
- Tačan izgled panela za prijavu i liste "Prijave" u skladu s postojećim komponentama.
