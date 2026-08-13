# Fiskalni račun sa zbirnom stavkom + nefiskalna specifikacija — regulativa FBiH

Datum istraživanja: 2026-08-13

Kontekst: POS aplikacija (Tring fiskalni server) treba da na fiskalnom računu otkuca jednu zbirnu stavku (npr. "Stavke po računu br. X"), a specifikaciju artikala/usluga štampa kao poseban nefiskalni dokument (faktura/specifikacija) koji se prilaže uz fiskalni račun.

## TL;DR

1. **Zbirna stavka: nije eksplicitno dozvoljena kao opšte pravilo, ali je zvanično prihvaćena praksa u tačno određenim situacijama.** Zakon o fiskalnim sistemima (81/09) traži evidentiranje "svakog pojedinačno ostvarenog prometa" (čl. 4) i jednoznačnu bazu artikala (čl. 2 i 32), a Pravilnik o fiskalnim dokumentima (50/20, 92/20, 28/21) propisuje da fiskalni račun sadrži "listu pojedinačnih evidentiranih prometa" (čl. 34). **Međutim**, zvanični FAQ o fiskalizaciji (odgovori nadležnih organa, distribuiran preko FEB-a) izričito dozvoljava da se **kod prometa za koji se izdaje faktura** (avansi, privremene fakture, prodaja na rate, masovno fakturisanje) fiskalni račun izda "u jednom ukupnom iznosu", dok se "na samoj fakturi mogu iskazivati stavke onoliko detaljno koliko je to stranama u prometu potrebno" — uz uslov jednoznačne veze fakture i fiskalnog računa. Praksa "Stavke po RN:" u veleprodaji je ustaljena (potvrđuju je proizvođači fiskalnih sistema), ali za nju nisam našao izričit član propisa — to otvoreno naglašavam.
2. **Veza fakture i fiskalnog računa je izričito propisana i ide u smjeru: FAKTURA sadrži BROJ FISKALNOG RAČUNA (BF broj), ne obratno.** Čl. 42 Zakona o fiskalnim sistemima: "Ako klijent plaćanje obavlja na osnovu fakture, obveznik je dužan da u fakturu unese redni broj fiskalnog računa na osnovu kojeg je registrovan promet u fiskalnom uređaju." Isto propisuje čl. 107 Pravilnika o primjeni Zakona o PDV-u (obveznici fiskalizacije dužni su na poreznoj fakturi naznačiti broj vezanog fiskalnog računa).
3. **Naziv stavke koji referencira interni broj dokumenta (npr. "Stavke po računu br. 123") nije ni propisan ni zabranjen.** Propisi traže samo da naziv artikla bude "jednoznačno i nedvosmisleno identificiran" i da dolazi iz baze artikala fiskalnog uređaja. Referenca na interni broj u nazivu stavke je informativna i praksa je tolerisana — ali **zakonski obavezujuća veza ide isključivo preko broja fiskalnog računa upisanog u fakturu**. Interna referenca na fiskalnom računu je dodatak, ne zamjena.
4. **Uobičajena praksa u FBiH:** uz fakturu se izdaje fiskalni račun (na ukupan iznos ili po stavkama), a na fakturi se obavezno navodi broj fiskalnog računa. Novi Zakon o fiskalizaciji transakcija ("Sl. novine FBiH" 9/26, usvojen 20/23.01.2026.) zadržava tu logiku, ali **za fiskalni račun izričito traži "redni broj, šifru artikla, naziv artikla, količinu i cijenu po jedinici" (čl. 18)** — dakle po stavkama — i uvodi obrnutu referencu za otpremnice/narudžbenice (račun izdat na osnovu otpremnice mora sadržavati njen broj i datum, čl. 5 i 18). Primjena novog zakona počinje tek nakon podzakonskih akata (najkasnije 18 mjeseci od stupanja na snagu), a stari fiskalni sistemi se mogu koristiti u prelaznom periodu do 3–4 godine.

**Praktična preporuka za aplikaciju:** zbirna stavka + detaljna nefiskalna specifikacija je prihvatljiva samo u režimu "promet po fakturi" (B2B/veleprodaja, avansi), i tada je **obavezno** da faktura/specifikacija sadrži broj fiskalnog računa (BF broj se dobije tek NAKON štampanja fiskalnog računa — redoslijed: otkucaj fiskalni račun → očitaj BF → upiši BF na fakturu prije štampe, ili doštampaj). Veza preko internog broja u nazivu stavke je korisna, ali sama po sebi ne zadovoljava čl. 42. Za obični B2C maloprodajni promet bez fakture, stavke treba kucati pojedinačno. Dugoročno (novi zakon) treba planirati per-stavka fiskalizaciju.

---

## 1. Zbirna stavka na fiskalnom računu

### Šta propisi izričito traže (protiv zbirne stavke kao opšteg pravila)

**Zakon o fiskalnim sistemima ("Sl. novine FBiH" 81/09):**

- Čl. 4 st. (1): "Obavezu evidentiranja svakog pojedinačno ostvarenog prometa preko fiskalnih uređaja i to nezavisno od načina plaćanja (gotovina, ček, kartica, virman i slično) ima svako lice koje je upisano u odgovarajući registar za promet dobara, odnosno za pružanje usluga klijentima."
- Čl. 2 (Definicije): "Baza podataka o dobrima i uslugama sadrži jednoznačno i nedvosmisleno identificiran naziv dobara ili usluga, naziv jedinice mjere, cijenu jedinice mjere i oznaku propisane porezne stope."
- Čl. 32 st. (1): "Obveznik je dužan da u bazu artikala unese jednoznačno i nedvosmisleno identificiran cjelokupan asortiman artikala s kojima je zaduženo prodajno mjesto."

**Pravilnik o fiskalnim dokumentima ("Sl. novine FBiH" 50/20, 92/20, 28/21), čl. 34:**

- st. (1) tačka c): fiskalni račun sadrži blok "sa listom pojedinačnih evidentiranih prometa, ukoliko je uopće obavljeno evidentiranje prometa...".
- st. (3): za svaki pojedinačni evidentirani promet štampaju se: "a) naziv evidentiranog artikla iz baze artikala fiskalnog uređaja sa pripadajućom jedinicom mjere...; b) količina, znak množenja, cijena po jedinici mjere...; c) vrijednost pojedinačnog evidentiranog prometa, krajnje desno poravnata oznaka porezne stope...".
- Čl. 10 (Format naziva artikla): naziv artikla je "niz alfanumeričkih znakova" iz baze artikala; može sadržati jedinicu mjere.
- Čl. 33: "Svi fiskalni računi i reklamirani računi sadrže prostor za upis proizvoljnog teksta, koji određuje obveznik." (proizvoljni tekst je dozvoljen kao poseban blok — tu se legalno može štampati npr. "Specifikacija: faktura br. X" — ali to je nefiskalni dio računa).

Dakle, slovo propisa podrazumijeva kucanje pojedinačnih stavki. "Zbirna stavka" je tehnički samo jedan artikal u bazi — propis to ne zabranjuje izričito (artikal je "roba i usluge", čl. 2), ali ni ne predviđa kao model, osim kroz zvanična tumačenja ispod.

### Šta zvanična tumačenja dozvoljavaju (za zbirnu stavku uz fakturu)

Zvanični odgovori na "Najčešće postavljana pitanja o fiskalizaciji u Federaciji BiH" (dokument distribuiran preko FEB-a; odgovori se pozivaju na Zakon 81/09 i pravilnike, po sadržaju potiču od nadležnog organa — FMF/PU FBiH; dokument sam ne navodi potpisnika, što napominjem kao ogradu):

> "Ukoliko se radi o avansnom plaćanju i sličnim privremenim fakturama, fiskalni račun se može izdati na kraju sa slanjem fakture u jednom ukupnom iznosu koji će sadržavati ukupnu cijenu 'kompletnog' artikla, npr. stambene zgrade, ili pojedinog stana i sl., **dok se na samoj fakturi mogu iskazivati stavke onoliko detaljno koliko je to stranama u prometu potrebno, samo mora postojati jednoznačna veza između fakture i fiskalnog računa (broj fiskalnog računa na samoj fakturi)**, jer se i podaci u Poreznu upravu šalju sa informacijom o tome kome i koliki je promet fakturisan."

Isti dokument za masovno fakturisanje tipskih usluga: dovoljno je "na odgovarajući način prikazati sve fakturisane robe i usluge na jednom ili više fiskalnih računa koji kvantitativno i kvalitativno sadrže sve prometovane artikle", s tim da se za pravna lica i poduzetnike "ipak mora praviti poseban fiskalni račun za svakog korisnika usluge".

Proizvođač fiskalnih sistema Intercomp (FAQ o fiskalizaciji u FBiH) navodi za veleprodaju:

> "Za veleprodaju je po pravilniku omogućeno pravljenje fiskalnog računa na kojem će stajati 'Stavke po RN:', i koji će biti prilog uz veleprodajnu fakturu."

**Ograda:** za formulaciju "Stavke po RN:" nisam pronašao izričit član važećeg pravilnika koji je propisuje — Intercomp se poziva na "pravilnik" bez broja člana (najvjerovatnije na stariji Pravilnik o izgledu fiskalnih, nefiskalnih i testnih dokumenata, "Sl. novine FBiH" 11/10, i na veleprodajni mod rada fiskalnih uređaja). Tretirati kao ustaljenu, od proizvođača i struke prihvaćenu praksu za promet po fakturi, a ne kao izričitu zakonsku normu.

**Zaključak za pitanje 1:** DA za promet koji se fakturiše (B2B/veleprodaja, avansi, sukcesivne isporuke) — fiskalni račun može imati zbirnu stavku/ukupan iznos, a specifikacija ide na fakturi (nefiskalni dokument), pod uslovom veze iz tačke 2. NE kao opšti model za maloprodajni B2C promet bez fakture — tu propisi traže pojedinačne stavke iz baze artikala.

## 2. Veza fakture i fiskalnog računa

**Primarni izvor — Zakon o fiskalnim sistemima 81/09, čl. 42 (Plaćanje na osnovu fakture):**

> "(1) Ako klijent plaćanje obavlja na osnovu fakture, obveznik je dužan da u fakturu unese redni broj fiskalnog računa na osnovu kojeg je registrovan promet u fiskalnom uređaju.
> (2) Ostvaren evidentiran promet i ostvaren reklamiran promet preko fiskalnog uređaja za koji se plaćanje obavlja na osnovu fakture, obveznik je dužan da iskazuje u knjizi dnevnih izvještaja."

**PDV nivo — Pravilnik o primjeni Zakona o PDV-u ("Sl. glasnik BiH" 93/05 sa izmjenama), čl. 107:** pored standardnih elemenata porezne fakture (st. 1), propisano je (prema više sekundarnih stručnih izvora koji citiraju prečišćeni tekst):

> "Obveznici fiskalizacije su dužni na poreskoj fakturi naznačiti broj fiskalnog računa koji je vezan za predmetnu izdatu poresku fakturu."

Ograda: ovu odredbu čl. 107 potvrđuju sekundarni izvori (Unija ETL i dr.); broj službenog glasnika izmjene kojom je dodana nisam uspio potvrditi iz primarnog izvora (UINO PDF je ćirilična skenirana verzija osnovnog teksta 93/05). Nezavisno od toga, obaveza nesporno postoji na entitetskom nivou kroz čl. 42 Zakona 81/09.

**Smjer veze je dakle: faktura → sadrži BF broj fiskalnog računa.** Nijedan propis ne traži da fiskalni račun sadrži broj fakture (po starom zakonu); po novom Zakonu o fiskalizaciji transakcija uvodi se i obrnuta referenca za otpremnice/narudžbenice (vidi tačku 4).

**Praktična posljedica za redoslijed u aplikaciji:** BF broj nastaje tek štampanjem fiskalnog računa. Zato tok mora biti: (1) fiskalizuj (zbirno ili po stavkama) → (2) preuzmi BF broj iz odgovora fiskalnog servera → (3) odštampaj fakturu/specifikaciju s upisanim BF brojem. Obrnut redoslijed (prvo faktura pa fiskalni račun) je moguć samo ako se BF broj naknadno dopiše/doštampa na fakturu.

## 3. Interni broj dokumenta u nazivu stavke

- Propisi ne zabranjuju da naziv artikla/stavke bude npr. "Stavke po računu br. 2026-00123". Naziv artikla je slobodan "niz alfanumeričkih znakova" (Pravilnik o fiskalnim dokumentima, čl. 10), uz opšti zahtjev jednoznačnosti (Zakon čl. 2 i 32). Zvanični FAQ pokazuje da se i "kompletan artikal" tipa "stan" prihvata kao stavka kad postoji faktura.
- Ali: **referenca u nazivu stavke nema pravnu snagu veze** — obavezujuću vezu uspostavlja isključivo broj fiskalnog računa upisan u fakturu (čl. 42 Zakona; čl. 107 Pravilnika o PDV-u). Interni broj u nazivu stavke je dobrodošao dodatak radi uparivanja u kontroli, ali ne smije biti jedina veza.
- Alternativno/dodatno mjesto za internu referencu: blok proizvoljnog teksta na fiskalnom računu (Pravilnik čl. 33) — tu se može štampati "Faktura br. X" bez "trošenja" naziva artikla.
- Napomena za jednoznačnost baze artikala: ako se za svaku fakturu kreira novi artikal ("Stavke po računu br. X"), baza artikala raste sa svakim računom; ako se koristi jedan generički artikal (npr. "Roba/usluge po fakturi") a broj fakture ide u proizvoljni tekst, baza ostaje čista. Propis ne rješava ovu dilemu; obje varijante se sreću u praksi. (Kod Tring uređaja treba provjeriti ograničenja veleprodajnog moda i dužine naziva artikla.)

## 4. Uobičajena praksa i novi Zakon o fiskalizaciji transakcija (Sl. novine FBiH 9/26)

### Praksa po važećem režimu (Zakon 81/09)

- B2B/veleprodaja: roba se isporučuje uz otpremnicu/fakturu; fiskalni račun se izdaje (često zbirno, "Stavke po RN:") i prilaže uz fakturu; na fakturi se navodi BF broj fiskalnog računa. Kod prodaje na rate/uz fakturu, fiskalni račun se može izdati u momentu prve ili posljednje uplate (zvanični FAQ).
- Za pravna lica i poduzetnike mora postojati poseban fiskalni račun po korisniku (ne smije se sav promet više kupaca zbiti u jedan fiskalni račun); za fizička lica kod masovnog fakturisanja moguće je zbirno na jednom fiskalnom računu dnevno.
- Knjižne obavijesti / naknadna umanjenja fakture ne evidentiraju se direktno, nego reklamiranim računom (zvanični FAQ).

### Novi zakon (usvojen 20.01./23.01.2026., objavljen u "Sl. novine FBiH" 9/26 od 04.02.2026.)

- **Čl. 18 (Sadržaj fiskalnog računa)**, st. (1) tačka h): fiskalni račun mora sadržavati najmanje "redni broj, šifru artikla, naziv artikla, količinu i cijenu po jedinici" — dakle specifikaciju po stavkama na samom fiskalnom računu. Isto za e-fakturu (čl. 13 st. (1) tačka m): "redni broj, šifra artikla, naziv artikla, količina, cijena po jedinici i ukupan iznos po stavci").
- **Čl. 5 st. (2)**: "Ukoliko je otpremnica prethodno izdata, račun mora sadržavati jasnu naznaku da je izdat na osnovu te otpremnice, uključujući njen broj i datum." Analogno za narudžbenice (čl. 5 st. (3), čl. 18 st. (3)). Novi zakon dakle **legalizuje referencu na interni dokument (otpremnicu/narudžbenicu) na samom računu** — ali kao poseban podatak, ne kao zamjenu za stavke.
- Fiskalni računi su za B2C (čl. 17 st. (2)); za B2B/B2G obavezna je e-faktura (čl. 15, 16) koja se fiskalizuje kroz CPF — model "fiskalni račun + papirna faktura" nestaje za B2B.
- **Prelazni režim (čl. 86–90):** zakon stupa na snagu 8 dana od objave, ali "počinje se primjenjivati nakon donošenja svih potrebnih podzakonskih akata..., najkasnije u roku od 18 mjeseci" (čl. 90 st. (2)); podzakonski akti u roku 180 dana (čl. 88). Usklađivanje: B2C u roku 2 godine, B2B/B2G 3 godine od početka primjene (čl. 86). Postojeći fiskalni sistemi po Pravilniku 50/20, 92/20, 28/21 mogu se koristiti u prelaznom periodu, najkasnije 4 godine od početka primjene (čl. 87). Do početka primjene važi Zakon o fiskalnim sistemima 81/09 (čl. 89 st. (1)).

**Zaključak za pitanje 4:** danas (avgust 2026.) i dalje se primjenjuje režim Zakona 81/09 — praksa "zbirni fiskalni račun + faktura sa BF brojem" je legitimna za promet po fakturi. Srednjoročno, aplikacija treba biti spremna na per-stavka fiskalizaciju i e-fakture kroz ESET/CPF.

## Šta NIJE potvrđeno / otvorena pitanja

- Izričit član pravilnika koji propisuje formulaciju "Stavke po RN:" za veleprodajni mod — nije pronađen; tvrdnja potiče od proizvođača fiskalnih sistema (Intercomp) i pozivanja na stariji Pravilnik 11/10. Prije oslanjanja na ovu praksu za konkretnu djelatnost, preporučujem pisani upit Poreznoj upravi FBiH (institut mišljenja).
- Broj službenog glasnika izmjene Pravilnika o primjeni Zakona o PDV-u kojom je u čl. 107 dodana obaveza navođenja broja fiskalnog računa — potvrđeno samo iz sekundarnih izvora.
- Autor/potpisnik FAQ dokumenta o fiskalizaciji (FEB PDF) — sadržajno se radi o odgovorima nadležnog organa, ali dokument ne nosi memorandum.
- Zvanična pojedinačna mišljenja PU FBiH o zbirnoj stavci nisu javno indeksirana (PU FBiH mišljenja ne objavljuje sistematski na webu).

## Izvori

Primarni:

1. Zakon o fiskalnim sistemima ("Sl. novine FBiH" 81/09) — puni tekst, PU FBiH: https://www.pufbih.ba/v1/public/upload/zakoni/c7edb-zakon-o-fiskalnim-sistemima.pdf (čl. 2, 4, 32, 33, 34, 35, 42)
2. Pravilnik o fiskalnim dokumentima ("Sl. novine FBiH" 50/20, 92/20, 28/21) — neslužbeni prečišćeni tekst, FMF: https://www.fmf.gov.ba/Content/Open/100953?n=Pravilnik_o_fiskalnim_dokumentima.pdf (čl. 10, 33, 34)
3. Zakon o fiskalizaciji transakcija u FBiH ("Sl. novine FBiH" 9/26, 04.02.2026.) — sken službenih novina: https://feb.ba/wp-content/uploads/2026/02/Zakon-o-fiskalizaciji-transakcija-u-FBiH-1.pdf (čl. 5, 13, 17, 18, 86–90)
4. Pravilnik o primjeni Zakona o PDV-u ("Sl. glasnik BiH" 93/05) — osnovni tekst, UINO: https://www.uino.gov.ba/portal/wp-content/uploads/PROPISI/2_Porezi/1_PDV/2_Pravilnici/ (čl. 107 — osnovni tekst; izmjena o broju fiskalnog računa potvrđena sekundarno)
5. Najčešće postavljana pitanja o fiskalizaciji u FBiH (zvanični odgovori, PDF preko FEB): https://feb.ba/wp-content/uploads/2021/02/NAJCESCE-POSTAVLJENA-PITANJA-O-FISKALIZACIJI.pdf

Sekundarni (putokazi):

6. Unija ETL — obavezni elementi porezne fakture, čl. 107 Pravilnika o PDV-u: https://unija.com/bs/sta-treba-sadrzavati-faktura-sta-svaki-porezni-obveznik-mora-osigurati/
7. Intercomp — FAQ fiskalizacija FBiH ("Stavke po RN:", veleprodaja): https://intercomp.ba/fiskalizacija/pitanjafiskalizacija/
8. UPFBiH — Usvojen Zakon o fiskalizaciji transakcija u FBiH: https://upfbih.ba/usvojen-zakon-o-fiskalizaciji-transakcija-u-fbih
